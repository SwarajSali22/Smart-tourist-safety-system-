const express = require('express');
const {
  triggerCheck,
  respondToCheck,
  getMyCheck,
  listChecks,
} = require('../controllers/safetyCheck.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParams, checkRespondSchema, checkTriggerSchema } = require('../validation/schemas');

const router = express.Router();

router.post('/trigger',      authenticate, authorize('admin'),   validate(checkTriggerSchema), triggerCheck);
router.post('/:id/respond',  authenticate, authorize('tourist'), validate(idParams, 'params'), validate(checkRespondSchema), respondToCheck);
router.get('/mine',          authenticate, authorize('tourist'), getMyCheck);
router.get('/',              authenticate, authorize('admin'),   listChecks);

module.exports = router;
