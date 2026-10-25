const mongoose = require('mongoose');
const { getHealthDetails } = require('../services/health/healthChecks');

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

/**
 * GET /api/health/details  (admin only)
 * Component-by-component health for the admin "System health" page. Contains no credentials, keys or
 * personal data: only statuses, counts, timings and short error reasons.
 */
async function getHealthDetailsHandler(req, res, next) {
  try {
    res.json({ success: true, ...(await getHealthDetails()) });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth, getHealthDetails: getHealthDetailsHandler };
