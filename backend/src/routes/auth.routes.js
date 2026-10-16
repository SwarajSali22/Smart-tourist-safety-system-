const express = require('express');
const { register, login, refresh, logout, me } = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { loginLimiter, registerLimiter, refreshLimiter } = require('../middleware/rateLimits');
const { registerSchema, loginSchema, refreshSchema } = require('../validation/schemas');

const router = express.Router();

router.post('/register', registerLimiter, validate(registerSchema), register);
router.post('/login',    loginLimiter, validate(loginSchema), login);
router.post('/refresh',  refreshLimiter, validate(refreshSchema), refresh);
router.post('/logout',   logout);
router.get('/me',        authenticate, me);

module.exports = router;
