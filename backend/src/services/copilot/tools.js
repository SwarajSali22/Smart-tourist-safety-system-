const { z } = require('zod');
const { User, Device, Incident, SOSEvent, RiskAssessment, Zone, HelpCenter, AuditProof, GeofenceEvent } = require('../../models');
const { haversineKm } = require('../geo/haversine');
const { ACTIVE_STATUSES, isOverdue } = require('../incidents/lifecycle');
const { getHealthDetails } = require('../health/healthChecks');
const geocode = require('../geocoding/geocode');
const thresholds = require('../../config/thresholds');
const places = require('./places');
const { guideFor, TOPICS } = require('./guide');

/**
 * The ONLY things the Copilot's AI can do: a fixed list of read-only functions. The model never
 * touches the database, a shell or the network directly — it asks for one of these by name, and the
 * code below decides whether this signed-in user may have it and what exactly is returned.
 *  - Authorization lives HERE (server side): tourist tools are scoped to `ctx.user.id`; admin tools are
 *    registered for admins only, and runTool() re-checks the role for every call.
 *  - Nothing here writes, closes, assigns or dispatches anything.
 *  - Results contain no emails, phone numbers of tourists, passwords, tokens or API keys.
 */

const MAX_RESULT_CHARS = 9000;
const ageMin = (d) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 60000) : null);
const shortId = (id) => String(id).slice(-8);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const CAT = z.enum(Object.keys(places.CATEGORIES));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class ToolError extends Error {}

// ── shared helpers ───────────────────────────────────────────────────────────────

/** Best known position for a tourist: a fresh browser fix the user chose to share, else their device's last ping. */
async function positionOf(touristId, browserFix = null) {
  if (browserFix && Number.isFinite(browserFix.lat) && Number.isFinite(browserFix.lng)) {
    const age = browserFix.capturedAt ? ageMin(browserFix.capturedAt) : 0;
    if (age !== null && age <= 15) {
      return { lat: browserFix.lat, lng: browserFix.lng, source: 'browser location shared by the user', capturedAt: iso(browserFix.capturedAt || new Date()), ageMinutes: age, stale: false, accuracyM: browserFix.accuracy ?? null };
    }
  }
  const devices = await Device.find({ tourist: touristId, 'lastLocation.lat': { $ne: null } }).sort({ lastSeen: -1 }).limit(1).lean();
  const d = devices[0];
  if (!d) return null;
  const age = ageMin(d.lastSeen);
  const stale = age === null || age * 60000 > thresholds.device.staleMs;
  return {
    lat: d.lastLocation.lat, lng: d.lastLocation.lng, source: `${d.type === 'phone' ? 'phone' : 'wristband'} device${d.isSimulated ? ' (simulated)' : ''} last ping`,
    capturedAt: iso(d.lastSeen), ageMinutes: age, stale,
    ...(stale ? { warning: 'This position is old — the tourist may no longer be there.' } : {}),
  };
}

const centroid = (geometry) => {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
  const n = ring.length - 1 || 1;
  const sum = ring.slice(0, n).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
  return { lat: sum[1] / n, lng: sum[0] / n };
};

async function zonesAt(point, types) {
  const found = await Zone.find({ isActive: true, ...(types ? { type: { $in: types } } : {}), geometry: { $geoIntersects: { $geometry: { type: 'Point', coordinates: [point.lng, point.lat] } } } }).select('name type riskLevel').lean();
  return found.map((z) => ({ name: z.name, type: z.type, riskLevel: z.riskLevel }));
}

const incidentRow = (i, extra = {}) => ({
  id: String(i._id), shortId: shortId(i._id), type: i.type, severity: i.severity, priority: i.priority, status: i.status,
  tourist: i.tourist?.name || null, assignedTo: i.assignedAdmin ? `${i.assignedAdmin.name} (${i.assignedAdmin.role})` : null,
  openedAt: iso(i.createdAt), escalated: Boolean(i.escalatedAt), escalatedAt: iso(i.escalatedAt), escalationReason: i.escalationReason || null,
  overdue: ACTIVE_STATUSES.includes(i.status) ? isOverdue(i) : false, simulated: Boolean(i.tourist?.isDemo), ...extra,
});

