const { LocationPing, GeofenceEvent } = require('../../models');
const { recordProof } = require('../blockchain/auditChain');
const { evaluateGeofence } = require('../geofencing/checkGeofence');
const { triggerSos, SosAlreadyActiveError } = require('../sos/triggerSos');
const { findRelatedIncident, attachEvent } = require('../incidents/correlate');
const { evaluateRisk } = require('../riskAssessment/evaluateRisk');
const { warnApproachingZone } = require('../geofencing/approachWarning');

function toSafeDevice(device) {
  const obj = device.toObject ? device.toObject() : { ...device };
  delete obj.apiKeyHash;
  return obj;
}

/**
 * The single telemetry pipeline, shared by wristband/simulator telemetry
 * (POST /devices/:id/telemetry, device-key auth) and the tourist phone
 * (POST /tourists/me/location, JWT auth): save the ping, update the device,
 * geofence it, raise SOS / violations, audit-log violations, re-score risk,
 * and push `location:update` / `geofence:*` over Socket.IO.
 *
 * `device` is a Mongoose Device document. For `device.type === 'phone'` the
 * caller can never press a physical SOS button, so a phone ping must not clear
 * an emergency (e.g. an app-triggered SOS) that is already in progress.
 */
async function processTelemetry({ device, lat, lng, battery, accuracy, sosPressed = false, timestamp, io }) {
  await LocationPing.create({
    device: device._id,
    tourist: device.tourist,
    lat,
    lng,
    accuracy: typeof accuracy === 'number' ? accuracy : null,
    battery: typeof battery === 'number' ? battery : null,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
  });

  device.lastLocation = { lat, lng };
  device.lastSeen = new Date();
  if (typeof battery === 'number') device.battery = battery;
  if (device.type === 'phone') {
    if (!device.emergencyMode) device.status = 'active';
  } else {
    device.emergencyMode = Boolean(sosPressed);
    device.status = sosPressed ? 'emergency' : 'active';
  }
  const { entered, exited } = await evaluateGeofence(device, lat, lng);
  await device.save();

  if (sosPressed) {
    try {
      await triggerSos({ tourist: device.tourist, device: device._id, location: { lat, lng }, source: 'button', io });
    } catch (err) {
      // A held button re-sends sosPressed:true every tick — "already
      // active" is expected, not an error, once the first trigger lands.
      if (!(err instanceof SosAlreadyActiveError)) throw err;
    }
  }

  // Early warning before the boundary (never blocks the pipeline; skipped for poor/unknown GPS accuracy).
  if (device.tourist && entered.length === 0) {
    await warnApproachingZone({ touristId: device.tourist, lat, lng, accuracy })
      .catch((err) => console.error('[approachWarning]', err.message));
  }

  // Audit trail: entering a non-safe zone is a recorded violation.
  for (const event of entered) {
    if (event.zone?.type !== 'safe') {
      const geoDoc = await GeofenceEvent.findById(event._id);
      if (geoDoc) await recordProof('geofence_violation', 'GeofenceEvent', geoDoc);
    }
  }

  // Correlation: entering a restricted/danger zone while the tourist already has an active incident nearby
  // is recorded on that incident's timeline. The GeofenceEvent itself is untouched and no incident is
  // created here (a danger zone still raises its own SOS below when there isn't one already).
  if (device.tourist) {
    for (const event of entered) {
      if (event.zone?.type === 'safe') continue;
      const related = await findRelatedIncident(device.tourist, { location: { lat, lng } });
      if (related) {
        const zoneName = event.zone?.name || 'a zone';
        await attachEvent(related, { action: `Entered ${event.zone?.type} zone "${zoneName}"`, sourceModel: 'GeofenceEvent', sourceId: event._id });
      }
    }
  }

  // Phase 11: standing inside a danger zone is an automatic emergency,
  // not just an admin-facing violation notice — no button press required.
  for (const event of entered) {
    if (event.zone?.type === 'danger') {
      try {
        await triggerSos({ tourist: device.tourist, device: device._id, location: { lat, lng }, source: 'auto_geofence', io });
      } catch (err) {
        if (!(err instanceof SosAlreadyActiveError)) throw err;
      }
    }
  }

  if (device.tourist) {
    await evaluateRisk(device.tourist, io);
  }

  if (io) {
    const touristId = device.tourist?.toString();
    await device.populate('tourist', 'name email isDemo');
    const deviceUpdate = toSafeDevice(device);

    io.to('admin').emit('location:update', deviceUpdate);
    if (touristId) io.to(`tourist:${touristId}`).emit('location:update', deviceUpdate);

    for (const event of [...entered, ...exited]) {
      const payload = { device: deviceUpdate.deviceId, tourist: deviceUpdate.tourist, ...event };
      io.to('admin').emit('geofence:event', payload);
      if (event.eventType === 'enter' && event.zone?.type !== 'safe') {
        io.to('admin').emit('geofence:violation', payload);
        if (touristId) io.to(`tourist:${touristId}`).emit('geofence:violation', payload);
      }
    }
  }

  return { entered, exited };
}

module.exports = { processTelemetry, toSafeDevice };
