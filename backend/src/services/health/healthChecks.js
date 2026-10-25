const mongoose = require('mongoose');
const { Device, Notification } = require('../../models');
const { getIo } = require('../realtime');
const { isConfigured: smsConfigured } = require('../notifications/sms');
const thresholds = require('../../config/thresholds');
const { getJobs, startedAt } = require('./jobStatus');

/**
 * System health, built from real checks. Every component reports one of:
 *   healthy | degraded | unavailable | unknown
 * "unknown" is used when something cannot be verified from here (e.g. an external SMS provider we
 * don't probe) — we never guess "healthy". The result is cached for CACHE_MS so refreshing the page
 * (or several admins at once) cannot hammer the database.
 */
const CACHE_MS = 10 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const RANK = { healthy: 0, unknown: 0, degraded: 1, unavailable: 2 };
let cache = null;

const comp = (status, message, details = {}) => ({ status, message, ...details });
const dbUp = () => mongoose.connection.readyState === 1;

async function checkDatabase() {
  if (!dbUp()) return comp('unavailable', 'Database is not connected');
  const t0 = Date.now();
  try {
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ping timed out')), 3000)),
    ]);
    const latencyMs = Date.now() - t0;
    return latencyMs > 1000 ? comp('degraded', `Responding slowly (${latencyMs} ms)`, { latencyMs }) : comp('healthy', 'Connected and responding', { latencyMs });
  } catch (err) {
    return comp('unavailable', `Database check failed: ${err.message}`);
  }
}

function checkRealtime() {
  const io = getIo();
  if (!io) return comp('unknown', 'Real-time server is not initialised in this process');
  return comp('healthy', 'Socket.IO server is running', { connectedClients: io.engine?.clientsCount ?? 0 });
}

async function checkSms() {
  if (!smsConfigured()) return comp('unknown', 'Not configured — SMS alerts are off (SOS still works)', { configured: false });
  // Attempts in the last 24 h. "accepted" = the provider took the message; we receive no delivery
  // receipts, so we never claim a text was delivered.
  const rows = await Notification.find({ channel: 'sms', createdAt: { $gte: new Date(Date.now() - DAY) } }).select('delivered error').sort({ createdAt: -1 }).lean();
  const accepted = rows.filter((r) => r.delivered).length;
  const failed = rows.length - accepted;
  const lastError = rows.find((r) => !r.delivered && r.error)?.error || 'unknown error';
  const base = { configured: true, last24h: { attempts: rows.length, acceptedByProvider: accepted, failed }, note: 'Provider delivery receipts are not tracked' };
  if (!rows.length) return comp('unknown', 'Configured, but no SMS was sent in the last 24 h, so the provider has not been exercised', base);
  if (failed && !accepted) return comp('unavailable', `All ${failed} recent SMS attempt(s) failed: ${lastError}`, base);
  if (failed) return comp('degraded', `${failed} of ${rows.length} recent SMS attempt(s) failed: ${lastError}`, base);
  return comp('healthy', `${accepted} recent SMS attempt(s) accepted by the provider`, base);
}

async function checkDevices() {
  const devices = await Device.find({ tourist: { $ne: null } }).select('lastSeen').lean();
  if (!devices.length) return comp('unknown', 'No devices are assigned to tourists yet', { live: 0, stale: 0, offline: 0, total: 0 });
  const now = Date.now();
  let live = 0;
  let stale = 0;
  let offline = 0;
  for (const d of devices) {
    const age = d.lastSeen ? now - new Date(d.lastSeen).getTime() : Infinity;
    if (age <= thresholds.device.liveMs) live += 1;
    else if (age <= thresholds.device.staleMs) stale += 1;
    else offline += 1;
  }
  const counts = { live, stale, offline, total: devices.length };
  if (live === 0) return comp('degraded', 'No device has reported recently — locations are not live', counts);
  return comp('healthy', `${live} live, ${stale} stale, ${offline} offline`, counts);
}

function checkScheduler() {
  const job = getJobs().safetyCheckScheduler;
  if (!job) {
    // The first sweep happens one interval after start-up, so "not run yet" is normal for a minute or two.
    const young = Date.now() - startedAt.getTime() < 3 * 60 * 1000;
    return comp(young ? 'unknown' : 'unavailable', young ? 'Starting up — first sweep has not run yet' : 'Scheduler has not run since start-up');
  }
  const info = { runs: job.runs, failures: job.failures, lastRunAt: job.lastRunAt, lastDurationMs: job.lastDurationMs, lastError: job.lastError };
  if (Date.now() - job.lastRunAt.getTime() > 3 * job.expectedEveryMs) return comp('unavailable', 'Scheduler has stopped running (its last sweep is overdue)', info);
  if (job.lastErrorAt && job.lastErrorAt.getTime() === job.lastRunAt.getTime()) return comp('degraded', `Last sweep failed: ${job.lastError}`, info);
  return comp('healthy', 'Sweeps are running on schedule', info);
}

/** Recent problems: the scheduler's last error plus every component that is not currently fine. */
function recentFailures(components) {
  const list = [];
  const job = getJobs().safetyCheckScheduler;
  if (job?.lastError) list.push({ at: job.lastErrorAt, component: 'scheduler', message: job.lastError });
  for (const [name, c] of Object.entries(components)) {
    if (c.status === 'unavailable' || c.status === 'degraded') list.push({ at: null, component: name, message: c.message });
  }
  return list;
}

async function runChecks() {
  const skipped = comp('unknown', 'Skipped: database unavailable');
  const [database, sms, devices] = await Promise.all([
    checkDatabase(),
    dbUp() ? checkSms().catch((e) => comp('unknown', `Could not read SMS history: ${e.message}`)) : skipped,
    dbUp() ? checkDevices().catch((e) => comp('unknown', `Could not read devices: ${e.message}`)) : skipped,
  ]);
  const components = {
    api: comp('healthy', 'API is answering requests', { uptimeSeconds: Math.round(process.uptime()) }),
    database,
    realtime: checkRealtime(),
    sms,
    devices,
    scheduler: checkScheduler(),
  };
  const worst = Math.max(...Object.values(components).map((c) => RANK[c.status]));
  const overall = worst === 2 ? 'unavailable' : worst === 1 ? 'degraded' : 'healthy';
  return { overall, checkedAt: new Date().toISOString(), components, recentFailures: recentFailures(components) };
}

/** Cached for CACHE_MS; `force` bypasses the cache (used by tests). */
async function getHealthDetails({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = await runChecks();
  cache = { at: Date.now(), data };
  return data;
}

module.exports = { getHealthDetails };
