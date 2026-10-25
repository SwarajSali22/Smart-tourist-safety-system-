const { Device, SafetyCheck, SOSEvent, Zone, LocationPing, Incident } = require('../../models');
const thresholds = require('../../config/thresholds');
const { logActivity } = require('../activity/logActivity');
const { locationFreshness } = require('../riskAssessment/ruleEngine');
const { onSafetyCheckCreated } = require('../notifications/events');
const { escalateOverdueAlert } = require('./escalate');

/**
 * Silence clock: 15 / 20 / 25 minutes (config/thresholds.js → safetyWorkflow).
 *
 * "Silence" is the time since the last qualifying signal = the NEWER of
 *   - the last GPS position the server received (Device.lastSeen), and
 *   - the last check-in the tourist confirmed (SafetyCheck.respondedAt).
 * Everything is server-side timestamps + one persisted SafetyCheck per silence episode, so it works with no admin
 * page open, survives restarts and is idempotent: a unique (tourist, episodeAt) index means repeated sweeps cannot
 * create a second record, and the escalation is claimed with an atomic update before the incident is created.
 *
 *   ≥ overdue  → record an internal 'overdue' marker (not shown to the tourist yet)
 *   ≥ request  → ask the tourist to confirm they are safe (persistent check + in-app notification)
 *   ≥ escalate → automated SAFETY ALERT for a human (Incident type 'no_response'). Never an SOS, never contacts
 *                emergency services. Waits at least (escalate − request) after the request was actually created,
 *                so a server that was down never escalates a request nobody could have seen.
 *
 * A new GPS position or a confirmed check-in ends the episode. A missed update is a reason to look, not proof of danger.
 */

const cfg = thresholds.safetyWorkflow;
const mins = (ms) => Math.round(ms / 60000);

/** What the admin sees for one tourist. Pure: no I/O, so it is easy to test with a fake clock. */
function describeSignal({ lastSeen, hasLocation, lastCheckInAt }, now = Date.now()) {
  const gps = lastSeen ? new Date(lastSeen).getTime() : null;
  const chk = lastCheckInAt ? new Date(lastCheckInAt).getTime() : null;
  const lastSignal = Math.max(gps ?? 0, chk ?? 0) || null;
  const gpsAgeMs = gps ? now - gps : null;
  const silenceMs = lastSignal ? now - lastSignal : null;
  let status = 'unavailable'; // never reported a position
  if (hasLocation && gps) {
    if (silenceMs >= cfg.overdueMs) status = 'overdue';
    else if (gpsAgeMs <= thresholds.device.liveMs) status = 'live';
    else status = 'last_known';
  }
  return {
    status, // live | last_known | overdue | unavailable. 'live' only when the last fix is ≤ 2 min old.
    lastGpsAt: gps ? new Date(gps) : null,
    lastCheckInAt: chk ? new Date(chk) : null,
    lastSignalAt: lastSignal ? new Date(lastSignal) : null,
    gpsAgeMin: gpsAgeMs == null ? null : mins(gpsAgeMs),
    silenceMin: silenceMs == null ? null : mins(silenceMs),
  };
}

async function latestCheckInAt(touristId) {
  const c = await SafetyCheck.findOne({ tourist: touristId, respondedAt: { $ne: null } }).sort({ respondedAt: -1 }).select('respondedAt').lean();
  return c?.respondedAt || null;
}

const OPEN_STAGES = ['overdue', 'requested', 'escalated'];

async function audit(action, check, summary, metadata) {
  await logActivity({ actor: null, role: 'system', action, targetModel: 'SafetyCheck', targetId: check._id, summary, metadata });
}

/** Zone context for the last KNOWN position. Reuses Zone geometry; never says the tourist is still there. */
async function zoneContext(location) {
  if (location?.lat == null) return { inside: [], near: [] };
  const point = { type: 'Point', coordinates: [location.lng, location.lat] };
  const inside = await Zone.find({ isActive: true, type: { $ne: 'safe' }, geometry: { $geoIntersects: { $geometry: point } } })
    .select('name type riskLevel').lean();
  const insideIds = new Set(inside.map((z) => String(z._id)));
  const nearAll = await Zone.find({
    isActive: true, type: { $in: ['restricted', 'danger'] },
    geometry: { $near: { $geometry: point, $maxDistance: thresholds.risk.proximityM } },
  }).select('name type riskLevel').limit(5).lean();
  return { inside, near: nearAll.filter((z) => !insideIds.has(String(z._id))) };
}

/**
 * Deterministic severity (AI never sets this). Rules, strongest first:
 *   last known position inside a DANGER zone and still fresh → critical (existing risk rule `danger_zone`)
 *   inside a danger zone but stale                          → high   (an old fix is not proof they are there now)
 *   inside a restricted zone                                → high
 *   otherwise (incl. merely near a restricted/danger zone)  → medium
 */
