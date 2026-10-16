const crypto = require('crypto');
const { Device, TouristProfile } = require('../models');
const { processTelemetry } = require('../services/telemetry/processTelemetry');

// ── POST /api/tourists/me/location  (tourist, JWT) ───────────────────────────
// The tourist's phone reports its own GPS. It goes through the same pipeline
// as wristband telemetry (ping, geofence, SOS rules, risk, sockets) via a
// device of type "phone", auto-created on first report. Phone devices have no
// API key, so they can't be used with the device-key telemetry route.
//
// The system assumes ONE device per tourist (risk, SOS and the scheduler all
// look the device up by tourist). If the tourist already has a wristband, the
// phone report is acknowledged but not recorded.
async function reportMyLocation(req, res, next) {
  try {
    const { lat, lng, accuracy } = req.body;
    const tourist = req.user.id;

    const profile = await TouristProfile.findOne({ user: tourist }).populate('device');
    let device = profile?.device || null;

    if (device && device.type !== 'phone') {
      return res.json({ success: true, accepted: false, reason: 'wristband_assigned' });
    }

    if (!device) {
      device = await Device.create({
        deviceId: `PHONE-${crypto.randomBytes(4).toString('hex')}`,
        tourist,
        type: 'phone',
        isSimulated: false,
        status: 'active',
      });
      await TouristProfile.findOneAndUpdate({ user: tourist }, { device: device._id }, { upsert: true });
    }

    await processTelemetry({ device, lat, lng, accuracy, io: req.app.get('io') });

    return res.json({ success: true, accepted: true, deviceId: device.deviceId });
  } catch (err) {
    next(err);
  }
}

module.exports = { reportMyLocation };
