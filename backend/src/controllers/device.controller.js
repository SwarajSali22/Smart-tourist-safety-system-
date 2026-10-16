const { Device, TouristProfile, User, LocationPing, GeofenceEvent } = require('../models');
const { recordProof } = require('../services/blockchain/auditChain');
const { generateDeviceApiKey, hashDeviceApiKey } = require('../services/auth.service');
const { evaluateGeofence } = require('../services/geofencing/checkGeofence');
const { triggerSos, SosAlreadyActiveError } = require('../services/sos/triggerSos');
const { evaluateRisk } = require('../services/riskAssessment/evaluateRisk');
const crypto = require('crypto');

// ── POST /api/devices  (admin only) ───────────────────────────────────────────
async function registerDevice(req, res, next) {
  try {
    const { tourist, deviceId, isSimulated } = req.body;

    if (!tourist) {
      return res.status(400).json({ success: false, message: 'tourist is required' });
    }

    const touristUser = await User.findOne({ _id: tourist, role: 'tourist' });
    if (!touristUser) {
      return res.status(404).json({ success: false, message: 'Tourist not found' });
    }

    const profile = await TouristProfile.findOne({ user: tourist });
    if (profile?.device) {
      return res.status(409).json({ success: false, message: 'Tourist already has a device' });
    }

    const resolvedDeviceId = deviceId || `SIM-${crypto.randomBytes(4).toString('hex')}`;
    const existingDevice = await Device.findOne({ deviceId: resolvedDeviceId });
    if (existingDevice) {
      return res.status(409).json({ success: false, message: 'deviceId already in use' });
    }

    const apiKey = generateDeviceApiKey();
    const apiKeyHash = await hashDeviceApiKey(apiKey);

    const device = await Device.create({
      deviceId: resolvedDeviceId,
      tourist,
      apiKeyHash,
      isSimulated: isSimulated !== false,
    });

    await TouristProfile.findOneAndUpdate(
      { user: tourist },
      { device: device._id },
      { upsert: true }
    );

    return res.status(201).json({ success: true, device: _safeDevice(device), apiKey });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/devices  (admin only) ────────────────────────────────────────────
async function listDevices(req, res, next) {
  try {
    const devices = await Device.find()
      .select('-apiKeyHash')
      .populate('tourist', 'name email')
      .sort({ lastSeen: -1 })
      .lean();

    return res.json({ success: true, devices });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/devices/:deviceId  (admin, or the owning tourist) ───────────────
async function getDevice(req, res, next) {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .select('-apiKeyHash')
      .populate('tourist', 'name email')
      .lean();

    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const isOwner = device.tourist && device.tourist._id.toString() === req.user.id;
    if (req.user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    return res.json({ success: true, device });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/devices/:deviceId/trail  (admin, or the owning tourist) ─────────
async function getTrail(req, res, next) {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId }).select('_id tourist').lean();
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }
    const isOwner = device.tourist && device.tourist.toString() === req.user.id;
    if (req.user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const pings = await LocationPing.find({ device: device._id })
      .sort({ timestamp: -1 })
      .limit(limit)
      .select('lat lng timestamp battery -_id')
      .lean();
    return res.json({ success: true, trail: pings.reverse() });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/devices/:deviceId/telemetry  (device-authenticated) ────────────
async function ingestTelemetry(req, res, next) {
  try {
    if (req.device.deviceId !== req.params.deviceId) {
      return res.status(400).json({ success: false, message: 'deviceId mismatch' });
    }

    const { lat, lng, battery, sosPressed, timestamp } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ success: false, message: 'lat and lng are required numbers' });
    }

    await LocationPing.create({
      device: req.device._id,
      tourist: req.device.tourist,
      lat,
      lng,
      battery: typeof battery === 'number' ? battery : null,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    req.device.lastLocation = { lat, lng };
    req.device.lastSeen = new Date();
    if (typeof battery === 'number') req.device.battery = battery;
    req.device.emergencyMode = Boolean(sosPressed);
    req.device.status = sosPressed ? 'emergency' : 'active';
    const { entered, exited } = await evaluateGeofence(req.device, lat, lng);
    await req.device.save();

    if (sosPressed) {
      try {
        await triggerSos({
          tourist: req.device.tourist,
          device: req.device._id,
          location: { lat, lng },
          source: 'button',
          io: req.app.get('io'),
        });
      } catch (err) {
        // A held button re-sends sosPressed:true every tick — "already
        // active" is expected, not an error, once the first trigger lands.
        if (!(err instanceof SosAlreadyActiveError)) throw err;
      }
    }

    // Audit trail: entering a non-safe zone is a recorded violation.
    for (const event of entered) {
      if (event.zone?.type !== 'safe') {
        const geoDoc = await GeofenceEvent.findById(event._id);
        if (geoDoc) await recordProof('geofence_violation', 'GeofenceEvent', geoDoc);
      }
    }

    // Phase 11: standing inside a danger zone is an automatic emergency,
    // not just an admin-facing violation notice — no button press required.
    for (const event of entered) {
      if (event.zone?.type === 'danger') {
        try {
          await triggerSos({
            tourist: req.device.tourist,
            device: req.device._id,
            location: { lat, lng },
            source: 'auto_geofence',
            io: req.app.get('io'),
          });
        } catch (err) {
          if (!(err instanceof SosAlreadyActiveError)) throw err;
        }
      }
    }

    if (req.device.tourist) {
      await evaluateRisk(req.device.tourist, req.app.get('io'));
    }

    const io = req.app.get('io');
    if (io) {
      const touristId = req.device.tourist?.toString();
      await req.device.populate('tourist', 'name email');
      const deviceUpdate = _safeDevice(req.device);

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

    return res.json({ success: true, sosAcknowledged: Boolean(sosPressed) });
  } catch (err) {
    next(err);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function _safeDevice(device) {
  const obj = device.toObject ? device.toObject() : device;
  delete obj.apiKeyHash;
  return obj;
}

module.exports = { registerDevice, listDevices, getDevice, getTrail, ingestTelemetry };
