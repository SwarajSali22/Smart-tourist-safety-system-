const { Device, SafetyCheck } = require('../models');
const { escalateMissedCheck } = require('../services/safetyCheck/escalate');
const env = require('../config/env');

const SWEEP_MS = 60 * 1000;

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
  const activeDevices = await Device.find({ status: 'active', tourist: { $ne: null } });

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

  for (const safetyCheck of overdue) {
    await escalateMissedCheck(safetyCheck, io);
  }
}

function startSafetyCheckScheduler(io) {
  setInterval(() => {
    sweep(io).catch((err) => console.error('[safetyCheckScheduler]', err));
  }, SWEEP_MS);
}

module.exports = { startSafetyCheckScheduler };