async function incidentList(filter, limit) {
  const rows = await Incident.find(filter).populate('tourist', 'name isDemo').populate('assignedAdmin', 'name role').sort({ createdAt: -1 }).limit(60).lean();
  const rank = { critical: 3, high: 2, medium: 1, low: 0 };
  return rows.sort((a, b) => rank[b.severity] - rank[a.severity] || new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit).map((i) => incidentRow(i));
}

async function riskOf(touristId) {
  const r = await RiskAssessment.findOne({ tourist: touristId }).sort({ evaluatedAt: -1 }).lean();
  if (!r) return null;
  return {
    level: r.level, score: r.score, evaluatedAt: iso(r.evaluatedAt), ageMinutes: ageMin(r.evaluatedAt),
    outdated: Date.now() - new Date(r.evaluatedAt).getTime() > thresholds.risk.outdatedMs, locationWasStale: Boolean(r.locationStale),
    ruleTriggered: r.ruleName || null, reasons: (r.explanation || []).slice(0, 6).map((e) => (typeof e === 'string' ? e : (e.text || e.message || JSON.stringify(e)).slice(0, 200))),
  };
}

function resolvePoint(input, fallback) {
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) return { lat: input.lat, lng: input.lng, source: 'coordinates given in the question' };
  return fallback;
}

// ── tool implementations ────────────────────────────────────────────────────────

const own = (ctx) => ctx.user.id;

async function toolMyStatus(ctx) {
  const pos = await positionOf(own(ctx), ctx.browserLocation);
  const device = await Device.findOne({ tourist: own(ctx) }).sort({ lastSeen: -1 }).select('deviceId type status battery lastSeen isSimulated currentZones').lean();
  const zones = device?.currentZones?.length ? await Zone.find({ _id: { $in: device.currentZones } }).select('name type riskLevel').lean() : [];
  const incidents = await Incident.find({ tourist: own(ctx), status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 }).limit(5).lean();
  const sos = await SOSEvent.findOne({ tourist: own(ctx), status: { $in: ['active', 'acknowledged'] } }).select('status source createdAt').lean();
  return {
    position: pos || { available: false, message: 'No location is known for this tourist yet.' },
    insideZones: pos ? (pos.stale ? { note: 'Position is stale, zone status may be outdated', zones: zones.map((z) => ({ name: z.name, type: z.type })) } : zones.map((z) => ({ name: z.name, type: z.type }))) : [],
    device: device ? { type: device.type, status: device.status, batteryPercent: device.battery, lastSeen: iso(device.lastSeen), simulated: Boolean(device.isSimulated) } : null,
    risk: await riskOf(own(ctx)),
    activeSos: sos ? { status: sos.status, source: sos.source, triggeredAt: iso(sos.createdAt) } : null,
    activeIncidents: incidents.map((i) => ({ type: i.type, severity: i.severity, status: i.status, openedAt: iso(i.createdAt) })),
  };
}

