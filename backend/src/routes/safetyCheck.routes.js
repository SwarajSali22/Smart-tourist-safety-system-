const express = require('express');
const {
  triggerCheck,
  respondToCheck,
  getMyCheck,
  listChecks,
} = require('../controllers/safetyCheck.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.post('/trigger',      authenticate, authorize('admin'),   triggerCheck);
router.post('/:id/respond',  authenticate, authorize('tourist'), respondToCheck);
router.get('/mine',          authenticate, authorize('tourist'), getMyCheck);
router.get('/',              authenticate, authorize('admin'),   listChecks);

module.exports = router;
