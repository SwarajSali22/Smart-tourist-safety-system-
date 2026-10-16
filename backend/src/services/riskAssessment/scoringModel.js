const { SafetyCheck, Device, GeofenceEvent, Incident } = require('../../models');

// Advisory layer (Phase 0 plan §9) — a transparent, weighted function over
// safety-check responses, zone risk, recent violations, incident history,
// movement pattern, and device/connectivity status. Weights sum to 100 so
// `score` and each `factors.*` value share the same 0–100 scale as the
// RiskAssessment schema.
const WEIGHTS = {
  safetyCheck: 25,
  zoneRisk: 25,
  violation: 20,
  incident: 15,
  movement: 10,
  connectivity: 5,
};

const STALE_DEVICE_MS = 30 * 60 * 1000; // no telemetry for 30min while "active" looks like lost signal
const LOW_BATTERY_THRESHOLD = 20;
const RECENT_VIOLATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_CHECK_SAMPLE = 5;

async function computeScore(touristId) {
  const [recentChecks, device, recentViolations, openIncidents] = await Promise.all([
    SafetyCheck.find({ tourist: touristId }).sort({ scheduledAt: -1 }).limit(RECENT_CHECK_SAMPLE),
    Device.findOne({ tourist: touristId }).populate('currentZones', 'riskLevel'),
    GeofenceEvent.countDocuments({
      tourist: touristId,
      eventType: 'enter',
      createdAt: { $gte: new Date(Date.now() - RECENT_VIOLATION_WINDOW_MS) },
    }),
    Incident.countDocuments({ tourist: touristId, status: { $in: ['open', 'in_progress'] } }),
  ]);

  // Unsafe responses weigh more than an escalated no-response; a pending
  // (not yet overdue) or "safe" check contributes nothing.
  const checkPoints = recentChecks.reduce((sum, check) => {
    if (check.response === 'unsafe') return sum + 5;
    if (check.escalated) return sum + 4;
    return sum;
  }, 0);
  const safetyCheckScore = Math.min(WEIGHTS.safetyCheck, checkPoints);

  const maxZoneRisk = device?.currentZones?.length
    ? Math.max(...device.currentZones.map((z) => z.riskLevel || 0))
    : 0;
  const zoneRiskScore = Math.round((maxZoneRisk / 100) * WEIGHTS.zoneRisk);

  const violationScore = Math.min(WEIGHTS.violation, recentViolations * 10);

  const incidentScore = Math.min(WEIGHTS.incident, openIncidents * 8);

  const movementScore =
    device?.status === 'active' &&
    (!device.lastSeen || Date.now() - device.lastSeen.getTime() > STALE_DEVICE_MS)
      ? WEIGHTS.movement
      : 0;

  const connectivityScore =
    typeof device?.battery === 'number' && device.battery < LOW_BATTERY_THRESHOLD
      ? WEIGHTS.connectivity
      : 0;

  const factors = {
    safetyCheckScore,
    zoneRiskScore,
    violationScore,
    incidentScore,
    movementScore,
    connectivityScore,
  };

  const score = Math.min(100, Object.values(factors).reduce((a, b) => a + b, 0));

  return { score, factors };
}

function scoreToLevel(score) {
  if (score >= 85) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

module.exports = { computeScore, scoreToLevel, WEIGHTS };