async function toolNearbyPlaces(ctx, input) {
  let origin;
  if (ctx.user.role === 'tourist') {
    origin = resolvePoint(input, await positionOf(own(ctx), ctx.browserLocation));
    if (!origin) throw new ToolError('NO_LOCATION: no location is available. Ask the user to share their location or name a place/address.');
  } else {
    origin = resolvePoint(input, null);
    if (!origin) throw new ToolError('lat and lng are required for admins (take them from a tourist status result or geocode_place).');
  }
  const res = await places.findNearby({ lat: origin.lat, lng: origin.lng, categories: input.categories, radiusM: input.radius_m ?? 3000, limit: input.limit ?? 5 });
  ctx.collected.places.push(...res.places.map((p) => ({ ...p, origin: { lat: origin.lat, lng: origin.lng } })));
  ctx.collected.origin = { lat: origin.lat, lng: origin.lng, source: origin.source, stale: Boolean(origin.stale) };
  ctx.collected.sources.add(res.source);
  return { searchedAround: { lat: origin.lat, lng: origin.lng, source: origin.source, ageMinutes: origin.ageMinutes ?? null, stale: Boolean(origin.stale) }, ...res, note: res.places.length ? 'Distances are straight-line. Use get_route for walking/driving distance. Opening hours/emergency flags appear only when OpenStreetMap has them; they may be outdated.' : 'No matching named facilities were found in OpenStreetMap within this radius; try a larger radius or another place.' };
}

async function toolGeocode(ctx, input) {
  if (!geocode.isConfigured()) throw new ToolError('Place-name search is not configured on this server.');
  const results = await geocode.searchPlaces(input.query, undefined);
  ctx.collected.sources.add('OpenStreetMap Nominatim');
  return { results: results.slice(0, 3).map((r) => ({ name: r.name, address: r.address, lat: r.lat, lng: r.lng })), note: results.length ? 'Confirm with the user which result they meant if several differ.' : 'Nothing found for that text.' };
}

async function toolRoute(ctx, input) {
  let from = Number.isFinite(input.from_lat) ? { lat: input.from_lat, lng: input.from_lng } : null;
  if (!from && ctx.user.role === 'tourist') from = await positionOf(own(ctx), ctx.browserLocation);
  if (!from) throw new ToolError('NO_LOCATION: a starting point is required.');
  const to = { lat: input.to_lat, lng: input.to_lng };
  const route = await places.routeBetween({ from, to, mode: input.mode || 'foot' });
  ctx.collected.sources.add(route.source);
  return { from: { lat: from.lat, lng: from.lng }, to, ...route, links: places.linksFor(from, to) };
}

async function toolHelpCenters(ctx, input) {
  const origin = resolvePoint(input, ctx.user.role === 'tourist' ? await positionOf(own(ctx), ctx.browserLocation) : null);
  const items = await HelpCenter.find({ isActive: true, ...(input.type ? { type: input.type } : {}) }).limit(500).lean();
  const rows = items.map((h) => ({
    name: h.name, type: h.type, phone: h.phone || null, address: h.address || null, lat: h.location.lat, lng: h.location.lng,
    ...(origin ? { straightLineKm: Math.round(haversineKm(origin, h.location) * 100) / 100, links: places.linksFor(origin, h.location) } : {}),
  }));
  if (origin) rows.sort((a, b) => a.straightLineKm - b.straightLineKm);
  const out = rows.slice(0, input.limit ?? 5);
  ctx.collected.registered.push(...out.filter((r) => r.lat != null).map((r) => ({ ...r, registered: true })));
  return { source: 'STS registered help centers (admin-maintained)', totalRegistered: items.length, origin: origin ? { lat: origin.lat, lng: origin.lng, source: origin.source, stale: Boolean(origin.stale) } : null, helpCenters: out, note: items.length ? undefined : 'No help centers have been registered in STS yet.' };
}

async function toolNearbyZones(ctx, input) {
  const origin = resolvePoint(input, ctx.user.role === 'tourist' ? await positionOf(own(ctx), ctx.browserLocation) : null);
  if (!origin) throw new ToolError('NO_LOCATION: a location is required.');
  const types = input.types?.length ? input.types : ['safe'];
  const zones = await Zone.find({ isActive: true, type: { $in: types } }).select('name type riskLevel description geometry').limit(300).lean();
  const rows = zones.map((z) => { const c = centroid(z.geometry); return { name: z.name, type: z.type, riskLevel: z.riskLevel, description: z.description || null, centerLat: c.lat, centerLng: c.lng, centerDistanceKm: Math.round(haversineKm(origin, c) * 100) / 100 }; })
    .sort((a, b) => a.centerDistanceKm - b.centerDistanceKm).slice(0, input.limit ?? 5);
  const inside = await zonesAt(origin, types);
  return { source: 'Official STS zone definitions (admin-drawn)', origin: { lat: origin.lat, lng: origin.lng, source: origin.source, stale: Boolean(origin.stale) }, insideNow: inside, nearest: rows, totalZonesOfType: zones.length, note: `Distance is to the zone's center point (zones are areas). Zone data is distinct from hospitals/police found on OpenStreetMap. ${zones.length ? '' : 'No zones of this type are defined.'}` };
}

