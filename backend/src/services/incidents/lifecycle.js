const { Incident, SOSEvent, Device, User } = require('../../models');
const { recordProof } = require('../blockchain/auditChain');
const { notifyUser } = require('../notifications/notify');
const { getIo } = require('../realtime');

/**
 * Incident lifecycle:  New → Acknowledged → Assigned → En Route → Resolved → Closed
 * (stored as open → in_progress → assigned → en_route → resolved → closed).
 * Resolve is also allowed straight from any open state (false alarm, user is fine).
 * Every transition is validated here, recorded in the incident's activity history
 * (`timeline`) and applied with a compare-and-set so two admins can't both win.
 */
const ALLOWED = {
  open: ['in_progress', 'resolved'],
  in_progress: ['assigned', 'resolved'],
  assigned: ['en_route', 'resolved'],
  en_route: ['resolved'],
  resolved: ['closed'],
  closed: [],
};

const LABEL = {
  open: 'New',
  in_progress: 'Acknowledged',
  assigned: 'Assigned',
  en_route: 'En route',
  resolved: 'Resolved',
  closed: 'Closed',
};

const ACTIVE_STATUSES = ['open', 'in_progress', 'assigned', 'en_route'];

class LifecycleError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const TOURIST_MESSAGE = {
  in_progress: ['An admin has acknowledged your emergency', 'Your alert was received and is being handled.', 'info'],
  assigned: ['A responder was assigned', 'Someone has been assigned to help you.', 'info'],
  en_route: ['Help is on the way', 'A responder is heading to your location.', 'warning'],
  resolved: ['Your incident was resolved', 'The incident has been marked resolved.', 'info'],
};

async function validateAssignee(assigneeId) {
  const user = await User.findById(assigneeId).select('role isActive name').lean();
  if (!user || user.isActive === false || !['admin', 'responder'].includes(user.role)) {
    throw new LifecycleError(400, 'Assignee must be an active admin or responder');
  }
  return user;
}

/**
 * Moves an incident to `to`.
 * @param {{ id: string, to: string, actor: {id: string, role: string}, note?: string, assignee?: string }} args
 */
async function transitionIncident({ id, to, actor, note, assignee }) {
  const incident = await Incident.findById(id);
  if (!incident) throw new LifecycleError(404, 'Incident not found');

  const from = incident.status;
  if (!Object.prototype.hasOwnProperty.call(LABEL, to)) throw new LifecycleError(400, `Unknown status: ${to}`);
  if (from === to) return { incident, changed: false }; // idempotent: already there

  if (!ALLOWED[from].includes(to)) {
    throw new LifecycleError(409, `Cannot move an incident from ${LABEL[from]} to ${LABEL[to]}`);
  }

  const now = new Date();
  const set = { status: to };
  let assigneeUser = null;

  if (to === 'assigned') {
    const assigneeId = assignee || actor.id;
    assigneeUser = await validateAssignee(assigneeId);
    set.assignedAdmin = assigneeId;
    set.assignedAt = now;
  }
  if (to === 'resolved') {
    set.resolvedAt = now;
    if (note) set.resolution = note;
  }
  if (to === 'closed') set.closedAt = now;

  const entry = {
    at: now,
    actor: actor.id,
    actorLabel: actor.role,
    action: `${LABEL[from]} → ${LABEL[to]}`,
    metadata: { from, to, ...(note ? { note } : {}), ...(assigneeUser ? { assignee: set.assignedAdmin, assigneeName: assigneeUser.name } : {}) },
  };

  // Compare-and-set on the status we validated against.
  const updated = await Incident.findOneAndUpdate({ _id: id, status: from }, { $set: set, $push: { timeline: entry } }, { new: true });
  if (!updated) throw new LifecycleError(409, 'This incident was just changed by someone else — refresh and try again');

  // ── keep the linked SOS event in step ──
  let sosEvent = null;
  if (updated.sourceRef?.refModel === 'SOSEvent') {
    if (to === 'in_progress') {
      sosEvent = await SOSEvent.findByIdAndUpdate(updated.sourceRef.refId, { status: 'acknowledged', acknowledgedAt: now, acknowledgedBy: actor.id }, { new: true });
    } else if (to === 'resolved') {
      sosEvent = await SOSEvent.findByIdAndUpdate(
        updated.sourceRef.refId,
        { $set: { status: 'resolved', resolvedAt: now, resolvedBy: actor.id, resolutionNote: note || null }, $unset: { activeKey: '' } },
        { new: true }
      );
      // Clear the device's emergency flag now that the SOS is closed.
      if (sosEvent?.device) await Device.findByIdAndUpdate(sosEvent.device, { emergencyMode: false, status: 'active' });
    } else {
      sosEvent = await SOSEvent.findById(updated.sourceRef.refId);
    }
  }

  // ── audit trail for resolution (assignment proofs: see auditChain) ──
  if (to === 'resolved') {
    await recordProof('incident_resolved', 'Incident', updated);
    if (sosEvent) await recordProof('sos_resolved', 'SOSEvent', sosEvent);
  }
  if (to === 'assigned') await recordProof('incident_assigned', 'Incident', updated);

  // ── tell the people involved (persistent notifications) ──
  const tmsg = TOURIST_MESSAGE[to];
  const touristId = String(updated.tourist);
  if (tmsg) {
    await notifyUser(touristId, {
      type: 'incident_update', title: tmsg[0], message: tmsg[1], severity: tmsg[2],
      link: updated.type === 'sos' ? '/tourist/sos' : '/tourist',
      payload: { incident: updated._id, tourist: touristId, status: to },
      dedupeKey: `incident-status:${updated._id}:${to}`,
    });
  }
  if (assigneeUser && String(set.assignedAdmin) !== String(actor.id)) {
    await notifyUser(set.assignedAdmin, {
      type: 'incident_update', title: 'Incident assigned to you', message: 'Open the incident to respond.',
      severity: 'warning', link: `/admin/incidents/${updated._id}`,
      payload: { incident: updated._id, tourist: touristId },
      dedupeKey: `incident-assign:${updated._id}:${set.assignedAdmin}`,
    });
  }

  // ── live updates (the payload carries the tourist's name for the tables) ──
  await updated.populate('tourist', 'name email isDemo');
  await updated.populate('assignedAdmin', 'name role');
  const io = getIo();
  if (io) {
    io.to('admin').emit('incident:updated', updated);
    io.to(`tourist:${touristId}`).emit('incident:updated', updated);
    if (sosEvent) {
      io.to('admin').emit('sos:updated', sosEvent);
      io.to(`tourist:${touristId}`).emit('sos:updated', sosEvent);
    }
  }

  return { incident: updated, sosEvent, changed: true };
}

/** Appends a free-text note to the activity history (does not change the status). */
async function addIncidentNote({ id, actor, note }) {
  const entry = { at: new Date(), actor: actor.id, actorLabel: actor.role, action: 'Note', metadata: { note } };
  const updated = await Incident.findByIdAndUpdate(id, { $push: { timeline: entry } }, { new: true })
    .populate('tourist', 'name email isDemo');
  if (!updated) throw new LifecycleError(404, 'Incident not found');
  getIo()?.to('admin').emit('incident:updated', updated);
  return updated;
}

module.exports = { transitionIncident, addIncidentNote, LifecycleError, ALLOWED, LABEL, ACTIVE_STATUSES };
