const { Zone } = require('../../models');
const thresholds = require('../../config/thresholds');
const { notifyAdmins, notifyUser } = require('../notifications/notify');
const { User } = require('../../models');

/**
 * "You are approaching a restricted / danger zone": an early warning BEFORE the boundary, using the real distance
 * to the zone edge (2dsphere $geoNear), the configured threshold and the GPS accuracy.
 *
 *  - Only restricted/danger zones that are active, and only while the tourist is still outside (distance > 0;
 *    entering is handled by the geofence enter event).
 *  - A fix with unknown or poor accuracy (> maxAccuracyM) never warns: it could be a false alarm from GPS jitter.
 *  - The edge must be within `thresholds.risk.proximityM` even after allowing for the accuracy radius being on
 *    the far side, i.e. distance − accuracy ≤ threshold.
 *  - At most one warning per tourist + zone per cooldown (dedupeKey on a time bucket), so it cannot spam.
 */
const MAX_ACCURACY_M = Number(process.env.APPROACH_MAX_ACCURACY_M) || 100;
const COOLDOWN_MS = 30 * 60 * 1000;

async function warnApproachingZone({ touristId, lat, lng, accuracy, now = Date.now() }) {
  if (!touristId || typeof accuracy !== 'number' || accuracy > MAX_ACCURACY_M) return [];
  const threshold = thresholds.risk.proximityM;
  const near = await Zone.aggregate([
    { $geoNear: {
      near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distanceM', spherical: true,
      maxDistance: threshold + accuracy, query: { isActive: true, type: { $in: ['restricted', 'danger'] } },
    } },
    { $project: { name: 1, type: 1, distanceM: 1 } },
    { $limit: 3 },
  ]);
  if (near.some((z) => z.distanceM <= 0)) return []; // already inside: the enter event covers it
  const warned = [];
  const bucket = Math.floor(now / COOLDOWN_MS);
  for (const z of near) {
    if (z.distanceM - accuracy > threshold) continue;
    const metres = Math.max(10, Math.round(z.distanceM / 10) * 10);
    const danger = z.type === 'danger';
    const made = await notifyUser(touristId, {
      type: 'geofence_violation',
      title: `Approaching ${danger ? 'a danger zone' : 'a restricted area'}: ${z.name}`,
      message: `About ${metres} m from ${z.name}. Please avoid entering; if you are unsure, check the map or ask Copilot for a safer route.`,
      link: '/tourist/map', severity: danger ? 'critical' : 'warning',
      payload: { zone: z._id, zoneName: z.name, zoneType: z.type, distanceM: metres, accuracyM: Math.round(accuracy), approach: true },
      dedupeKey: `approach:${z._id}:${bucket}`,
    });
    if (!made) continue; // already warned in this window
    const u = await User.findById(touristId).select('name isDemo').lean();
    await notifyAdmins({
      type: 'geofence_violation',
      title: `${u?.isDemo ? '[Simulated] ' : ''}Approaching ${z.type} zone: ${u?.name || 'A tourist'}`,
      message: `${u?.name || 'A tourist'} is about ${metres} m from “${z.name}” (${z.type}); GPS accuracy ±${Math.round(accuracy)} m.`,
      link: `/admin/map?tourist=${touristId}`, severity: 'warning',
      payload: { zone: z._id, tourist: touristId, approach: true },
      dedupeKey: `approach-admin:${touristId}:${z._id}:${bucket}`, isDemo: Boolean(u?.isDemo),
    });
    warned.push({ zone: z.name, distanceM: metres });
  }
  return warned;
}

module.exports = { warnApproachingZone };