function toolGuide(ctx, input) {
  return { topic: input.topic, role: ctx.user.role, guide: guideFor(input.topic, ctx.user.role) };
}

// admin ────────────────────────────────────────────────────────────────────────

async function toolOverview() {
  const now = Date.now();
  const active = await Incident.find({ status: { $in: ACTIVE_STATUSES } }).select('status severity type priority escalatedAt createdAt timeline updatedAt lastActivity').lean();
  const count = (key) => active.reduce((m, i) => ({ ...m, [i[key]]: (m[i[key]] || 0) + 1 }), {});
  const sosOpen = await SOSEvent.countDocuments({ status: { $in: ['active', 'acknowledged'] } });
  const sosUnack = await SOSEvent.countDocuments({ status: 'active' });
  const since = new Date(now - 24 * 3600 * 1000);
  const resolved24h = await Incident.countDocuments({ status: { $in: ['resolved', 'closed'] }, resolvedAt: { $gte: since } });
  const devices = await Device.find({ tourist: { $ne: null } }).select('lastSeen status battery').lean();
  const fresh = (d) => (d.lastSeen ? now - new Date(d.lastSeen).getTime() : Infinity);
  const risk = await RiskAssessment.aggregate([{ $sort: { evaluatedAt: -1 } }, { $group: { _id: '$tourist', level: { $first: '$level' }, at: { $first: '$evaluatedAt' } } }, { $match: { level: { $in: ['high', 'critical'] }, at: { $gte: new Date(now - thresholds.risk.outdatedMs) } } }, { $count: 'n' }]);
  return {
    asOf: new Date().toISOString(),
    activeSos: { open: sosOpen, notYetAcknowledged: sosUnack },
    activeIncidents: { total: active.length, byStatus: count('status'), bySeverity: count('severity'), byType: count('type'), escalated: active.filter((i) => i.escalatedAt).length, overdue: active.filter((i) => isOverdue(i)).length },
    resolvedLast24h: resolved24h,
    devices: { total: devices.length, live: devices.filter((d) => fresh(d) <= thresholds.device.liveMs).length, stale: devices.filter((d) => fresh(d) > thresholds.device.liveMs && fresh(d) <= thresholds.device.staleMs).length, offline: devices.filter((d) => fresh(d) > thresholds.device.staleMs).length, inEmergency: devices.filter((d) => d.status === 'emergency').length },
    touristsAtHighOrCriticalRiskNow: risk[0]?.n || 0,
    note: 'Counts include simulated (demo) data when present; list_incidents shows which items are simulated.',
  };
}

async function toolListIncidents(ctx, input) {
  const state = input.state || 'active';
  const filter = { ...(state === 'active' ? { status: { $in: ACTIVE_STATUSES } } : state === 'history' ? { status: { $in: ['resolved', 'closed'] } } : {}) };
  if (input.severity) filter.severity = input.severity;
  if (input.type) filter.type = input.type;
  if (input.escalated) filter.escalatedAt = { $ne: null };
  if (input.status) filter.status = input.status;
  const list = await incidentList(filter, input.limit ?? 10);
  return { asOf: new Date().toISOString(), filter: { state, ...input }, returned: list.length, incidents: list };
}

