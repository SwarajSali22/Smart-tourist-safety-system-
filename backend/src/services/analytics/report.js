const mongoose = require('mongoose');
const { Incident, SOSEvent, GeofenceEvent, Zone, User } = require('../../models');
const { haversineKm } = require('../geo/haversine');
const { isOverdue } = require('../incidents/lifecycle');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MAX_INCIDENTS = 20000;
const PRESETS = { '24h': 24 * HOUR, '7d': 7 * DAY, '30d': 30 * DAY };
const ACTIVE = ['open', 'in_progress', 'assigned', 'en_route'];

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (a) => (a.length ? round1(a.reduce((s, v) => s + v, 0) / a.length) : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return round1(s[Math.floor(s.length / 2)]);
};

/** Resolves { range: 24h|7d|30d|custom, from, to } into [start, end) — custom is capped at 92 days. */
function resolveWindow(q, now = Date.now()) {
  const range = PRESETS[q.range] ? q.range : q.from ? 'custom' : '7d';
  if (range !== 'custom') return { range, start: new Date(now - PRESETS[range]), end: new Date(now) };
  let start = new Date(q.from);
  let end = q.to ? new Date(q.to) : new Date(now);
  if (Number.isNaN(start.getTime())) start = new Date(now - 7 * DAY);
  if (Number.isNaN(end.getTime())) end = new Date(now);
  // a date-only "to" means the whole of that day
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) end = new Date(end.getTime() + DAY);
  if (end > new Date(now + DAY)) end = new Date(now);
  if (start >= end) start = new Date(end.getTime() - DAY);
  if (end - start > 92 * DAY) start = new Date(end.getTime() - 92 * DAY);
  return { range: 'custom', start, end };
}

/** Which Incident rows belong to the requested filters (including the optional circular area). */
async function loadIncidents({ start, end }, f) {
  const match = { createdAt: { $gte: start, $lt: end } };
  if (f.type?.length) match.type = { $in: f.type };
  if (f.severity?.length) match.severity = { $in: f.severity };
  if (f.status?.length) match.status = { $in: f.status };
  if (f.tourist) match.tourist = new mongoose.Types.ObjectId(f.tourist);
  let rows = await Incident.find(match)
    .select('type severity priority status tourist createdAt resolvedAt closedAt escalatedAt assignedAdmin sourceRef timeline updatedAt')
    .sort({ createdAt: 1 }).limit(MAX_INCIDENTS).lean();

  if (f.area) {
    const inArea = (loc) => loc?.lat != null && haversineKm(loc, f.area) <= f.area.radiusKm;
    const sosIds = rows.filter((r) => r.sourceRef?.refModel === 'SOSEvent').map((r) => r.sourceRef.refId);
    const geoIds = rows.filter((r) => r.sourceRef?.refModel === 'GeofenceEvent').map((r) => r.sourceRef.refId);
    const [sos, geo] = await Promise.all([
      SOSEvent.find({ _id: { $in: sosIds } }).select('location').lean(),
      GeofenceEvent.find({ _id: { $in: geoIds } }).select('location').lean(),
    ]);
    const ok = new Set([...sos, ...geo].filter((e) => inArea(e.location)).map((e) => String(e._id)));
    // Incidents with no recorded location (e.g. missed check-ins) cannot be placed in an area and are excluded.
    rows = rows.filter((r) => r.sourceRef?.refId && ok.has(String(r.sourceRef.refId)));
  }
  return rows;
}

function ackMinutes(i) {
  const e = (i.timeline || []).find((t) => t.metadata?.to === 'in_progress');
  return e ? (new Date(e.at) - new Date(i.createdAt)) / 60000 : null;
}
const resolveMinutes = (i) => (i.resolvedAt ? (new Date(i.resolvedAt) - new Date(i.createdAt)) / 60000 : null);

function summarise(rows, geoViolations, now) {
  const acks = rows.map(ackMinutes).filter((v) => v != null && v >= 0);
  const res = rows.map(resolveMinutes).filter((v) => v != null && v >= 0);
  return {
    totalIncidents: rows.length,
    resolvedIncidents: rows.filter((r) => ['resolved', 'closed'].includes(r.status)).length,
    activeIncidents: rows.filter((r) => ACTIVE.includes(r.status)).length,
    escalatedIncidents: rows.filter((r) => r.escalatedAt).length,
    overdueIncidents: rows.filter((r) => ACTIVE.includes(r.status) && isOverdue(r, now)).length,
    geofenceViolations: geoViolations,
    avgResponseMin: mean(acks), medianResponseMin: median(acks), responseSamples: acks.length,
    avgResolutionMin: mean(res), medianResolutionMin: median(res), resolutionSamples: res.length,
  };
}

