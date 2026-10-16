const { Incident, Device } = require('../../models');
const { recordProof } = require('../blockchain/auditChain');
const { evaluateRisk } = require('../riskAssessment/evaluateRisk');
const { triggerSos, SosAlreadyActiveError } = require('../sos/triggerSos');

/**
 * Escalates a SafetyCheck into an Incident, following the same
 * create-Incident + emit shape services/sos/triggerSos.js established.
 * Marks the SafetyCheck escalated + linked before returning.
 */
async function _escalate(safetyCheck, { severity, type, action, actorLabel }, io) {
  const incident = await Incident.create({
    tourist: safetyCheck.tourist,
    type,
    severity,
    status: 'open',
    sourceRef: { refModel: 'SafetyCheck', refId: safetyCheck._id },
    timeline: [{ actorLabel, action }],
  });

  safetyCheck.escalated = true;
  safetyCheck.incident = incident._id;
  await safetyCheck.save();
  await recordProof('incident_opened', 'Incident', incident);
  await incident.populate('tourist', 'name email isDemo');

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

// A safety check that went unanswered past the response window. Phase 11:
// an unresponsive lone tourist is a real emergency, not just an admin note
// — route through the same triggerSos() pipeline as a manual SOS button
// press, so Device.emergencyMode flips automatically. Falls back to a
// plain Incident only if there's no device/location to put into emergency
// mode in the first place.
async function escalateMissedCheck(safetyCheck, io) {
  const device = await Device.findOne({ tourist: safetyCheck.tourist });

  if (!device?.lastLocation || device.lastLocation.lat == null) {
    return _escalate(
      safetyCheck,
      { severity: 'medium', type: 'no_response', action: 'Safety check unanswered', actorLabel: 'system' },
      io
    );
  }

  let incident;
  try {
    ({ incident } = await triggerSos({
      tourist: safetyCheck.tourist,
      device: device._id,
      location: device.lastLocation,
      source: 'auto_no_response',
      io,
    }));
  } catch (err) {
    if (!(err instanceof SosAlreadyActiveError)) throw err;
    // Already in an active SOS/emergency — attach to that open incident
    // instead of creating a duplicate.
    incident = await Incident.findOne({
      tourist: safetyCheck.tourist,
      status: { $in: ['open', 'in_progress'] },
    }).sort({ createdAt: -1 });
  }

  safetyCheck.escalated = true;
  safetyCheck.incident = incident?._id || null;
  await safetyCheck.save();

  await evaluateRisk(safetyCheck.tourist, io, { force: true });

  if (io) {
    const payload = { safetyCheck, incident };
    io.to('admin').emit('safetycheck:missed', payload);
    io.to(`tourist:${safetyCheck.tourist}`).emit('safetycheck:missed', payload);
  }

  return incident;
}

// A tourist explicitly responded "unsafe".
async function escalateUnsafeResponse(safetyCheck, io) {
  return _escalate(
    safetyCheck,
    { severity: 'high', type: 'other', action: 'Tourist reported unsafe on safety check', actorLabel: 'tourist' },
    io
  );
}

module.exports = { escalateMissedCheck, escalateUnsafeResponse };
