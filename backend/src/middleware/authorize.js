/**
 * Role-based access guard. Must be used after `authenticate`.
 *
 * Usage:
 *   router.delete('/zones/:id', authenticate, authorize('admin'), handler)
 *   router.get('/profile',      authenticate, authorize('tourist', 'admin'), handler)
 */
function authorize(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}

module.exports = authorize;
