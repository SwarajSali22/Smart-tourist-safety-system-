const { SafetyCheck, Device, GeofenceEvent, Incident, Zone } = require('../../models');
const thresholds = require('../../config/thresholds');
const { locationFreshness } = require('./ruleEngine');

/**
 * Rule-based / hybrid risk assessment (this is NOT a trained machine-learning model): a
 * deterministic rule engine decides emergencies, and this transparent weighted function adds an
 * advisory 0–100 score from safety-check responses, zone risk and proximity, recent violations,
 * open incidents, stale location data and low battery. Weights and thresholds live in
 * config/thresholds.js (`risk`). Every factor is returned with a plain-language explanation.
 */
const cfg = thresholds.risk;
const WEIGHTS = cfg.weights;

async function computeScore(touristId) {
  const [recentChecks, device, recentViolations, openIncidents] = await Promise.all([
    SafetyCheck.find({ tourist: touristId }).sort({ scheduledAt: -1 }).limit(cfg.checkSample),
    Device.findOne({ tourist: touristId }).populate('currentZones', 'name type riskLevel'),
    GeofenceEvent.countDocuments({
      tourist: touristId,
      eventType: 'enter',
      createdAt: { $gte: new Date(Date.now() - cfg.violationWindowMs) },
    }),
    Incident.countDocuments({ tourist: touristId, status: { $in: ['open', 'in_progress'] } }),
  ]);

  // Safety check-ins: "unsafe" weighs more than an escalated no-response; pending/safe add nothing.
  const unsafe = recentChecks.filter((c) => c.response === 'unsafe').length;
  const missed = recentChecks.filter((c) => c.response !== 'unsafe' && c.escalated).length;
  const safetyCheckScore = Math.min(WEIGHTS.safetyCheck, unsafe * 5 + missed * 4);

  const loc = locationFreshness(device);

  // Zone risk: inside a zone → its risk level; otherwise, being close to a restricted/danger zone earns a share.
  const inside = device?.currentZones || [];
  const maxZoneRisk = inside.length && !loc.stale ? Math.max(...inside.map((z) => z.riskLevel || 0)) : 0;
  let zoneRiskScore = Math.round((maxZoneRisk / 100) * WEIGHTS.zoneRisk);
  let zoneDetail = loc.stale
    ? (loc.known ? `Last position is ${loc.ageMin} min old, so zone risk is not counted (an old fix does not show where the tourist is now).` : 'No location has been reported yet, so zone risk is not counted.')
    : inside.length
    ? `Currently inside ${inside.map((z) => z.name).join(', ')} (zone risk ${maxZoneRisk}/100).`
    : 'Not inside any configured zone.';
  if (!loc.stale && !inside.length && device?.lastLocation?.lat != null) {
    const near = await Zone.find({
      isActive: true,
      type: { $in: ['restricted', 'danger'] },
      geometry: { $near: { $geometry: { type: 'Point', coordinates: [device.lastLocation.lng, device.lastLocation.lat] }, $maxDistance: cfg.proximityM } },
    }).select('name type riskLevel').limit(3).lean();
    if (near.length) {
      const worst = Math.max(...near.map((z) => z.riskLevel || (z.type === 'danger' ? 80 : 40)));
      zoneRiskScore = Math.round((worst / 100) * WEIGHTS.zoneRisk * cfg.proximityShare);
      zoneDetail = `Within ${cfg.proximityM} m of ${near.map((z) => z.name).join(', ')} (${near[0].type} zone).`;
    }
  }

  const violationScore = Math.min(WEIGHTS.violation, recentViolations * cfg.violationPoints);
  const incidentScore = Math.min(WEIGHTS.incident, openIncidents * cfg.incidentPoints);

  const sinceSeen = device?.lastSeen ? Date.now() - device.lastSeen.getTime() : null;
  const stale = device?.status === 'active' && (sinceSeen == null || sinceSeen > cfg.staleDeviceMs);
  const movementScore = stale ? WEIGHTS.movement : 0;
  const lowBattery = typeof device?.battery === 'number' && device.battery < cfg.lowBattery;
  const connectivityScore = lowBattery ? WEIGHTS.connectivity : 0;

  const factors = { safetyCheckScore, zoneRiskScore, violationScore, incidentScore, movementScore, connectivityScore };
  const score = Math.min(100, Object.values(factors).reduce((a, b) => a + b, 0));

  const explanation = [
    { key: 'safetyCheckScore', label: 'Safety check-ins', points: safetyCheckScore, max: WEIGHTS.safetyCheck,
      detail: unsafe || missed ? `${unsafe} "unsafe" answer(s) and ${missed} missed check-in(s) in the last ${recentChecks.length}.` : 'No unsafe or missed check-ins recently.' },
    { key: 'zoneRiskScore', label: 'Zone risk and proximity', points: zoneRiskScore, max: WEIGHTS.zoneRisk, detail: zoneDetail },
    { key: 'violationScore', label: 'Recent zone violations', points: violationScore, max: WEIGHTS.violation,
      detail: recentViolations ? `${recentViolations} restricted/danger zone entr${recentViolations === 1 ? 'y' : 'ies'} in the last 24 h.` : 'No zone entries in the last 24 h.' },
    { key: 'incidentScore', label: 'Open incidents', points: incidentScore, max: WEIGHTS.incident,
      detail: openIncidents ? `${openIncidents} open incident(s) for this tourist.` : 'No open incidents.' },
    { key: 'movementScore', label: 'Stale location data', points: movementScore, max: WEIGHTS.movement,
      detail: stale ? (sinceSeen == null ? 'The device is marked active but has never reported a location.' : `No location update for ${Math.round(sinceSeen / 60000)} min while marked active.`) : 'Location updates are current (or the device is not active).' },
    { key: 'connectivityScore', label: 'Low battery', points: connectivityScore, max: WEIGHTS.connectivity,
      detail: lowBattery ? `Battery at ${device.battery}%.` : 'Battery level is fine or unknown.' },
  ];

  return { score, factors, explanation, locationStale: loc.stale, locationAgeMin: loc.ageMin };
}

function scoreToLevel(score) {
  if (score >= cfg.bands.critical) return 'critical';
  if (score >= cfg.bands.high) return 'high';
  if (score >= cfg.bands.medium) return 'medium';
  return 'low';
}

module.exports = { computeScore, scoreToLevel, WEIGHTS };
