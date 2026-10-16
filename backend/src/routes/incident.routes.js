const express = require('express');
const {
  listIncidents,
  getIncident,
  acknowledgeIncident,
  resolveIncident,
} = require('../controllers/incident.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.get('/',                authenticate, authorize('admin'), listIncidents);
router.get('/:id',              authenticate, getIncident);
router.patch('/:id/acknowledge', authenticate, authorize('admin'), acknowledgeIncident);
router.patch('/:id/resolve',     authenticate, authorize('admin'), resolveIncident);

module.exports = router;