async function toolGetIncident(ctx, input) {
  const q = String(input.id).trim();
  let incident = null;
  if (/^[0-9a-f]{24}$/i.test(q)) incident = await Incident.findById(q);
  else if (/^[0-9a-f]{4,23}$/i.test(q)) {
    const recent = await Incident.find().select('_id').sort({ createdAt: -1 }).limit(500).lean();
    const hit = recent.find((r) => String(r._id).endsWith(q.toLowerCase()));
    if (hit) incident = await Incident.findById(hit._id);
  }
  if (!incident) throw new ToolError('Incident not found. Use list_incidents to find its id.');
  await incident.populate('tourist', 'name isDemo');
  await incident.populate('assignedAdmin', 'name role');
  const refs = [incident._id, incident.sourceRef?.refId].filter(Boolean);
  const [proofs, sos] = await Promise.all([
    AuditProof.find({ eventRef: { $in: refs } }).select('eventType chainRef.sequenceNo createdAt').sort({ createdAt: 1 }).limit(20).lean(),
    incident.sourceRef?.refModel === 'SOSEvent' ? SOSEvent.findById(incident.sourceRef.refId).select('source status location createdAt acknowledgedAt resolvedAt').lean() : null,
  ]);
  const o = incident.toObject();
  return {
    asOf: new Date().toISOString(),
    ...incidentRow(o),
    resolution: o.resolution || null, resolvedAt: iso(o.resolvedAt), closedAt: iso(o.closedAt), evidenceCount: (o.evidence || []).length,
    sos: sos ? { source: sos.source, status: sos.status, location: sos.location, triggeredAt: iso(sos.createdAt), acknowledgedAt: iso(sos.acknowledgedAt) } : null,
    timeline: (o.timeline || []).slice(-20).map((t) => ({ at: iso(t.at), by: t.actorLabel, action: t.action, note: t.metadata?.note ? String(t.metadata.note).slice(0, 200) : undefined, relatedEvent: t.metadata?.correlated ? t.metadata.sourceModel : undefined })),
    timelineEntriesTotal: (o.timeline || []).length,
    auditProofs: proofs.map((p) => ({ event: p.eventType, sequenceNo: p.chainRef?.sequenceNo, at: iso(p.createdAt) })),
    risk: await riskOf(o.tourist?._id || o.tourist),
  };
}

async function toolResponders() {
  const users = await User.find({ role: { $in: ['admin', 'responder'] }, isActive: { $ne: false } }).select('name role isDemo').lean();
  const active = await Incident.find({ assignedAdmin: { $in: users.map((u) => u._id) }, status: { $in: ACTIVE_STATUSES } }).populate('tourist', 'name').select('assignedAdmin status severity type tourist').lean();
  return {
    asOf: new Date().toISOString(),
    people: users.map((u) => ({ name: u.name, role: u.role, simulated: Boolean(u.isDemo), activeAssignments: active.filter((i) => String(i.assignedAdmin) === String(u._id)).map((i) => ({ shortId: shortId(i._id), status: i.status, severity: i.severity, type: i.type, tourist: i.tourist?.name })) })),
    note: 'There is no responder "availability" or on-duty status in STS; this shows current workload only.',
  };
}

async function toolTouristStatus(ctx, input) {
  const q = String(input.name_or_id).trim();
  const filter = /^[0-9a-f]{24}$/i.test(q) ? { _id: q } : { name: new RegExp(escapeRegex(q.slice(0, 60)), 'i') };
  const users = await User.find({ role: 'tourist', ...filter }).select('name isDemo').limit(4).lean();
  if (!users.length) throw new ToolError('No tourist matched that name.');
  const out = [];
  for (const u of users) {
    const s = await toolMyStatus({ ...ctx, user: { id: String(u._id), role: 'tourist' }, browserLocation: null });
    out.push({ tourist: u.name, id: String(u._id), simulated: Boolean(u.isDemo), ...s });
  }
  return { asOf: new Date().toISOString(), matches: out.length, tourists: out, note: users.length > 1 ? 'Several tourists matched; confirm which one is meant.' : undefined };
}

