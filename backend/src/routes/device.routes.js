const express = require('express');
const {
  registerDevice,
  listDevices,
  getDevice,
  getTrail,
  ingestTelemetry,
} = require('../controllers/device.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const authenticateDevice = require('../middleware/authenticateDevice');

const router = express.Router();

// Admin: register a device and assign it to a tourist
router.post('/', authenticate, authorize('admin'), registerDevice);
// Admin: list all devices
router.get('/', authenticate, authorize('admin'), listDevices);
// Admin or the owning tourist: read one device
router.get('/:deviceId', authenticate, getDevice);
// Admin or the owning tourist: recent location history for the map trail
router.get('/:deviceId/trail', authenticate, getTrail);
// Device (simulator or ESP32): push a telemetry sample
router.post('/:deviceId/telemetry', authenticateDevice, ingestTelemetry);

module.exports = router;
