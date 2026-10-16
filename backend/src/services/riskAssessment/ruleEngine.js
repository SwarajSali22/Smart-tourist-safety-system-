const { SOSEvent, Device } = require('../../models');

/**
 * Deterministic layer (Phase 0 plan §9): an active SOS or standing inside a
 * danger zone forces Critical directly, regardless of the weighted score —
 * this is the safety backstop that must never depend on AI/scoring alone.
 * Returns null when no rule fires.
 */
async function runRuleEngine(touristId) {
  const activeSos = await SOSEvent.findOne({
    tourist: touristId,
    status: { $in: ['active', 'acknowledged'] },
  }).select('_id');
  if (activeSos) return { ruleName: 'sos_active' };

  const device = await Device.findOne({ tourist: touristId })
    .select('currentZones')
    .populate('currentZones', 'type');
  if (device?.currentZones?.some((zone) => zone.type === 'danger')) {
    return { ruleName: 'danger_zone' };
  }

  return null;
}

module.exports = { runRuleEngine };