async function toolDevicesAttention() {
  const now = Date.now();
  const devices = await Device.find({ tourist: { $ne: null } }).populate('tourist', 'name').select('deviceId type status battery lastSeen isSimulated tourist').lean();
  const rows = devices.map((d) => {
    const age = d.lastSeen ? now - new Date(d.lastSeen).getTime() : Infinity;
    const freshness = age <= thresholds.device.liveMs ? 'live' : age <= thresholds.device.staleMs ? 'stale' : 'offline';
    return { deviceId: d.deviceId, tourist: d.tourist?.name || null, type: d.type, status: d.status, battery: d.battery, freshness, lastSeen: iso(d.lastSeen), minutesSinceLastSeen: ageMin(d.lastSeen), lowBattery: typeof d.battery === 'number' && d.battery <= thresholds.risk.lowBattery, simulated: Boolean(d.isSimulated) };
  });
  const attention = rows.filter((r) => r.freshness !== 'live' || r.lowBattery || r.status === 'emergency');
  return { asOf: new Date().toISOString(), totalDevices: rows.length, needingAttention: attention.length, devices: attention.slice(0, 15), note: 'Stale = no ping for over 2 minutes; offline = over 15 minutes.' };
}

async function toolGeofenceEvents(ctx, input) {
  const filter = {};
  if (input.tourist_name) {
    const ids = (await User.find({ role: 'tourist', name: new RegExp(escapeRegex(String(input.tourist_name).slice(0, 60)), 'i') }).select('_id').limit(10).lean()).map((u) => u._id);
    filter.tourist = { $in: ids };
  }
  const events = await GeofenceEvent.find(filter).populate('tourist', 'name').populate('zone', 'name type').sort({ createdAt: -1 }).limit(input.limit ?? 10).lean();
  return { asOf: new Date().toISOString(), events: events.map((e) => ({ at: iso(e.createdAt), tourist: e.tourist?.name, zone: e.zone?.name, zoneType: e.zone?.type, event: e.eventType })) };
}

async function toolHealth() {
  return getHealthDetails();
}

async function toolAllZones() {
  const zones = await Zone.find().select('name type riskLevel isActive').limit(200).lean();
  return { asOf: new Date().toISOString(), total: zones.length, zones: zones.map((z) => ({ name: z.name, type: z.type, riskLevel: z.riskLevel, active: z.isActive })) };
}

// ── registry ────────────────────────────────────────────────────────────────────

const J = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const catsProp = { type: 'array', items: { type: 'string', enum: Object.keys(places.CATEGORIES) }, description: 'Facility categories to search for' };

