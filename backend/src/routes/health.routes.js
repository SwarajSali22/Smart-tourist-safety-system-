const express = require('express');
const { getHealth, getHealthDetails } = require('../controllers/health.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.get('/health', getHealth); // public liveness probe
router.get('/health/details', authenticate, authorize('admin'), getHealthDetails); // admin diagnostics

module.exports = router;
