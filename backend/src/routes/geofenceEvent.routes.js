const express = require('express');
const { listGeofenceEvents, resolveGeofenceEvent } = require('../controllers/geofenceEvent.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParams } = require('../validation/schemas');

const router = express.Router();

router.get('/',              authenticate, authorize('admin'), listGeofenceEvents);
router.patch('/:id/resolve', authenticate, authorize('admin'), validate(idParams, 'params'), resolveGeofenceEvent);

module.exports = router;
