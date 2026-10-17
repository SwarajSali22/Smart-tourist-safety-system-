const { Incident, SOSEvent, GeofenceEvent, Zone, SafetyCheck } = require('../models');
const { isOverdue } = require('../services/incidents/lifecycle');

const DEFAULT_DAYS = 14;
const MAX_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

// The day buckets below are built from the server's LOCAL calendar days, so the
// Mongo grouping must use the same UTC offset (e.g. "+05:30"); grouping by UTC
// would put an incident at 00:20 local on the previous day.
function localOffset() {
  const mins = -new Date().getTimezoneOffset();
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const dayKey = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const minutes = (ms) => Math.round((ms / 60000) * 10) / 10;

function stats(msList) {
  if (msList.length === 0) return { n: 0, avgMin: null, medianMin: null, p90Min: null };
  const sorted = [...msList].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    avgMin: minutes(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    medianMin: minutes(at(0.5)),
    p90Min: minutes(at(0.9)),
  };
}

/** Resolves ?from=&to= (inclusive local days) into [start, end) dates, capped at 92 days. */
function resolveRange(query) {
  const end = query.to && !Number.isNaN(Date.parse(query.to)) ? new Date(query.to) : new Date();
  end.setHours(0, 0, 0, 0);
  const hasFrom = Boolean(query.from) && !Number.isNaN(Date.parse(query.from));
  let start = hasFrom ? new Date(query.from) : new Date(end);
  start.setHours(0, 0, 0, 0);
  if (!hasFrom) start.setDate(start.getDate() - (DEFAULT_DAYS - 1)); // missing or invalid → default window
  if (start > end) start = new Date(end);
  const days = Math.min(MAX_DAYS, Math.round((end - start) / DAY_MS) + 1);
  start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const exclusiveEnd = new Date(end.getTime() + DAY_MS);
  return { start, end: exclusiveEnd, days, lastDay: end };
}

// ── GET /api/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD  (admin) ────────
async function overview(req, res, next) {
  try {
    const { start, end, days } = resolveRange(req.query);
    const inRange = { $gte: start, $lt: end };

    const [byDayRaw, byType, incidentsInRange, sosInRange, checks, geoEnters] = await Promise.all([
      Incident.aggregate([
        { $match: { createdAt: inRange } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: localOffset() } }, count: { $sum: 1 } } },
      ]),
      Incident.aggregate([{ $match: { createdAt: inRange } }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Incident.find({ createdAt: inRange }).select('status severity createdAt resolvedAt closedAt timeline updatedAt').limit(5000).lean(),
      SOSEvent.find({ createdAt: inRange }).select('location createdAt acknowledgedAt resolvedAt source').limit(5000).lean(),
      SafetyCheck.find({ scheduledAt: inRange }).select('response respondedAt escalated').limit(10000).lean(),
      GeofenceEvent.find({ createdAt: inRange, eventType: 'enter' }).select('location zone').limit(5000).lean(),
    ]);

    // incidents per local day, zero-filled
    const counts = new Map(byDayRaw.map((d) => [d._id, d.count]));
    const incidentsByDay = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dayKey(d);
      incidentsByDay.push({ date: key, count: counts.get(key) || 0 });
    }

    // response times (SOS): time to acknowledge, time to resolve
    const ackMs = sosInRange.filter((s) => s.acknowledgedAt).map((s) => new Date(s.acknowledgedAt) - new Date(s.createdAt));
    const resolveMs = sosInRange.filter((s) => s.resolvedAt).map((s) => new Date(s.resolvedAt) - new Date(s.createdAt));
    const ack = stats(ackMs);
    const resolve = stats(resolveMs);

    // check-in response rate
    const answered = checks.filter((c) => c.respondedAt);
    const checkIns = {
      total: checks.length,
      answered: answered.length,
      safe: checks.filter((c) => c.response === 'safe').length,
      unsafe: checks.filter((c) => c.response === 'unsafe').length,
      unanswered: checks.filter((c) => !c.respondedAt).length,
      escalated: checks.filter((c) => c.escalated).length,
      responseRate: checks.length ? Math.round((answered.length / checks.length) * 1000) / 10 : null,
    };

    // by zone: entries into each zone in the range
    const perZone = new Map();
    geoEnters.forEach((g) => perZone.set(String(g.zone), (perZone.get(String(g.zone)) || 0) + 1));
    const zones = await Zone.find({ _id: { $in: [...perZone.keys()] } }).select('name type').lean();
    const byZone = zones
      .map((z) => ({ zone: z.name, type: z.type, entries: perZone.get(String(z._id)) || 0 }))
      .sort((a, b) => b.entries - a.entries);

    const nowMs = Date.now();
    const active = incidentsInRange.filter((i) => ['open', 'in_progress', 'assigned', 'en_route'].includes(i.status));
    const incidents = {
      total: incidentsInRange.length,
      active: active.length,
      overdue: active.filter((i) => isOverdue(i, nowMs)).length,
      resolved: incidentsInRange.filter((i) => ['resolved', 'closed'].includes(i.status)).length,
      critical: incidentsInRange.filter((i) => i.severity === 'critical').length,
    };

    const heatPoints = [
      ...sosInRange.filter((p) => p.location?.lat != null).map((p) => ({ lat: p.location.lat, lng: p.location.lng, weight: 3 })),
      ...geoEnters.filter((p) => p.location?.lat != null).map((p) => ({ lat: p.location.lat, lng: p.location.lng, weight: 1 })),
    ];

    return res.json({
      success: true,
      range: { from: dayKey(start), to: dayKey(new Date(end.getTime() - DAY_MS)), days },
      incidentsByDay,
      incidentsByType: byType.map((t) => ({ type: t._id, count: t.count })),
      riskiestZones: byZone.slice(0, 5),
      byZone,
      heatPoints,
      incidents,
      responseTimes: { acknowledge: ack, resolve },
      checkIns,
      // kept for older clients
      avgAckMinutes: ack.avgMin,
      ackSamples: ack.n,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { overview, resolveRange, stats };