const SHARED = [
  {
    name: 'find_nearby_places',
    description: 'Find REAL nearby facilities (hospitals, clinics, police stations, pharmacies, fire stations, ambulance stations) from OpenStreetMap, even if they are not registered in STS. Distances are straight-line. For tourists it searches around their own latest location unless lat/lng (from the user naming a place, via geocode_place) are given.',
    input_schema: J({ categories: catsProp, radius_m: { type: 'integer', minimum: 200, maximum: places.MAX_RADIUS_M }, limit: { type: 'integer', minimum: 1, maximum: 8 }, lat: { type: 'number' }, lng: { type: 'number' } }, ['categories']),
    schema: z.object({ categories: z.array(CAT).min(1).max(6), radius_m: z.number().int().min(200).max(places.MAX_RADIUS_M).optional(), limit: z.number().int().min(1).max(8).optional(), lat: lat.optional(), lng: lng.optional() }),
    run: toolNearbyPlaces,
  },
  {
    name: 'geocode_place',
    description: 'Turn a place name or address typed by the user into coordinates (OpenStreetMap Nominatim). Use it when the user gives a manual location.',
    input_schema: J({ query: { type: 'string' } }, ['query']),
    schema: z.object({ query: z.string().min(2).max(160) }),
    run: toolGeocode,
  },
  {
    name: 'get_route',
    description: 'Real walking or driving distance and time to a destination from OpenStreetMap routing. Tourists start from their own location unless from_lat/from_lng are given; admins must give both points.',
    input_schema: J({ to_lat: { type: 'number' }, to_lng: { type: 'number' }, from_lat: { type: 'number' }, from_lng: { type: 'number' }, mode: { type: 'string', enum: ['foot', 'driving'] } }, ['to_lat', 'to_lng']),
    schema: z.object({ to_lat: lat, to_lng: lng, from_lat: lat.optional(), from_lng: lng.optional(), mode: z.enum(['foot', 'driving']).optional() }),
    run: toolRoute,
  },
  {
    name: 'list_registered_help_centers',
    description: 'Help centers registered inside STS by admins (hospitals, police, etc.). Nearest first when a location is known. This is STS data, separate from OpenStreetMap results.',
    input_schema: J({ type: { type: 'string', enum: ['hospital', 'police', 'fire', 'embassy', 'pharmacy', 'emergency', 'other'] }, limit: { type: 'integer', minimum: 1, maximum: 10 }, lat: { type: 'number' }, lng: { type: 'number' } }),
    schema: z.object({ type: z.enum(['hospital', 'police', 'fire', 'embassy', 'pharmacy', 'emergency', 'other']).optional(), limit: z.number().int().min(1).max(10).optional(), lat: lat.optional(), lng: lng.optional() }),
    run: toolHelpCenters,
  },
  {
    name: 'list_nearby_zones',
    description: 'Official STS geofence zones (types: safe, restricted, danger) nearest to a location, and which of them contain the location right now. "Safe zones" are ONLY these admin-defined zones, never hospitals or police stations.',
    input_schema: J({ types: { type: 'array', items: { type: 'string', enum: ['safe', 'restricted', 'danger'] } }, limit: { type: 'integer', minimum: 1, maximum: 10 }, lat: { type: 'number' }, lng: { type: 'number' } }),
    schema: z.object({ types: z.array(z.enum(['safe', 'restricted', 'danger'])).max(3).optional(), limit: z.number().int().min(1).max(10).optional(), lat: lat.optional(), lng: lng.optional() }),
    run: toolNearbyZones,
  },
  {
    name: 'get_app_guide',
    description: 'Factual description of how an STS feature works (SOS, geofencing, safety check-ins, risk scoring, incident lifecycle, help centers, language), to explain it accurately.',
    input_schema: J({ topic: { type: 'string', enum: TOPICS } }, ['topic']),
    schema: z.object({ topic: z.enum(TOPICS) }),
    run: toolGuide,
  },
];

const TOURIST_ONLY = [
  {
    name: 'get_my_status',
    description: "The signed-in tourist's OWN current status: last known location (with age and staleness), device, geofence zones they are in, risk level, active SOS and incidents. Refreshed on every call.",
    input_schema: J({}),
    schema: z.object({}),
    run: toolMyStatus,
  },
];

