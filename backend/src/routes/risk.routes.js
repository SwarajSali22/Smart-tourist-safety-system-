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

// The weights, bands and method behind every score (so the UI can describe the model accurately)
router.get('/config', authenticate, (req, res) => {
  const { risk } = require('../config/thresholds');
  res.json({ success: true, method: 'rule-based-hybrid', description: 'Deterministic rules decide emergencies; a weighted rule-based score is advisory. No trained machine-learning model is used.', weights: risk.weights, bands: risk.bands, proximityM: risk.proximityM });
});
router.get('/mine',               authenticate, authorize('tourist'),          getMyRisk);
router.get('/',                   authenticate, authorize('admin'),            listLatestRisk);
router.get('/:tourist/history',   authenticate, authorize('admin', 'tourist'), validate(touristParam, 'params'), getRiskHistory);
router.post('/:tourist/evaluate', authenticate, authorize('admin'),            validate(touristParam, 'params'), forceEvaluate);

module.exports = router;
