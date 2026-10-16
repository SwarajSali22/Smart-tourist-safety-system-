const express = require('express');
const { listZones, createZone, updateZone, deleteZone } = require('../controllers/zone.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.get('/',      authenticate, listZones);
router.post('/',     authenticate, authorize('admin'), createZone);
router.patch('/:id', authenticate, authorize('admin'), updateZone);
router.delete('/:id', authenticate, authorize('admin'), deleteZone);

module.exports = router;
