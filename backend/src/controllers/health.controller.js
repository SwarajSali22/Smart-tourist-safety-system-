const mongoose = require('mongoose');

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/**
 * GET /api/health
 * Reports process liveness and current database connection state.
 * Intentionally has no dependency on the database being up — the endpoint
 * itself always returns 200 so it can be used as a basic liveness probe.
 */
function getHealth(req, res) {
  res.status(200).json({
    success: true,
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: DB_STATES[mongoose.connection.readyState] || 'unknown',
  });
}

module.exports = { getHealth };
