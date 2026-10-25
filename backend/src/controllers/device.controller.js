const { Device, TouristProfile, User, LocationPing, SOSEvent } = require('../models');
const { generateDeviceApiKey, hashDeviceApiKey } = require('../services/auth.service');
const { logActivity } = require('../services/activity/logActivity');
const { processTelemetry, toSafeDevice } = require('../services/telemetry/processTelemetry');
const crypto = require('crypto');

// ── POST /api/devices  (admin only) ───────────────────────────────────────────
async function registerDevice(req, res, next) {
  try {
    const { tourist, deviceId, isSimulated, replacePhone } = req.body;

    if (!tourist) {
      return res.status(400).json({ success: false, message: 'tourist is required' });
    }

    const touristUser = await User.findOne({ _id: tourist, role: 'tourist' });
    if (!touristUser) {
      return res.status(404).json({ success: false, message: 'Tourist not found' });
    }

    const profile = await TouristProfile.findOne({ user: tourist }).populate('device', 'type deviceId lastSeen');
    if (profile?.device) {
      // The system assumes one device per tourist. A phone device (auto-created
      // from the tourist's own GPS) can be replaced by a wristband, but only on purpose: replacing it
      // stops the tourist's phone GPS being recorded (their phone's reports are ignored while another
      // device is assigned). Any other existing device is a conflict.
      if (profile.device.type !== 'phone') {
        return res.status(409).json({ success: false, message: 'Tourist already has a device' });
      }
      if (replacePhone !== true) {
        return res.status(409).json({
          success: false,
          code: 'phone_device_in_use',
          message: `${touristUser.name} is currently tracked by their own phone (${profile.device.deviceId}). Registering another device replaces it, and their phone's GPS will no longer be recorded. Confirm to replace it.`,
          phoneDevice: { deviceId: profile.device.deviceId, lastSeen: profile.device.lastSeen || null },
        });
      }
      await logActivity({ req, action: 'device.replace_phone', targetModel: 'Device', targetId: profile.device._id, summary: `Phone device ${profile.device.deviceId} replaced by a new device (confirmed by an admin)` });
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
      .populate('tourist', 'name email isDemo')
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
      .populate('tourist', 'name email isDemo')
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

// ── DELETE /api/devices/:deviceId  (admin only) ───────────────────────────────
// Removes a device that has NEVER reported anything — typically a placeholder registered by mistake,
// which would otherwise block the tourist's own phone GPS from being recorded (one device per tourist).
// A device with any telemetry, location ping, or SOS history is evidence and is never deleted here.
async function removeUnusedDevice(req, res, next) {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const [pings, sos] = await Promise.all([
      LocationPing.countDocuments({ device: device._id }),
      SOSEvent.countDocuments({ device: device._id }),
    ]);
    if (device.lastSeen || pings > 0 || sos > 0 || device.emergencyMode) {
      return res.status(409).json({
        success: false,
        code: 'device_has_history',
        message: `Device ${device.deviceId} has already reported data or been part of an emergency, so it can't be removed.`,
      });
    }

    await TouristProfile.updateMany({ device: device._id }, { device: null });
    await Device.deleteOne({ _id: device._id });
    await logActivity({ req, action: 'device.remove_unused', targetModel: 'Device', targetId: device._id, summary: `Unused device ${device.deviceId} removed by an admin` });
    return res.json({ success: true, removed: device.deviceId });
  } catch (err) {
    next(err);
  }
}

module.exports = { registerDevice, listDevices, getDevice, getTrail, ingestTelemetry, removeUnusedDevice };
