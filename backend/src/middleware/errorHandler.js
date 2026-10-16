/**
 * 404 handler — reached when no route matched.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Central error handler — catches anything thrown or passed to next(err)
 * in any route/middleware. Must be registered last, after all routes.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
  });
}

module.exports = { notFoundHandler, errorHandler };
