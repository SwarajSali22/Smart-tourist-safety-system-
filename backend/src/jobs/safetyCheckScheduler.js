const { SafetyCheck, Incident } = require('../models');
const { escalateIncident, ACTIVE_STATUSES } = require('../services/incidents/lifecycle');
const { sweepTrips } = require('../services/trips/tripMonitor');
const { sweepRisk } = require('../services/riskAssessment/sweepRisk');
const { escalateMissedCheck } = require('../services/safetyCheck/escalate');
const { sweepSilence } = require('../services/safetyCheck/workflow');
const env = require('../config/env');
const thresholds = require('../config/thresholds');

const SWEEP_MS = 60 * 1000;
const { recordRun } = require('../services/health/jobStatus');

/**
 * Run every 60s:
 *  1. Silence clock — 15 min overdue / 20 min check-in request / 25 min automated safety alert
 *     (services/safetyCheck/workflow.js).
 *  2. Legacy pass — admin-triggered checks that went unanswered past the response window become a safety alert
 *     (never an SOS).
 */
async function sweep(io, now = Date.now()) {
  const windowMs = env.safetyCheckResponseWindowMinutes * 60 * 1000;

  await sweepSilence(io, now);

  // ── Escalation pass ──────────────────────────────────────────────────────
  const overdue = await SafetyCheck.find({
    respondedAt: null,
    escalated: false,
    episodeAt: null, // silence-clock checks are handled by sweepSilence
    closedAt: null,
    scheduledAt: { $lte: new Date(now - windowMs) },
  });

  // Checks that expired long ago (e.g. while the server was stopped) are retired, not escalated:
  // raising an SOS on restart for a prompt nobody could answer would fabricate a fresh emergency.
  const expiredBefore = now - (windowMs + 3 * SWEEP_MS);
  for (const safetyCheck of overdue) {
    if (safetyCheck.scheduledAt.getTime() < expiredBefore) {
      safetyCheck.escalated = true;
      safetyCheck.message = safetyCheck.message || 'Expired without escalation (system was not running)';
      await safetyCheck.save();
      continue;
    }
    await escalateMissedCheck(safetyCheck, io);
  }

  await escalateStaleIncidents(now);
  await sweepRisk(io, now).catch((err) => console.error('[riskSweep]', err.message));
  await sweepTrips(io, now).catch((err) => console.error('[tripMonitor]', err.message));
}

/** High-priority incidents nobody acknowledged (or that stay unresolved too long) are escalated once. */
async function escalateStaleIncidents(now) {
  const { escalation } = thresholds;
  const candidates = await Incident.find({
    status: { $in: ACTIVE_STATUSES },
    priority: { $in: escalation.priorities },
    escalatedAt: null,
  });
  for (const incident of candidates) {
    const age = now - new Date(incident.createdAt).getTime();
    const mins = (ms) => Math.round(ms / 60000);
    if (incident.status === 'open' && age > escalation.unacknowledgedMs) {
      await escalateIncident(incident, `Not acknowledged within ${mins(escalation.unacknowledgedMs)} min`);
    } else if (age > escalation.unresolvedMs) {
      await escalateIncident(incident, `Still unresolved after ${mins(escalation.unresolvedMs)} min`);
    }
  }
}

function startSafetyCheckScheduler(io) {
  setInterval(() => {
    // Every run is recorded (time, duration, error) for the System health page.
    const t0 = Date.now();
    sweep(io)
      .then(() => recordRun('safetyCheckScheduler', { ok: true, durationMs: Date.now() - t0, expectedEveryMs: SWEEP_MS }))
      .catch((err) => {
        console.error('[safetyCheckScheduler]', err);
        recordRun('safetyCheckScheduler', { ok: false, error: err.message, durationMs: Date.now() - t0, expectedEveryMs: SWEEP_MS });
      });
  }, SWEEP_MS);
}

module.exports = { startSafetyCheckScheduler, sweep };
