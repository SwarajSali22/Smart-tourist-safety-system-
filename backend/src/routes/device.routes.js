const express = require('express');
const {
  registerDevice,
  listDevices,
  getDevice,
  getTrail,
  ingestTelemetry,
  removeUnusedDevice,
} = require('../controllers/device.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const authenticateDevice = require('../middleware/authenticateDevice');
const validate = require('../middleware/validate');
const { telemetryLimiter } = require('../middleware/rateLimits');
const { deviceRegisterSchema, telemetrySchema } = require('../validation/schemas');

const router = express.Router();

// Admin: register a device and assign it to a tourist
router.post('/', authenticate, authorize('admin'), validate(deviceRegisterSchema), registerDevice);
// Admin: list all devices
router.get('/', authenticate, authorize('admin'), listDevices);
// Admin or the owning tourist: read one device
router.get('/:deviceId', authenticate, getDevice);
// Admin: remove a device that never reported anything (e.g. registered by mistake)
router.delete('/:deviceId', authenticate, authorize('admin'), removeUnusedDevice);
// Admin or the owning tourist: recent location history for the map trail
router.get('/:deviceId/trail', authenticate, getTrail);
// Device (simulator or ESP32): push a telemetry sample
router.post('/:deviceId/telemetry', telemetryLimiter, authenticateDevice, validate(telemetrySchema), ingestTelemetry);

module.exports = router;
