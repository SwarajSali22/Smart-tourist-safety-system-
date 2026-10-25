const { Zone, SOSEvent } = require('../../models');
const { haversineKm } = require('../geo/haversine');

/**
 * Route risk assessment. Candidate routes come from an OSRM-compatible routing service
 * (ROUTING_BASE_URL, default the public OSRM demo server — driving profile, best-effort, no SLA).
 * Each route is measured against the zones the administrators have configured (restricted /
 * danger) and against recent SOS locations. The result is an ESTIMATE from that data only:
 * it never labels a route "safe", and when no routing data is available it falls back to a
 * clearly labelled straight line.
 */

const BASE = () => process.env.ROUTING_BASE_URL || 'https://router.project-osrm.org';
const TIMEOUT_MS = 7000;
const SAMPLE_M = 75;               // spacing of points checked along a route
const SOS_NEAR_M = 300;            // an SOS this close to the route is mentioned
const SOS_WINDOW_MS = 30 * 24 * 3600 * 1000;
const RISKY = ['restricted', 'danger'];

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > pt.lat) !== (yj > pt.lat) && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inZone = (pt, zone) => {
  const rings = zone.geometry?.coordinates || [];
  if (!rings.length || !pointInRing(pt, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(pt, hole)); // holes excluded
};

/** Re-samples a [lng,lat] line so consecutive points are at most SAMPLE_M apart. */
function densify(coords) {
  const out = [];
  for (let i = 0; i < coords.length; i += 1) {
    const a = { lng: coords[i][0], lat: coords[i][1] };
    out.push(a);
    const b = coords[i + 1] && { lng: coords[i + 1][0], lat: coords[i + 1][1] };
    if (!b) continue;
    const d = haversineKm(a, b) * 1000;
    const n = Math.floor(d / SAMPLE_M);
    for (let k = 1; k <= n; k += 1) {
      const t = k / (n + 1);
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }
  return out;
}

async function fetchRoutes(from, to, fetchImpl = fetch) {
  const url = `${BASE()}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=true`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': process.env.GEOCODE_USER_AGENT || 'STS-SmartTouristSafety/1.0' } });
    if (!res.ok) throw new Error(`routing service answered ${res.status}`);
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) throw new Error('no route found');
    return json.routes.map((r) => ({ coordinates: r.geometry.coordinates, distanceM: r.distance, durationS: r.duration }));
  } finally {
    clearTimeout(timer);
  }
}

function assess(route, zones, sosPoints) {
  const pts = densify(route.coordinates);
  const hits = new Map();
  let exposureM = 0; let weighted = 0;
  pts.forEach((p, idx) => {
    const seg = idx === 0 ? 0 : haversineKm(pts[idx - 1], p) * 1000;
    for (const z of zones) {
      if (inZone(p, z)) {
        const h = hits.get(String(z._id)) || { zoneId: String(z._id), name: z.name, type: z.type, riskLevel: z.riskLevel || 0, metres: 0 };
        h.metres += seg;
        hits.set(String(z._id), h);
        exposureM += seg;
        weighted += seg * ((z.riskLevel || (z.type === 'danger' ? 80 : 40)) / 100);
      }
    }
  });
  const nearSos = sosPoints.filter((s) => pts.some((p, i) => i % 2 === 0 && haversineKm(p, s) * 1000 <= SOS_NEAR_M)).length;
  return {
    distanceM: Math.round(route.distanceM), durationS: Math.round(route.durationS || 0),
    coordinates: route.coordinates.map(([lng, lat]) => [lat, lng]),
    zones: [...hits.values()].map((h) => ({ ...h, metres: Math.round(h.metres) })).sort((a, b) => b.metres - a.metres),
    exposureM: Math.round(exposureM), exposureScore: Math.round(weighted),
    recentSosNearby: nearSos,
  };
}

const levelOf = (r) => (r.zones.some((z) => z.type === 'danger') ? 'high' : r.zones.length ? 'elevated' : 'none-found');

/**
 * @returns {Promise<object>} { source, routes[], recommendedIndex, message, disclaimer }
 */
async function assessRoute(from, to, { fetchImpl } = {}) {
  const [zones, sos] = await Promise.all([
    Zone.find({ isActive: true, type: { $in: RISKY } }).select('name type riskLevel geometry').lean(),
    SOSEvent.find({ createdAt: { $gte: new Date(Date.now() - SOS_WINDOW_MS) } }).select('location').lean(),
  ]);
  const sosPoints = sos.filter((s) => s.location?.lat != null).map((s) => s.location);

  let candidates; let source = 'routing_service'; let note = null;
  try {
    candidates = await fetchRoutes(from, to, fetchImpl);
  } catch (err) {
    source = 'straight_line';
    note = 'Road routing data is unavailable right now, so only the straight line between the two points was checked. Real roads may differ.';
    candidates = [{ coordinates: [[from.lng, from.lat], [to.lng, to.lat]], distanceM: haversineKm(from, to) * 1000, durationS: 0 }];
  }

  const routes = candidates.slice(0, 3).map((c, i) => {
    const a = assess(c, zones, sosPoints);
    return { ...a, index: i, label: i === 0 ? 'Fastest route' : `Alternative ${i}`, exposureLevel: levelOf(a) };
  });

  // lowest exposure wins; ties go to the shorter one
  const best = routes.reduce((b, r) => (r.exposureScore < b.exposureScore || (r.exposureScore === b.exposureScore && r.distanceM < b.distanceM) ? r : b), routes[0]);
  const fastest = routes[0];
  let message;
  if (fastest.zones.length === 0) {
    message = 'No configured restricted or danger zone lies on this route. That does not mean the route is safe — it only reflects the zones administrators have drawn.';
  } else if (best.index !== 0 && best.exposureScore < fastest.exposureScore) {
    message = `The fastest route passes through ${fastest.zones.length} configured zone(s). "${best.label}" has lower estimated exposure to them (${best.exposureM} m versus ${fastest.exposureM} m).`;
  } else {
    message = `This route passes through ${fastest.zones.length} configured restricted/danger zone(s)${routes.length > 1 ? ', and none of the alternatives avoids them any better' : ' and no alternative route was available'}.`;
  }
  return {
    source, routes, recommendedIndex: best.index, message, note,
    zonesConsidered: zones.length,
    disclaimer: 'Estimate based only on zones configured by administrators and recorded SOS locations from the last 30 days. It is not live crime or traffic data and no route is guaranteed safe.',
  };
}

module.exports = { assessRoute, densify, inZone, assess };