function rateSeverity({ zones, fresh }) {
  const danger = zones.inside.find((z) => z.type === 'danger');
  if (danger) return fresh
    ? { severity: 'critical', rule: 'danger_zone_fresh', why: `Last position is inside the danger zone “${danger.name}” and is recent.` }
    : { severity: 'high', rule: 'danger_zone_stale', why: `Last known position was inside the danger zone “${danger.name}”, but it is old, so this is High, not Critical (the tourist may have left).` };
  const restricted = zones.inside.find((z) => z.type === 'restricted');
  if (restricted) return { severity: 'high', rule: 'restricted_zone', why: `Last known position was inside the restricted zone “${restricted.name}”.` };
  return { severity: 'medium', rule: 'no_signal', why: 'No location or check-in received; no high-risk zone is known at the last position.' };
}

/** Everything the admin needs to judge the alert, captured once at escalation time. */
async function buildContext(check, device, now) {
  const [lastPing, zones] = await Promise.all([
    LocationPing.findOne({ device: device._id }).sort({ timestamp: -1 }).select('accuracy timestamp battery').lean(),
    zoneContext(device.lastLocation),
  ]);
  const fresh = !locationFreshness(device, now).stale;
  const rated = rateSeverity({ zones, fresh });
  const ageMin = device.lastSeen ? mins(now - new Date(device.lastSeen).getTime()) : null;
  const reasons = [
    `No GPS position or check-in received for ${mins(now - new Date(check.episodeAt).getTime())}+ min (episode began ${new Date(check.episodeAt).toISOString()}).`,
    check.requestedAt ? `A check-in request was created at ${new Date(check.requestedAt).toISOString()} and has not been answered.` : 'No check-in request was answered.',
    check.delivery?.note || null,
    rated.why,
    zones.near.length ? `Within ${thresholds.risk.proximityM} m of ${zones.near.map((z) => `${z.name} (${z.type})`).join(', ')}.` : null,
    ageMin != null ? `The zone assessment uses the last known position from ${ageMin} min ago and may be outdated.` : null,
    device.battery != null && device.battery <= thresholds.risk.lowBattery ? `Last reported battery was ${device.battery}% (the phone may have switched off).` : null,
    'Possible harmless causes: no mobile signal, phone off or app closed, GPS permission revoked. This is not an SOS.',
  ].filter(Boolean);
  return {
    kind: 'automated_safety_alert', isSos: false,
    severity: rated.severity, severityRule: rated.rule,
    lastKnownLocation: device.lastLocation?.lat != null ? { lat: device.lastLocation.lat, lng: device.lastLocation.lng, receivedAt: device.lastSeen, ageMin, accuracyM: lastPing?.accuracy ?? null } : null,
    locationIsStale: !fresh,
    zonesAtLastPosition: zones.inside.map((z) => ({ name: z.name, type: z.type, riskLevel: z.riskLevel })),
    zonesNearby: zones.near.map((z) => ({ name: z.name, type: z.type })),
    timeline: [
      { at: check.episodeAt, event: 'Last qualifying signal (GPS or check-in)' },
      check.overdueAt && { at: check.overdueAt, event: `Marked overdue (${mins(cfg.overdueMs)} min)` },
      check.requestedAt && { at: check.requestedAt, event: `Check-in requested (${check.delivery?.touristConnected ? 'app connected' : 'app not connected'})` },
      { at: new Date(now), event: 'Escalated to admin safety alert' },
    ].filter(Boolean),
    reasons,
  };
}

function touristConnected(io, touristId) {
  return Boolean(io?.sockets?.adapter?.rooms?.get(`user:${touristId}`)?.size);
}

async function closeEpisode(check, reason, io) {
  const wasEscalated = check.stage === 'escalated';
  await audit('safety.episode_closed', check, `Silence episode ended (${reason})`, { reason, stage: check.stage });
  if (check.stage === 'overdue') {
    // Never asked anyone anything and nothing was escalated: the audit entry is the record; don't keep a phantom "missed" row.
    await SafetyCheck.deleteOne({ _id: check._id, stage: 'overdue' });
    return;
  }
  check.stage = 'closed'; check.closedAt = new Date(); check.closedReason = reason;
  await check.save();
  if (wasEscalated && check.incident) {
    // The alert stays open for a human to resolve; just record that the tourist is reachable again.
    const text = reason === 'check_in' ? 'Tourist confirmed a check-in after the alert' : 'GPS updates resumed after the alert';
    await Incident.updateOne({ _id: check.incident }, { $push: { timeline: { at: new Date(), actorLabel: 'system', action: text, metadata: { reason } } } });
    io?.to('admin').emit('safetycheck:recovered', { safetyCheck: check, incident: check.incident });
  }
}

