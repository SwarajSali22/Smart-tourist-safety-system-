const { Incident, SOSEvent, GeofenceEvent, Zone } = require('../models');

const DAYS = 14;

// The day buckets below are built from the server's LOCAL calendar days, so the
// Mongo grouping must use the same UTC offset (e.g. "+05:30"); grouping by UTC
// would put an incident at 00:20 local on the previous day.
function localOffset() {
  const mins = -new Date().getTimezoneOffset();
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// ── GET /api/analytics/overview  (admin) ─────────────────────────────────────
async function overview(req, res, next) {
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (DAYS - 1));

    const [byDayRaw, byType, sosPoints, geoPoints, ackStats, zoneEntries] = await Promise.all([
      Incident.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: localOffset() } }, count: { $sum: 1 } } },
      ]),
      Incident.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      SOSEvent.find().sort({ createdAt: -1 }).limit(300).select('location createdAt source').lean(),
      GeofenceEvent.find({ eventType: 'enter' }).sort({ createdAt: -1 }).limit(300).select('location createdAt').lean(),
      SOSEvent.aggregate([
        { $match: { acknowledgedAt: { $ne: null } } },
        { $project: { ms: { $subtract: ['$acknowledgedAt', '$createdAt'] } } },
        { $group: { _id: null, avgMs: { $avg: '$ms' }, n: { $sum: 1 } } },
      ]),
      GeofenceEvent.aggregate([
        { $match: { eventType: 'enter' } },
        { $group: { _id: '$zone', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const counts = new Map(byDayRaw.map((d) => [d._id, d.count]));
    const incidentsByDay = [];
    for (let i = 0; i < DAYS; i += 1) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
      incidentsByDay.push({ date: key, count: counts.get(key) || 0 });
    }

    const zones = await Zone.find({ _id: { $in: zoneEntries.map((z) => z._id) } }).select('name type').lean();
    const zoneById = new Map(zones.map((z) => [String(z._id), z]));
    const riskiestZones = zoneEntries
      .filter((z) => zoneById.has(String(z._id)))
      .map((z) => ({ zone: zoneById.get(String(z._id)).name, type: zoneById.get(String(z._id)).type, entries: z.count }));

    const heatPoints = [
      ...sosPoints.filter((p) => p.location?.lat != null).map((p) => ({ lat: p.location.lat, lng: p.location.lng, weight: 3 })),
      ...geoPoints.filter((p) => p.location?.lat != null).map((p) => ({ lat: p.location.lat, lng: p.location.lng, weight: 1 })),
    ];

    return res.json({
      success: true,
      incidentsByDay,
      incidentsByType: byType.map((t) => ({ type: t._id, count: t.count })),
      riskiestZones,
      heatPoints,
      avgAckMinutes: ackStats[0] ? Math.round((ackStats[0].avgMs / 60000) * 10) / 10 : null,
      ackSamples: ackStats[0]?.n || 0,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { overview };
