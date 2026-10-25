const express = require('express');
const {
  triggerCheck,
  respondToCheck,
  getMyCheck,
  listChecks,
  monitorStatus,
} = require('../controllers/safetyCheck.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const idempotent = require('../middleware/idempotency');
const { idParams, checkRespondSchema, checkTriggerSchema } = require('../validation/schemas');

const router = express.Router();

router.post('/trigger',      authenticate, authorize('admin'),   validate(checkTriggerSchema), triggerCheck);
router.post('/:id/respond',  authenticate, authorize('tourist'), validate(idParams, 'params'), validate(checkRespondSchema), idempotent, respondToCheck);
router.get('/mine',          authenticate, authorize('tourist'), getMyCheck);
router.get('/status',        authenticate, authorize('admin'),   monitorStatus);
router.get('/',              authenticate, authorize('admin'),   listChecks);

module.exports = router;
