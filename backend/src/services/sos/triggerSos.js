const { SOSEvent, Incident, Device } = require('../../models');
const { recordProof } = require('../blockchain/auditChain');
const { notifyEmergencyContacts } = require('../notifications/sms');

class SosAlreadyActiveError extends Error {
  constructor() {
    super('Tourist already has an active SOS');
    this.status = 409;
  }
}

/**
 * Shared by both SOS trigger paths (device button via ingestTelemetry, and
 * the tourist app's software fallback via POST /api/sos). Creates the
 * SOSEvent, an escalated Incident linked to it, and emits the roadmap's
 * sos:triggered / admin:alert socket events.
 */
async function triggerSos({ tourist, device, location, source, io }) {
  const existing = await SOSEvent.findOne({
    tourist,
    status: { $in: ['active', 'acknowledged'] },
  });
  if (existing) throw new SosAlreadyActiveError();

  const sosEvent = await SOSEvent.create({ tourist, device, location, source, status: 'active' });

  const incident = await Incident.create({
    tourist,
    type: 'sos',
    severity: 'critical',
    status: 'open',
    sourceRef: { refModel: 'SOSEvent', refId: sosEvent._id },
    timeline: [
      {
        actorLabel: source === 'button' ? 'device' : 'tourist',
        action: `SOS triggered (${source})`,
      },
    ],
  });

  sosEvent.incident = incident._id;
  await sosEvent.save();

  // Tamper-evident audit trail (Phase 14) + SMS to emergency contacts. Neither
  // can fail the SOS: recordProof never throws, SMS is fire-and-forget.
  const sosProof = await recordProof('sos_triggered', 'SOSEvent', sosEvent);
  await recordProof('incident_opened', 'Incident', incident);
  if (sosProof) {
    sosEvent.auditProof = sosProof._id;
    await sosEvent.save();
  }
  notifyEmergencyContacts({ touristId: tourist, sosEvent });

  // Phase 11: entering emergency mode is a property of any SOS trigger, not
  // just the button-press telemetry tick (which sets it inline itself) —
  // centralizing it here means the app fallback and the automatic
  // (no-response / danger-zone) triggers light up the device's LED/buzzer
  // flag too, without each caller having to remember to.
  if (device) {
    await Device.findByIdAndUpdate(device, { emergencyMode: true, status: 'emergency' });
  }

  await sosEvent.populate('tourist', 'name email');
  await incident.populate('tourist', 'name email');

  if (io) {
    const payload = { sosEvent, incident };
    io.to('admin').emit('sos:triggered', payload);
    io.to('admin').emit('admin:alert', { type: 'sos', ...payload });
    io.to(`tourist:${tourist}`).emit('sos:triggered', payload);
  }

  return { sosEvent, incident };
}

module.exports = { triggerSos, SosAlreadyActiveError };
