const express = require('express');
const { overview } = require('../controllers/analytics.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

const router = express.Router();

router.get('/overview', authenticate, authorize('admin'), overview);

module.exports = router;
