const { Incident } = require('../../models');
const { recordProof } = require('../blockchain/auditChain');

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Unlike SOS/safety-check escalation, risk is re-evaluated repeatedly for
 * the same tourist (every telemetry tick), so this reuses one open
 * 'risk_escalation' Incident per tourist instead of creating a new one on
 * every elevated reading — only severity/timeline update on repeat hits.
 * Must be called with a `riskAssessment` whose `tourist` field is still a
 * raw ObjectId (i.e. before it's been populated).
 */
async function escalateRisk(riskAssessment, io) {
  const { tourist, level, score, ruleTriggered, ruleName } = riskAssessment;

  let incident = await Incident.findOne({
    tourist,
    type: 'risk_escalation',
    status: { $in: ['open', 'in_progress'] },
  });

  const action = ruleTriggered
    ? `Risk rule triggered: ${ruleName} (score ${score})`
    : `Risk score reached ${level} (${score})`;

  if (incident) {
    if (SEVERITY_RANK[level] > SEVERITY_RANK[incident.severity]) {
      incident.severity = level;
    }
    incident.timeline.push({ actorLabel: 'system', action });
    await incident.save();
  } else {
    incident = await Incident.create({
      tourist,
      type: 'risk_escalation',
      severity: level,
      status: 'open',
      sourceRef: { refModel: 'RiskAssessment', refId: riskAssessment._id },
      timeline: [{ actorLabel: 'system', action }],
    });
    await recordProof('risk_escalation', 'RiskAssessment', riskAssessment);
    await recordProof('incident_opened', 'Incident', incident);
  }

  await incident.populate('tourist', 'name email isDemo');

  if (io) {
    io.to('admin').emit('admin:alert', { type: 'risk', riskAssessment, incident });
    io.to('admin').emit('incident:updated', incident);
    io.to(`tourist:${tourist}`).emit('incident:updated', incident);
  }

  return incident;
}

module.exports = { escalateRisk };
