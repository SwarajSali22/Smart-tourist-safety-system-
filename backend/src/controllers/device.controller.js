const { Device, TouristProfile, User, LocationPing } = require('../models');
const { generateDeviceApiKey, hashDeviceApiKey } = require('../services/auth.service');
const { processTelemetry, toSafeDevice } = require('../services/telemetry/processTelemetry');
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

    const profile = await TouristProfile.findOne({ user: tourist }).populate('device', 'type');
    if (profile?.device) {
      // The system assumes one device per tourist. A phone device (auto-created
      // from the tourist's own GPS) is replaced by a real wristband; any other
      // existing device is a conflict.
      if (profile.device.type !== 'phone') {
        return res.status(409).json({ success: false, message: 'Tourist already has a device' });
      }
      await Device.deleteOne({ _id: profile.device._id });
      await TouristProfile.updateOne({ user: tourist }, { device: null });
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

    await processTelemetry({
      device: req.device, lat, lng, battery, sosPressed, timestamp, io: req.app.get('io'),
    });

    return res.json({ success: true, sosAcknowledged: Boolean(sosPressed) });
  } catch (err) {
    next(err);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
const _safeDevice = toSafeDevice;

module.exports = { registerDevice, listDevices, getDevice, getTrail, ingestTelemetry };
