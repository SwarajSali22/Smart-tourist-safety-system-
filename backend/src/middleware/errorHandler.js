const env = require('../config/env');

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
 * Central error handler. Never leaks stack traces; in production a 5xx answers
 * with a generic message (details stay in the server log, without the request
 * body or user data). Errors we raise ourselves carry `statusCode` and a message
 * that is safe to show.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.statusCode || err.status || 500;
  let message = err.message || 'Internal server error';

  if (err.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON body'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Request body too large'; }
  else if (err.name === 'CastError') { status = 400; message = 'Invalid id or value'; }
  else if (err.name === 'ValidationError') { status = 400; message = 'Invalid data'; }
  else if (err.code === 11000) { status = 409; message = 'Already exists'; }

  if (status >= 500) {
    // Log what we need to debug, not the payload.
    console.error(`[error] ${req.method} ${req.path} -> ${err.name || 'Error'}: ${err.message}`);
    if (env.nodeEnv !== 'production' && env.nodeEnv !== 'test' && err.stack) console.error(err.stack);
    if (env.nodeEnv === 'production') message = 'Internal server error';
  }

  res.status(status).json({ success: false, message });
}

module.exports = { notFoundHandler, errorHandler };
