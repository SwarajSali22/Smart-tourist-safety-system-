const { Incident, SOSEvent } = require('../../models');
const { haversineKm } = require('../geo/haversine');
const { getIo } = require('../realtime');

/**
 * Event correlation: a new alert (missed check-in, "unsafe" reply, risk escalation) is attached to an
 * incident that is ALREADY being handled for the same tourist instead of opening a duplicate.
 * An alert is related to an incident only when ALL of these hold:
 *   1. same tourist,
 *   2. the incident is still active (open / acknowledged / assigned / en route),
 *   3. the incident was opened within CORRELATION_WINDOW_MS,
 *   4. when both places are known, they are within CORRELATION_RADIUS_KM.
 * The original incident, its timestamps and the new event's own record are never changed; the link is
 * one extra timeline entry. A genuine new SOS never goes through here (see triggerSos.js).
 */
const CORRELATION_WINDOW_MS = 60 * 60 * 1000;
const CORRELATION_RADIUS_KM = 1;
const ACTIVE = ['open', 'in_progress', 'assigned', 'en_route'];
const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

/** Strongest related active incident (SOS first, then highest severity, then newest), or null. */
async function findRelatedIncident(tourist, { location = null, now = Date.now() } = {}) {
  const since = new Date(now - CORRELATION_WINDOW_MS);
  const candidates = await Incident.find({ tourist, status: { $in: ACTIVE }, createdAt: { $gte: since } });
  const sosIds = candidates.filter((i) => i.sourceRef?.refModel === 'SOSEvent').map((i) => i.sourceRef.refId);
  const sosList = sosIds.length ? await SOSEvent.find({ _id: { $in: sosIds } }).select('location').lean() : [];
  const placeOf = new Map(sosList.map((s) => [String(s._id), s.location]));
  const related = candidates.filter((inc) => {
    const at = placeOf.get(String(inc.sourceRef?.refId)); // only SOS events carry a location
    if (!location || location.lat == null || !at || at.lat == null) return true; // place unknown → time + status decide
    return haversineKm(location, at) <= CORRELATION_RADIUS_KM;
  });
  related.sort((a, b) =>
    (b.type === 'sos') - (a.type === 'sos') ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    b.createdAt - a.createdAt);
  return related[0] || null;
}

/** Adds the related event to the incident's timeline (raising severity if the event is worse). */
async function attachEvent(incident, { action, severity, sourceModel, sourceId }) {
  const set = {};
  if (severity && SEVERITY_RANK[severity] > SEVERITY_RANK[incident.severity]) set.severity = severity;
  const entry = {
    at: new Date(), actorLabel: 'system', action: `Related event: ${action}`,
    metadata: { correlated: true, sourceModel, sourceId: sourceId ? String(sourceId) : null },
  };
  const updated = await Incident.findByIdAndUpdate(incident._id, { $set: set, $push: { timeline: entry } }, { new: true })
    .populate('tourist', 'name email isDemo');
  getIo()?.to('admin').emit('incident:updated', updated);
  return updated;
}

module.exports = { findRelatedIncident, attachEvent, CORRELATION_WINDOW_MS, CORRELATION_RADIUS_KM };
