const { Incident, RiskAssessment } = require('../../models');
const { recordProof } = require('../blockchain/auditChain');
const thresholds = require('../../config/thresholds');
const { findRelatedIncident, attachEvent } = require('../incidents/correlate');

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const LIVE = ['open', 'in_progress', 'assigned', 'en_route']; // a human may already be on it

/**
 * Risk is re-evaluated constantly (every telemetry tick), so this keeps ONE alert per condition:
 *  - an alert that is still in progress (including assigned / en route) is reused, never duplicated,
 *    and only gets a timeline note when it worsens or after `repeatNoteMs`;
 *  - after an alert was resolved/closed, the same standing condition does NOT open a new one until
 *    either the cooldown has passed or the tourist's risk dropped below "high" in between
 *    (that is what makes a later escalation genuinely new).
 * Must be called with a `riskAssessment` whose `tourist` field is still a raw ObjectId.
 */
async function escalateRisk(riskAssessment, io) {
  const { tourist, level, score, ruleTriggered, ruleName } = riskAssessment;

  let incident = await Incident.findOne({ tourist, type: 'risk_escalation', status: { $in: LIVE } });

  const action = ruleTriggered
    ? `Risk rule triggered: ${ruleName} (score ${score})`
    : `Risk score reached ${level} (${score})`;

  if (!incident) {
    const last = await Incident.findOne({ tourist, type: 'risk_escalation', status: { $in: ['resolved', 'closed'] } })
      .sort({ resolvedAt: -1, createdAt: -1 }).select('resolvedAt closedAt createdAt').lean();
    if (last) {
      const endedAt = new Date(last.resolvedAt || last.closedAt || last.createdAt);
      const cooling = Date.now() - endedAt.getTime() < thresholds.risk.reopenCooldownMs;
      if (cooling) {
        const rearmed = await RiskAssessment.exists({ tourist, evaluatedAt: { $gt: endedAt }, level: { $in: ['low', 'medium'] } });
        if (!rearmed) return null; // same standing condition that was already handled
      }
    }
  }

  if (incident) {
    const worse = SEVERITY_RANK[level] > SEVERITY_RANK[incident.severity];
    if (worse) incident.severity = level;
    const lastAt = incident.timeline.length ? new Date(incident.timeline[incident.timeline.length - 1].at).getTime() : 0;
    if (!worse && Date.now() - lastAt < thresholds.risk.repeatNoteMs) return incident; // nothing new to report
    incident.timeline.push({ actorLabel: 'system', action });
    await incident.save();
  } else {
    // Correlation: a tourist already in an active incident (e.g. an SOS) doesn't get a duplicate risk incident;
    // the risk event is added to that incident's timeline (at most once per repeatNoteMs).
    const related = await findRelatedIncident(tourist);
    if (related) {
      const recent = related.timeline.some((t) => t.metadata?.correlated && t.metadata.sourceModel === 'RiskAssessment' && Date.now() - new Date(t.at).getTime() < thresholds.risk.repeatNoteMs);
      return recent ? related : attachEvent(related, { action, severity: level, sourceModel: 'RiskAssessment', sourceId: riskAssessment._id });
    }
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

/**
 * Resolves risk alerts whose cause has demonstrably passed: the tourist's latest assessment was
 * computed from a FRESH position, is below "high", and nothing high has been recorded for `clearMs`.
 * Alerts a person is already working (assigned / en route) are left alone, and stale or missing
 * location data never clears an alert (the tourist might simply be unreachable).
 * Returns the number of alerts resolved.
 */
async function autoResolveClearedRisk(touristId = null) {
  // required lazily: lifecycle requires this module's siblings
  const { transitionIncident } = require('../incidents/lifecycle');
  const filter = { type: 'risk_escalation', status: { $in: ['open', 'in_progress'] } };
  if (touristId) filter.tourist = touristId;
  const active = await Incident.find(filter).select('tourist status').lean();
  let resolved = 0;
  for (const inc of active) {
    const latest = await RiskAssessment.findOne({ tourist: inc.tourist }).sort({ evaluatedAt: -1 }).lean();
    if (!latest || latest.locationStale || latest.ruleTriggered || ['high', 'critical'].includes(latest.level)) continue;
    if (Date.now() - new Date(latest.evaluatedAt).getTime() > thresholds.risk.outdatedMs) continue; // too old to rely on
    const since = new Date(Date.now() - thresholds.risk.clearMs);
    const recentHigh = await RiskAssessment.exists({ tourist: inc.tourist, evaluatedAt: { $gte: since }, level: { $in: ['high', 'critical'] } });
    if (recentHigh) continue;
    try {
      await transitionIncident({
        id: inc._id, to: 'resolved', actor: { id: null, role: 'system' },
        note: `Risk returned to ${latest.level} (score ${latest.score}) on a current position and stayed there; resolved automatically.`,
      });
      resolved += 1;
    } catch (err) {
      if (err.statusCode !== 409) console.error('[risk] auto-resolve failed:', err.message);
    }
  }
  return resolved;
}

module.exports = { escalateRisk, autoResolveClearedRisk };
