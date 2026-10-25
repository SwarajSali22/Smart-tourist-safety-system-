const { SOSEvent, Device } = require('../../models');
const thresholds = require('../../config/thresholds');

/** Age of the device's last position and whether it is recent enough to say where the tourist is NOW. */
function locationFreshness(device, now = Date.now()) {
  if (!device?.lastSeen || device.lastLocation?.lat == null) return { known: false, stale: true, ageMin: null };
  const age = now - new Date(device.lastSeen).getTime();
  return { known: true, stale: age > thresholds.device.staleMs, ageMin: Math.round(age / 60000) };
}

/**
 * Deterministic layer (Phase 0 plan §9): an active SOS or standing inside a
 * danger zone forces Critical directly, regardless of the weighted score —
 * this is the safety backstop that must never depend on AI/scoring alone.
 * A zone only counts while the position is recent: an old fix is not proof the
 * tourist is still there. Returns null when no rule fires.
 */
async function runRuleEngine(touristId) {
  const activeSos = await SOSEvent.findOne({
    tourist: touristId,
    status: { $in: ['active', 'acknowledged'] },
  }).select('_id');
  if (activeSos) return { ruleName: 'sos_active' };

  const device = await Device.findOne({ tourist: touristId })
    .select('currentZones lastSeen lastLocation')
    .populate('currentZones', 'type');
  if (!locationFreshness(device).stale && device?.currentZones?.some((zone) => zone.type === 'danger')) {
    return { ruleName: 'danger_zone' };
  }

  return null;
}

module.exports = { runRuleEngine, locationFreshness };
