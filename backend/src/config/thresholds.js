/**
 * Operational thresholds in one place. The client mirrors the device-freshness
 * values in client/src/shared/utils/freshness.js — keep the two in step.
 */
const MIN = 60 * 1000;

module.exports = {
  // Device freshness: how long since the last ping before we call it stale / offline.
  device: {
    liveMs: 2 * MIN,      // ≤ 2 min  → live
    staleMs: 15 * MIN,    // ≤ 15 min → stale (shown grey), beyond → offline
  },
  // An incident that sits in a state this long is "overdue" (shown in the UI, never auto-actioned).
  incidentOverdueMs: {
    open: 2 * MIN,          // New, nobody has acknowledged it
    in_progress: 10 * MIN,  // Acknowledged, nobody assigned
    assigned: 15 * MIN,     // Assigned, not yet en route
    en_route: 45 * MIN,     // En route, not yet resolved
  },
};
