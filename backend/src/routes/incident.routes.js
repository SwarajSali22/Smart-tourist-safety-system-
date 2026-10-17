const express = require('express');
const {
  listIncidents,
  exportIncidents,
  getIncident,
  setStatus,
  acknowledgeIncident,
  resolveIncident,
  addNote,
} = require('../controllers/incident.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const {
  idParams, incidentListQuery, incidentStatusSchema, incidentNoteSchema, incidentResolveSchema,
} = require('../validation/schemas');

const router = express.Router();

router.get('/',                  authenticate, authorize('admin', 'responder'), validate(incidentListQuery, 'query'), listIncidents);
router.get('/export.csv',        authenticate, authorize('admin'), validate(incidentListQuery, 'query'), exportIncidents);
router.get('/:id',               authenticate, validate(idParams, 'params'), getIncident);
router.patch('/:id/status',      authenticate, authorize('admin', 'responder'), validate(idParams, 'params'), validate(incidentStatusSchema), setStatus);
router.patch('/:id/acknowledge', authenticate, authorize('admin'), validate(idParams, 'params'), acknowledgeIncident);
router.patch('/:id/resolve',     authenticate, authorize('admin'), validate(idParams, 'params'), validate(incidentResolveSchema), resolveIncident);
router.post('/:id/notes',        authenticate, authorize('admin', 'responder'), validate(idParams, 'params'), validate(incidentNoteSchema), addNote);

module.exports = router;
