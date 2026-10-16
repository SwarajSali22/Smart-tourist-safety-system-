const express = require('express');
const {
  getMyRisk,
  listLatestRisk,
  getRiskHistory,
  forceEvaluate,
} = require('../controllers/risk.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { z } = require('zod');
const { objectId } = require('../validation/schemas');
const touristParam = z.object({ tourist: objectId });

const router = express.Router();

router.get('/mine',               authenticate, authorize('tourist'),          getMyRisk);
router.get('/',                   authenticate, authorize('admin'),            listLatestRisk);
router.get('/:tourist/history',   authenticate, authorize('admin', 'tourist'), validate(touristParam, 'params'), getRiskHistory);
router.post('/:tourist/evaluate', authenticate, authorize('admin'),            validate(touristParam, 'params'), forceEvaluate);

module.exports = router;
