const { RiskAssessment, Device } = require('../../models');
const { runRuleEngine } = require('./ruleEngine');
const { computeScore, scoreToLevel } = require('./scoringModel');
const { escalateRisk } = require('./escalateRisk');
const { triggerSos, SosAlreadyActiveError } = require('../sos/triggerSos');

// Telemetry arrives frequently (every simulator/device tick); without
// throttling, every ping would mint a new RiskAssessment. A rule-triggered
// evaluation (SOS/danger zone) always runs immediately — this only paces
// the advisory score.
const MIN_EVAL_INTERVAL_MS = 30 * 1000;

/**
 * The one entry point the Phase 0 plan calls for: runs the deterministic
 * rule engine first (§9 — never overridden by the score), falls back to the
 * weighted scoring layer, persists a RiskAssessment, escalates an Incident
 * at High/Critical, and emits `risk:updated`.
 *
 * `force` bypasses the throttle — use it for discrete events (a safety-check
 * response, an admin-requested re-evaluation), not for the telemetry path.
 */
async function evaluateRisk(touristId, io, { force = false } = {}) {
  const rule = await runRuleEngine(touristId);

  if (!force && !rule) {
    const last = await RiskAssessment.findOne({ tourist: touristId })
      .sort({ evaluatedAt: -1 })
      .select('evaluatedAt');
    if (last && Date.now() - last.evaluatedAt.getTime() < MIN_EVAL_INTERVAL_MS) {
      return { riskAssessment: last, incident: null, skipped: true };
    }
  }

  const { score, factors } = await computeScore(touristId);
  const level = rule ? 'critical' : scoreToLevel(score);

  const riskAssessment = await RiskAssessment.create({
    tourist: touristId,
    score,
    level,
    factors,
    ruleTriggered: Boolean(rule),
    ruleName: rule?.ruleName || null,
    evaluatedAt: new Date(),
  });

  let incident = null;
  if (level === 'high' || level === 'critical') {
    incident = await escalateRisk(riskAssessment, io);
  }

  // Phase 11: a score-driven Critical (not already a rule-triggered SOS or
  // danger-zone entry — those are automatic emergencies via their own
  // paths) is still a real emergency, just one the weighted factors caught
  // rather than a single deterministic rule. Put the device into the same
  // emergency mode a manual SOS would.
  if (level === 'critical' && !rule) {
    const device = await Device.findOne({ tourist: touristId });
    if (device?.lastLocation?.lat != null) {
      try {
        await triggerSos({
          tourist: touristId,
          device: device._id,
          location: device.lastLocation,
          source: 'auto_risk_critical',
          io,
        });
      } catch (err) {
        if (!(err instanceof SosAlreadyActiveError)) throw err;
      }
    }
  }

  await riskAssessment.populate('tourist', 'name email isDemo');

  if (io) {
    io.to('admin').emit('risk:updated', riskAssessment);
    io.to(`tourist:${touristId}`).emit('risk:updated', riskAssessment);
  }

  return { riskAssessment, incident };
}

module.exports = { evaluateRisk };
