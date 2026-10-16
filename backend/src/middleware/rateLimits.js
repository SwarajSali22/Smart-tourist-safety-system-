const { rateLimit } = require('express-rate-limit');
const env = require('../config/env');

/**
 * Rate limiting (express-rate-limit). Limits are skipped under test unless a test
 * flips `env.rateLimitEnabled` on, and can be disabled for local load testing
 * with RATE_LIMIT_DISABLED=1. Hitting a limit answers 429 { success:false, message }.
 */
function limiter({ windowMs, limit, message, keyGenerator, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    skip: () => !env.rateLimitEnabled,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => res.status(429).json({ success: false, message }),
  });
}

// Strict: credential endpoints (per IP).
// Login counts only FAILED attempts, so a real user is never locked out by their own successes.
const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
  message: 'Too many failed sign-in attempts — try again in 15 minutes',
});
const registerLimiter = limiter({
  windowMs: 60 * 60 * 1000, limit: 10,
  message: 'Too many sign-ups from this address — try again later',
});
const refreshLimiter = limiter({
  windowMs: 15 * 60 * 1000, limit: 60,
  message: 'Too many token refresh requests — try again shortly',
});

// Moderate: device telemetry, per device id (+ IP), applied BEFORE device-key auth so
// bad keys can't be used to burn CPU on bcrypt checks.
const telemetryLimiter = limiter({
  windowMs: 60 * 1000, limit: 300,
  message: 'Telemetry rate limit exceeded — slow down',
  keyGenerator: (req) => `${req.ip}|${req.headers['x-device-id'] || req.params.deviceId || ''}`,
});

// Tourist phone GPS: at most 1 report per 3 seconds per signed-in user (after `authenticate`).
const locationLimiter = limiter({
  windowMs: 3000, limit: 1,
  message: 'Too many location updates — send at most one every 3 seconds',
  keyGenerator: (req) => String(req.user.id),
});

// Broad safety net for the whole API (per IP).
const apiLimiter = limiter({
  windowMs: 60 * 1000, limit: 600,
  message: 'Too many requests — slow down',
});

module.exports = { limiter, loginLimiter, registerLimiter, refreshLimiter, telemetryLimiter, locationLimiter, apiLimiter };
