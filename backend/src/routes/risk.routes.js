const express = require('express');
const {
  getMyRisk,
  listLatestRisk,
  getRiskHistory,
  forceEvaluate,
} = require('../controllers/risk.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.get('/mine',               authenticate, authorize('tourist'),          getMyRisk);
router.get('/',                   authenticate, authorize('admin'),            listLatestRisk);
router.get('/:tourist/history',   authenticate, authorize('admin', 'tourist'), getRiskHistory);
router.post('/:tourist/evaluate', authenticate, authorize('admin'),            forceEvaluate);

module.exports = router;
