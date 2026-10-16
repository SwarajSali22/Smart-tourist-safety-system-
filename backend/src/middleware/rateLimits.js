const { rateLimit } = require('express-rate-limit');

function limiter({ windowMs, limit, message, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => res.status(429).json({ success: false, message }),
  });
}

// Tourist phone GPS: at most 1 report per 3 seconds per signed-in user.
// Must run after `authenticate` so req.user is set.
const locationLimiter = limiter({
  windowMs: 3000,
  limit: 1,
  message: 'Too many location updates — send at most one every 3 seconds',
  keyGenerator: (req) => String(req.user.id),
});

module.exports = { limiter, locationLimiter };
