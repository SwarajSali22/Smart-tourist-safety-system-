const { Incident, Device } = require('../../models');
const { recordProof } = require('../blockchain/auditChain');
const { evaluateRisk } = require('../riskAssessment/evaluateRisk');
const thresholds = require('../../config/thresholds');
const { findRelatedIncident, attachEvent } = require('../incidents/correlate');

/**
 * Escalates a SafetyCheck into an Incident, following the same
 * create-Incident + emit shape services/sos/triggerSos.js established.
 * Marks the SafetyCheck escalated + linked before returning.
 */
async function _escalate(safetyCheck, { severity, type, action, actorLabel, metadata = null }, io) {
  // Correlation: if this tourist already has an active incident nearby in time, add this event to it.
  const related = await findRelatedIncident(safetyCheck.tourist);
  let incident;
  if (related) {
    incident = await attachEvent(related, { action, severity, sourceModel: 'SafetyCheck', sourceId: safetyCheck._id });
  } else {
    incident = await Incident.create({
      tourist: safetyCheck.tourist,
      type,
      severity,
      status: 'open',
      sourceRef: { refModel: 'SafetyCheck', refId: safetyCheck._id },
      timeline: [{ actorLabel, action, metadata }],
    });
    await recordProof('incident_opened', 'Incident', incident);
    await incident.populate('tourist', 'name email isDemo');
  }

  safetyCheck.escalated = true;
  safetyCheck.incident = incident._id;
  await safetyCheck.save();

  // A discrete, meaningful event — always re-evaluate, bypassing the
  // telemetry-path throttle in evaluateRisk.
  await evaluateRisk(safetyCheck.tourist, io, { force: true });

  if (io) {
    const payload = { safetyCheck, incident };
    io.to('admin').emit('safetycheck:missed', payload);
    io.to('admin').emit('admin:alert', { type: 'safetycheck', ...payload });
    io.to(`tourist:${safetyCheck.tourist}`).emit('safetycheck:missed', payload);
  }

  return incident;
}

// A safety check that went unanswered. This is an AUTOMATED SAFETY ALERT for a human to review (Incident type
// 'no_response'), never an SOS: the tourist did not press anything, and silence can have harmless causes
// (no signal, phone off). Used for admin-triggered checks; the 15/20/25-minute workflow calls escalateOverdueAlert.
async function escalateMissedCheck(safetyCheck, io) {
  const device = await Device.findOne({ tourist: safetyCheck.tourist }).select('lastSeen lastLocation').lean();
  const known = device?.lastLocation?.lat != null;
  const age = device?.lastSeen ? Math.round((Date.now() - new Date(device.lastSeen).getTime()) / 60000) : null;
  return _escalate(
    safetyCheck,
    {
      severity: 'medium', type: 'no_response', actorLabel: 'system',
      action: known && age != null && age * 60000 > thresholds.device.staleMs
        ? 'Safety check unanswered (device offline; last position is old)' : 'Safety check unanswered',
      metadata: { kind: 'automated_safety_alert', isSos: false },
    },
    io
  );
}

// 25-minute escalation of the silence-clock workflow. `context` is the admin-facing snapshot built by workflow.js.
async function escalateOverdueAlert(safetyCheck, context, io) {
  return _escalate(
    safetyCheck,
    {
      severity: context.severity, type: 'no_response', actorLabel: 'system',
      action: `Automated safety alert: no location or check-in for ${Math.round((Date.now() - new Date(safetyCheck.episodeAt).getTime()) / 60000)} min (not an SOS)`,
      metadata: context,
    },
    io
  );
}

// A tourist explicitly responded "unsafe".
async function escalateUnsafeResponse(safetyCheck, io) {
  return _escalate(
    safetyCheck,
    { severity: 'high', type: 'other', action: 'Tourist reported unsafe on safety check', actorLabel: 'tourist' },
    io
  );
}

module.exports = { escalateMissedCheck, escalateOverdueAlert, escalateUnsafeResponse };
