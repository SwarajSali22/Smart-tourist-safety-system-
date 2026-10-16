const express = require('express');
const { listZones, createZone, updateZone, deleteZone } = require('../controllers/zone.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParams, zoneCreateSchema, zoneUpdateSchema } = require('../validation/schemas');

const router = express.Router();

router.get('/',      authenticate, listZones);
router.post('/',     authenticate, authorize('admin'), validate(zoneCreateSchema), createZone);
router.patch('/:id', authenticate, authorize('admin'), validate(idParams, 'params'), validate(zoneUpdateSchema), updateZone);
router.delete('/:id', authenticate, authorize('admin'), validate(idParams, 'params'), deleteZone);

module.exports = router;
