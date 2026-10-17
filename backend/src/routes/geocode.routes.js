const express = require('express');
const { status, search, reverseLookup } = require('../controllers/geocode.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { limiter } = require('../middleware/rateLimits');
const { geocodeSearchQuery, geocodeReverseQuery } = require('../validation/schemas');

const router = express.Router();

// Admin-only; capped per IP so the form cannot hammer the shared upstream provider.
const geocodeLimiter = limiter({ windowMs: 60 * 1000, limit: 40, message: 'Too many place lookups — slow down' });

router.use(authenticate, authorize('admin'));
router.get('/status', status);
router.get('/search', geocodeLimiter, validate(geocodeSearchQuery, 'query'), search);
router.get('/reverse', geocodeLimiter, validate(geocodeReverseQuery, 'query'), reverseLookup);

module.exports = router;
