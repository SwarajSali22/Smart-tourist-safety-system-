/**
 * How fresh is a device's data? Mirrors backend/src/config/thresholds.js (device.liveMs / staleMs).
 *  live    — pinged within 2 min
 *  stale   — pinged within 15 min (shown grey on the map)
 *  offline — nothing for longer than that
 *  never   — the device has not reported yet
 */
export const FRESH = { liveMs: 2 * 60 * 1000, staleMs: 15 * 60 * 1000 };

export function freshnessOf(lastSeen, now = Date.now()) {
  if (!lastSeen) return 'never';
  const age = now - new Date(lastSeen).getTime();
  if (age <= FRESH.liveMs) return 'live';
  if (age <= FRESH.staleMs) return 'stale';
  return 'offline';
}

// An old fix is never called "live": 2–15 min = Last known, beyond = Overdue (last known position only).
export const FRESH_LABEL = { live: 'Live', stale: 'Last known', offline: 'Overdue · last known', never: 'Location unavailable' };
export const FRESH_VARIANT = { live: 'success', stale: 'warning', offline: 'neutral', never: 'neutral' };

/**
 * Where the position comes from, labelled distinctly so simulated data is never
 * mistaken for a real wristband: Phone | Simulator | Wristband.
 */
export function sourceOf(device) {
  if (device?.type === 'phone') return 'Phone';
  if (device?.isSimulated || device?.isDemo || device?.tourist?.isDemo) return 'Simulator';
  return 'Wristband';
}

// Incident overdue thresholds, mirrored from backend/src/config/thresholds.js
export const INCIDENT_OVERDUE_MS = { open: 2 * 60e3, in_progress: 10 * 60e3, assigned: 15 * 60e3, en_route: 45 * 60e3 };
export function incidentOverdue(incident, now = Date.now()) {
  const limit = INCIDENT_OVERDUE_MS[incident.status];
  if (!limit) return false;
  const since = new Date(incident.lastActivity?.at || incident.updatedAt || incident.createdAt).getTime();
  return now - since > limit;
}
