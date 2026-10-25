/**
 * Tiny in-memory record of the background scheduler's runs, so the health page can show REAL
 * facts (when it last ran, how long it took, the last error) instead of a hardcoded "ok".
 * Memory only: it resets when the server restarts, which is exactly when "never run yet" is true.
 */
const jobs = {};
const startedAt = new Date();

function recordRun(name, { ok, error = null, durationMs = 0, expectedEveryMs }) {
  const j = (jobs[name] ||= { runs: 0, failures: 0, lastRunAt: null, lastSuccessAt: null, lastError: null, lastErrorAt: null, lastDurationMs: null, expectedEveryMs });
  j.runs += 1;
  j.lastRunAt = new Date();
  j.lastDurationMs = durationMs;
  j.expectedEveryMs = expectedEveryMs;
  if (ok) {
    j.lastSuccessAt = j.lastRunAt;
  } else {
    j.failures += 1;
    j.lastError = String(error || 'unknown error').slice(0, 200); // short reason, never a stack trace
    j.lastErrorAt = j.lastRunAt;
  }
}

/** Plain copy (Dates kept) so callers can't mutate the registry. */
const getJobs = () => Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, { ...v }]));

module.exports = { recordRun, getJobs, startedAt };
