const express = require('express');
const { status, chat } = require('../controllers/copilot.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { limiter } = require('../middleware/rateLimits');
const { copilotChatSchema } = require('../validation/schemas');

const router = express.Router();

// Per-user burst limit on top of the daily cap in the controller (each question can cost AI-provider money).
const copilotLimiter = limiter({
  windowMs: 60 * 1000, limit: 15, message: 'Too many Copilot questions — wait a minute',
  keyGenerator: (req) => `copilot:${req.user?.id || req.ip}`,
});

// Admins and tourists only (responders have no Copilot).
router.use(authenticate, authorize('admin', 'tourist'));
router.get('/status', status);
router.post('/chat', copilotLimiter, validate(copilotChatSchema), chat);

module.exports = router;