/** One tourist, one sweep. `device` is a lean/Document with tourist, lastSeen, lastLocation, battery. */
async function evaluateTourist(device, io, now) {
  const touristId = device.tourist;
  const open = await SafetyCheck.findOne({ tourist: touristId, episodeAt: { $ne: null }, stage: { $in: OPEN_STAGES }, closedAt: null, respondedAt: null });

  // A tourist already in a confirmed emergency is handled by the SOS workflow, not by this one.
  const activeSos = await SOSEvent.exists({ tourist: touristId, status: { $in: ['active', 'acknowledged'] } });
  if (activeSos) { if (open) await closeEpisode(open, 'sos_active', io); return; }

  const lastCheckInAt = await latestCheckInAt(touristId);
  const sig = describeSignal({ lastSeen: device.lastSeen, hasLocation: device.lastLocation?.lat != null, lastCheckInAt }, now);
  if (!sig.lastSignalAt) return;
  const silence = now - sig.lastSignalAt.getTime();

  // A newer qualifying signal than the one that started the episode ends it.
  if (open && sig.lastSignalAt.getTime() > new Date(open.episodeAt).getTime()) { await closeEpisode(open, 'location_resumed', io); return; }

  if (silence < cfg.overdueMs || silence > cfg.maxMonitorMs) return;

  let check = open;
  if (!check) {
    try {
      check = await SafetyCheck.create({
        tourist: touristId, scheduledAt: new Date(now), triggeredBy: 'scheduler',
        stage: 'overdue', episodeAt: sig.lastSignalAt, overdueAt: new Date(now),
      });
    } catch (err) {
      if (err.code === 11000) return; // same episode already recorded (a closed one, or a concurrent sweep)
      throw err;
    }
    await audit('safety.overdue', check, `No location or check-in for ${sig.silenceMin} min`, { lastSignalAt: sig.lastSignalAt, lastGpsAt: sig.lastGpsAt, lastCheckInAt });
    io?.to('admin').emit('safety:overdue', { tourist: touristId, check });
  }

  // 20 min: ask the tourist. Atomic claim so two sweeps cannot both send the request.
  if (check.stage === 'overdue' && silence >= cfg.requestMs) {
    const connected = touristConnected(io, touristId);
    const claimed = await SafetyCheck.findOneAndUpdate(
      { _id: check._id, stage: 'overdue' },
      { $set: {
        stage: 'requested', requestedAt: new Date(now), scheduledAt: new Date(now),
        delivery: {
          inApp: 'stored', touristConnected: connected, sms: 'not_configured',
          note: connected
            ? 'The request was stored in the tourist’s in-app notifications and their app was connected, but no reply has been received.'
            : 'The tourist’s app was not connected, so the request could only be stored; they will see it when they reconnect. No SMS or push was sent.',
        },
      } },
      { new: true });
    if (claimed) {
      check = claimed;
      await onSafetyCheckCreated(check).catch((err) => console.error('[notify] check-in request:', err.message));
      io?.to(`tourist:${touristId}`).emit('safetycheck:prompt', check);
      io?.to('admin').emit('safetycheck:prompt', check);
      await audit('safety.check_requested', check, `Check-in requested after ${sig.silenceMin} min of silence`, { touristConnected: connected });
    } else {
      check = await SafetyCheck.findById(check._id);
    }
  }

  // 25 min: automated safety alert, but only after the request has had (escalate − request) minutes to be seen.
  if (check.stage === 'requested' && silence >= cfg.escalateMs
      && now - new Date(check.requestedAt).getTime() >= cfg.escalateMs - cfg.requestMs) {
    const claimed = await SafetyCheck.findOneAndUpdate(
      { _id: check._id, stage: 'requested', respondedAt: null, closedAt: null },
      { $set: { stage: 'escalated', escalatedAt: new Date(now) } }, { new: true });
    if (!claimed) return;
    try {
      claimed.context = await buildContext(claimed, device, now);
      await escalateOverdueAlert(claimed, claimed.context, io);
      await audit('safety.escalated', claimed, `Automated safety alert (${claimed.context.severity}) raised after ${sig.silenceMin} min of silence`, { severity: claimed.context.severity, rule: claimed.context.severityRule, incident: claimed.incident });
    } catch (err) {
      // Not escalated after all: release the claim so the next sweep retries (the incident sourceKey keeps that idempotent).
      await SafetyCheck.updateOne({ _id: claimed._id, escalated: false }, { $set: { stage: 'requested', escalatedAt: null } });
      throw err;
    }
  }
}

/** The silence-clock part of the scheduler sweep. */
async function sweepSilence(io, now = Date.now()) {
  const devices = await Device.find({
    tourist: { $ne: null }, isDemo: { $ne: true }, status: { $ne: 'lost' },
    lastSeen: { $ne: null }, 'lastLocation.lat': { $ne: null },
  }).select('tourist lastSeen lastLocation battery status').lean();
  for (const device of devices) {
    try { await evaluateTourist(device, io, now); } catch (err) { console.error('[safetyWorkflow]', String(device.tourist), err.message); }
  }
}

module.exports = { sweepSilence, evaluateTourist, describeSignal, latestCheckInAt, rateSeverity, buildContext, closeEpisode };