const ADMIN_ONLY = [
  { name: 'get_operations_overview', description: 'Live counts: active SOS, active incidents by status/severity/type, escalated and overdue incidents, device freshness, tourists at high risk. Use for "what is happening now".', input_schema: J({}), schema: z.object({}), run: toolOverview },
  {
    name: 'list_incidents',
    description: 'List incidents (most severe first). state: active (default), history (resolved/closed) or all. Includes status, severity, assignee, escalation and overdue flags.',
    input_schema: J({ state: { type: 'string', enum: ['active', 'history', 'all'] }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, type: { type: 'string', enum: ['sos', 'geofence_violation', 'no_response', 'risk_escalation', 'other'] }, status: { type: 'string', enum: ['open', 'in_progress', 'assigned', 'en_route', 'resolved', 'closed'] }, escalated: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 15 } }),
    schema: z.object({ state: z.enum(['active', 'history', 'all']).optional(), severity: z.enum(['low', 'medium', 'high', 'critical']).optional(), type: z.enum(['sos', 'geofence_violation', 'no_response', 'risk_escalation', 'other']).optional(), status: z.enum(['open', 'in_progress', 'assigned', 'en_route', 'resolved', 'closed']).optional(), escalated: z.boolean().optional(), limit: z.number().int().min(1).max(15).optional() }),
    run: toolListIncidents,
  },
  { name: 'get_incident', description: 'Full detail of one incident: timeline (what happened and when), assignment, escalation reason, SOS source, related events, audit proofs, risk. Accepts the full id or the 8-character short id.', input_schema: J({ id: { type: 'string' } }, ['id']), schema: z.object({ id: z.string().min(4).max(24) }), run: toolGetIncident },
  { name: 'list_responders', description: 'Admins and responders with their current active incident assignments.', input_schema: J({}), schema: z.object({}), run: toolResponders },
  { name: 'get_tourist_status', description: "Current status of a tourist (by name or id): location with age, device, zones, risk with reasons, active incidents.", input_schema: J({ name_or_id: { type: 'string' } }, ['name_or_id']), schema: z.object({ name_or_id: z.string().min(2).max(60) }), run: toolTouristStatus },
  { name: 'list_devices_needing_attention', description: 'Devices that are stale/offline, low on battery, or in emergency mode, with how long since they last reported.', input_schema: J({}), schema: z.object({}), run: toolDevicesAttention },
  { name: 'get_recent_geofence_events', description: 'Recent zone enter/exit events, optionally for one tourist (by name).', input_schema: J({ tourist_name: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }), schema: z.object({ tourist_name: z.string().max(60).optional(), limit: z.number().int().min(1).max(20).optional() }), run: toolGeofenceEvents },
  { name: 'get_system_health', description: 'Backend health: database, real-time service, SMS configuration/outcomes, device location freshness, scheduler, recent failures. Each component is healthy/degraded/unavailable/unknown.', input_schema: J({}), schema: z.object({}), run: toolHealth },
  { name: 'list_all_zones', description: 'All defined geofence zones (name, type, risk level, active).', input_schema: J({}), schema: z.object({}), run: toolAllZones },
];

const REGISTRY = { admin: [...ADMIN_ONLY, ...SHARED], tourist: [...TOURIST_ONLY, ...SHARED] };

/** Tool definitions the model is told about, for this role only. */
const definitionsFor = (role) => (REGISTRY[role] || []).map(({ name, description, input_schema }) => ({ name, description, input_schema }));

/**
 * Runs one tool call requested by the model. Re-checks the role every time (the model can only ask
 * for tools it was shown, but we never rely on that). Returns { content, isError }.
 */
async function runTool(name, rawInput, ctx) {
  const tool = (REGISTRY[ctx.user.role] || []).find((t) => t.name === name);
  if (!tool) return { content: JSON.stringify({ error: 'This information is not available for your role.' }), isError: true };
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) return { content: JSON.stringify({ error: `Invalid input: ${parsed.error.issues[0]?.message || 'bad arguments'}` }), isError: true };
  ctx.collected.toolsUsed.push(name);
  try {
    const data = await tool.run(ctx, parsed.data);
    let text = JSON.stringify({ retrievedAt: new Date().toISOString(), data });
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}…[truncated]`;
    return { content: text, isError: false };
  } catch (err) {
    const message = err instanceof ToolError || err instanceof places.PlacesError || err instanceof geocode.GeocodeError ? err.message : 'The lookup failed unexpectedly.';
    if (!(err instanceof ToolError || err instanceof places.PlacesError || err instanceof geocode.GeocodeError)) console.error('[copilot] tool failed:', name, err.message);
    ctx.collected.failures.push({ tool: name, message });
    return { content: JSON.stringify({ error: message, lookupSucceeded: false }), isError: true };
  }
}

module.exports = { definitionsFor, runTool, positionOf };
