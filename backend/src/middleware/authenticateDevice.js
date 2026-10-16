const { Device } = require('../models');
const { verifyDeviceApiKey } = require('../services/auth.service');

/**
 * Device-level auth for the telemetry ingestion route.
 * Expects the header:  X-Device-Id: <deviceId>
 *                      X-Api-Key:   <plaintext key issued at registration>
 *
 * On success, attaches `req.device` (the full Device document) and calls next().
 * Used by both the simulator (Phase 5) and the real ESP32 (Phase 12–13).
 */
async function authenticateDevice(req, res, next) {
  const deviceId = req.headers['x-device-id'];
  const apiKey = req.headers['x-api-key'];

  if (!deviceId || !apiKey) {
    return res.status(401).json({
      success: false,
      message: 'Missing X-Device-Id or X-Api-Key header',
    });
  }

  try {
    const device = await Device.findOne({ deviceId });
    if (!device || !device.apiKeyHash) {
      return res.status(401).json({ success: false, message: 'Unknown device' });
    }

    const valid = await verifyDeviceApiKey(apiKey, device.apiKeyHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid device key' });
    }

    req.device = device;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = authenticateDevice;