async function countViolations({ start, end }, f) {
  const match = { eventType: 'enter', createdAt: { $gte: start, $lt: end } };
  if (f.tourist) match.tourist = new mongoose.Types.ObjectId(f.tourist);
  const events = await GeofenceEvent.find(match).select('zone location').limit(20000).lean();
  const zones = await Zone.find({ _id: { $in: [...new Set(events.map((e) => String(e.zone)))] } }).select('name type').lean();
  const zoneById = new Map(zones.map((z) => [String(z._id), z]));
  const risky = events.filter((e) => zoneById.get(String(e.zone))?.type !== 'safe'
    && (!f.area || (e.location?.lat != null && haversineKm(e.location, f.area) <= f.area.radiusKm)));
  const perZone = new Map();
  risky.forEach((e) => perZone.set(String(e.zone), (perZone.get(String(e.zone)) || 0) + 1));
  return {
    count: risky.length,
    byZone: [...perZone.entries()].map(([id, entries]) => ({ zoneId: id, zone: zoneById.get(id)?.name || 'Deleted zone', type: zoneById.get(id)?.type || 'unknown', entries })).sort((a, b) => b.entries - a.entries),
  };
}

function trendBuckets(rows, { start, end }) {
  const span = end - start;
  const hourly = span <= 2 * DAY + HOUR;
  const step = hourly ? HOUR : DAY;
  const buckets = [];
  const first = hourly ? new Date(start) : new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (hourly) first.setMinutes(0, 0, 0);
  for (let t = first.getTime(); t < end.getTime(); t += step) {
    const d = new Date(t);
    buckets.push({
      t, count: 0,
      label: hourly ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      from: new Date(t).toISOString(), to: new Date(Math.min(t + step, end.getTime())).toISOString(),
    });
  }
  const idx = (ms) => Math.floor((ms - first.getTime()) / step);
  rows.forEach((r) => { const b = buckets[idx(new Date(r.createdAt).getTime())]; if (b) b.count += 1; });
  return { granularity: hourly ? 'hour' : 'day', buckets };
}

const tally = (rows, key) => {
  const m = new Map();
  rows.forEach((r) => m.set(r[key], (m.get(r[key]) || 0) + 1));
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
};

const pct = (cur, prev) => (prev ? round1(((cur - prev) / prev) * 100) : cur ? null : 0);

async function buildReport(q, now = Date.now()) {
  const win = resolveWindow(q, now);
  const f = { type: q.type || [], severity: q.severity || [], status: q.status || [], tourist: q.tourist || null, area: q.area || null };
  const prevWin = { start: new Date(win.start - (win.end - win.start)), end: win.start };

  const [rows, viol, prevRows, prevViol, activeSos, touristDoc] = await Promise.all([
    loadIncidents(win, f), countViolations(win, f),
    loadIncidents(prevWin, f), countViolations(prevWin, f),
    SOSEvent.countDocuments({ status: { $in: ['active', 'acknowledged'] } }),
    f.tourist ? User.findById(f.tourist).select('name').lean() : null,
  ]);

  const summary = { ...summarise(rows, viol.count, now), activeSos };
  const previous = summarise(prevRows, prevViol.count, now);
  const comparison = {
    period: { from: prevWin.start.toISOString(), to: prevWin.end.toISOString() },
    previous,
    changePct: {
      totalIncidents: pct(summary.totalIncidents, previous.totalIncidents),
      resolvedIncidents: pct(summary.resolvedIncidents, previous.resolvedIncidents),
      geofenceViolations: pct(summary.geofenceViolations, previous.geofenceViolations),
      avgResponseMin: summary.avgResponseMin != null && previous.avgResponseMin ? pct(summary.avgResponseMin, previous.avgResponseMin) : null,
    },
  };

  return {
    range: { preset: win.range, from: win.start.toISOString(), to: win.end.toISOString() },
    filters: { ...f, touristName: touristDoc?.name || null },
    summary, comparison,
    trend: trendBuckets(rows, win),
    severity: tally(rows, 'severity'),
    categories: tally(rows, 'type'),
    statuses: tally(rows, 'status'),
    priorities: tally(rows, 'priority'),
    zoneViolations: viol.byZone.slice(0, 8),
    responseTimes: {
      acknowledge: { avg: summary.avgResponseMin, median: summary.medianResponseMin, n: summary.responseSamples },
      resolve: { avg: summary.avgResolutionMin, median: summary.medianResolutionMin, n: summary.resolutionSamples },
    },
    truncated: rows.length >= MAX_INCIDENTS,
    _rows: rows,
  };
}

module.exports = { buildReport, resolveWindow, loadIncidents, ackMinutes, resolveMinutes };
