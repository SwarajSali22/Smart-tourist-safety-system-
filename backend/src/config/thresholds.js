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
  // Silence clock (services/safetyCheck/workflow.js). "Silence" = time since the last qualifying signal, i.e. the
  // newer of the last GPS position received and the last confirmed check-in. Defaults 15 / 20 / 25 minutes.
  safetyWorkflow: (() => {
    const n = (v, d) => (Number(v) > 0 ? Number(v) : d);
    let overdue = n(process.env.SAFETY_OVERDUE_MIN, 15);
    let request = n(process.env.SAFETY_REQUEST_MIN, 20);
    let escalate = n(process.env.SAFETY_ESCALATE_MIN, 25);
    if (!(overdue < request && request < escalate)) { overdue = 15; request = 20; escalate = 25; } // misordered → defaults
    return {
      overdueMs: overdue * MIN,
      requestMs: request * MIN,
      escalateMs: escalate * MIN,
      // Beyond this much silence the tourist is treated as off-duty (phone off overnight, trip over): no new alert.
      maxMonitorMs: n(process.env.SAFETY_MAX_MONITOR_HOURS, 12) * 60 * MIN,
    };
  })(),
  // An incident that sits in a state this long is "overdue" (shown in the UI, never auto-actioned).
  incidentOverdueMs: {
    open: 2 * MIN,          // New, nobody has acknowledged it
    in_progress: 10 * MIN,  // Acknowledged, nobody assigned
    assigned: 15 * MIN,     // Assigned, not yet en route
    en_route: 45 * MIN,     // En route, not yet resolved
  },
  // Rule-based / hybrid risk scoring. Each factor contributes at most its weight (default weights sum
  // to 100). Override the weights with RISK_WEIGHTS='{"safetyCheck":30,...}' (partial objects are fine).
  risk: {
    weights: (() => {
      const base = { safetyCheck: 25, zoneRisk: 25, violation: 20, incident: 15, movement: 10, connectivity: 5 };
      try { return { ...base, ...JSON.parse(process.env.RISK_WEIGHTS || '{}') }; } catch { return base; }
    })(),
    bands: { medium: 30, high: 60, critical: 85 },   // score at which each level starts
    staleDeviceMs: 30 * MIN,                          // no telemetry for this long while "active"
    lowBattery: 20,
    violationWindowMs: 24 * 60 * MIN,
    violationPoints: 10,                              // per recent zone entry
    incidentPoints: 8,                                // per open incident
    checkSample: 5,                                   // most recent check-ins considered
    proximityM: Number(process.env.RISK_PROXIMITY_M) || 300, // near (but outside) a restricted/danger zone
    proximityShare: 0.4,                              // share of the zone-risk weight earned by proximity alone
    // Alert lifecycle: a location older than device.staleMs is "stale" and never proves the tourist is in a zone.
    clearMs: (Number(process.env.RISK_CLEAR_MIN) || 15) * MIN,              // below "high" this long (on fresh data) → auto-resolve
    reopenCooldownMs: (Number(process.env.RISK_REOPEN_COOLDOWN_MIN) || 30) * MIN, // after a resolve, no new alert for the same condition
    repeatNoteMs: 30 * MIN,                                                  // a still-open alert gets at most one timeline note per interval
    outdatedMs: 30 * MIN,                                                    // a score older than this is shown as outdated, not current
    refreshMs: 5 * MIN,                                                      // high/critical scores older than this are re-evaluated by the scheduler
  },
  // Escalation of high-priority incidents (checked by the scheduler; each incident escalates once).
  // Override with INCIDENT_ESCALATE_UNACK_MIN / INCIDENT_ESCALATE_UNRESOLVED_MIN.
  escalation: {
    unacknowledgedMs: (Number(process.env.INCIDENT_ESCALATE_UNACK_MIN) || 5) * MIN,
    unresolvedMs: (Number(process.env.INCIDENT_ESCALATE_UNRESOLVED_MIN) || 60) * MIN,
    priorities: ['high', 'urgent'],
  },
};
