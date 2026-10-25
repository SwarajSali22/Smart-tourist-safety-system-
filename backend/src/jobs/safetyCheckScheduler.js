const { Device, SafetyCheck, Incident } = require('../models');
const { escalateIncident, ACTIVE_STATUSES } = require('../services/incidents/lifecycle');
const { sweepTrips } = require('../services/trips/tripMonitor');
const { sweepRisk } = require('../services/riskAssessment/sweepRisk');
const { escalateMissedCheck } = require('../services/safetyCheck/escalate');
const env = require('../config/env');
const thresholds = require('../config/thresholds');

const SWEEP_MS = 60 * 1000;
const { recordRun } = require('../services/health/jobStatus');

/**
 * Two-pass sweep, run every 60s:
 *  1. Prompt pass — devices actively reporting telemetry with no pending
 *     check, whose last check (or lack thereof) is old enough, get a new
 *     SafetyCheck + safetycheck:prompt.
 *  2. Escalation pass — pending checks past the response window escalate
 *     into an Incident (services/safetyCheck/escalate.js).
 */
async function sweep(io) {
  const now = Date.now();
  const intervalMs = env.safetyCheckIntervalMinutes * 60 * 1000;
  const windowMs = env.safetyCheckResponseWindowMinutes * 60 * 1000;

  // ── Prompt pass ──────────────────────────────────────────────────────────
  // Only devices that are actually reporting right now — a stale simulator/wristband must not
  // be prompted (an unanswered prompt would later raise an SOS from an old location).
  const activeDevices = await Device.find({
    status: 'active',
    tourist: { $ne: null },
    lastSeen: { $gte: new Date(now - thresholds.device.staleMs) },
  });

  for (const device of activeDevices) {
    const pending = await SafetyCheck.findOne({
      tourist: device.tourist,
      respondedAt: null,
      escalated: false,
    });
    if (pending) continue;

    const lastCheck = await SafetyCheck.findOne({ tourist: device.tourist }).sort({ scheduledAt: -1 });
    const dueSince = lastCheck ? lastCheck.scheduledAt.getTime() : device.lastSeen?.getTime() || now;
    if (now - dueSince < intervalMs) continue;

    const safetyCheck = await SafetyCheck.create({
      tourist: device.tourist,
      scheduledAt: new Date(),
      triggeredBy: 'scheduler',
    });

    if (io) {
      io.to('admin').emit('safetycheck:prompt', safetyCheck);
      io.to(`tourist:${device.tourist}`).emit('safetycheck:prompt', safetyCheck);
    }
  }

  // ── Escalation pass ──────────────────────────────────────────────────────
  const overdue = await SafetyCheck.find({
    respondedAt: null,
    escalated: false,
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
