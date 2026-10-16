const { verifyAccessToken } = require('../services/auth.service');

/**
 * Verifies the Bearer token in the Authorization header.
 * On success, attaches `req.user = { id, role }` and calls next().
 * On failure, returns 401 — never calls next(err) so the error handler
 * doesn't accidentally leak stack traces for auth failures.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = authenticate;
