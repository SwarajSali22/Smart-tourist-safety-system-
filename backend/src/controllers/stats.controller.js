const { User, Zone, Incident } = require('../models');

const CACHE_MS = 30 * 1000;
let cache = null; // { at: number, data: {...} }

// ── GET /api/stats  (public) ─────────────────────────────────────────────────
// Aggregate counts only — no personal data. Cached in memory for 30 s so the
// landing page can't hammer the database.
async function getPublicStats(req, res, next) {
  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      const [touristsProtected, activeZones, incidentsResolved] = await Promise.all([
        User.countDocuments({ role: 'tourist', isActive: { $ne: false } }),
        Zone.countDocuments({ isActive: true }),
        Incident.countDocuments({ status: { $in: ['resolved', 'closed'] } }),
      ]);
      cache = { at: Date.now(), data: { touristsProtected, activeZones, incidentsResolved } };
    }
    res.set('Cache-Control', 'public, max-age=30');
    return res.json({ success: true, ...cache.data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getPublicStats };
