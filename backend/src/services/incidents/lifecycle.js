const { Incident, SOSEvent, Device, User } = require('../../models');
const { recordProof } = require('../blockchain/auditChain');
const { notifyUser } = require('../notifications/notify');
const { getIo } = require('../realtime');
const thresholds = require('../../config/thresholds');
const { logActivity } = require('../activity/logActivity');

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

/** True when an active incident has sat in its current state longer than the target in config/thresholds.js. */
function isOverdue(incident, now = Date.now()) {
  const limit = thresholds.incidentOverdueMs[incident.status];
  if (!limit) return false;
  const last = incident.lastActivity?.at || incident.timeline?.[incident.timeline.length - 1]?.at || incident.updatedAt || incident.createdAt;
  return now - new Date(last).getTime() > limit;
}

/**
 * One place that pushes an updated incident to everyone allowed to see it: all admins, plus the
 * assigned admin/responder in their personal room (responders are not in the 'admin' room), so notes,
 * evidence and priority changes appear live on both sides instead of only after a refresh.
 */
function broadcastIncident(incident) {
  const io = getIo();
  if (!io || !incident) return;
  io.to('admin').emit('incident:updated', incident);
  const assignee = incident.assignedAdmin?._id || incident.assignedAdmin;
  if (assignee) io.to(`user:${assignee}`).emit('incident:updated', incident);
}

async function validateAssignee(assigneeId) {
  const user = await User.findById(assigneeId).select('role isActive name').lean();
  if (!user || user.isActive === false || !['admin', 'responder'].includes(user.role)) {
    throw new LifecycleError(400, 'Assignee must be an active admin or responder');
  }
  return user;
}

/**
 * Moves an incident to `to`.
 * @param {{ id: string, to: string, actor: {id: string, role: string}, note?: string, assignee?: string, expectedStatus?: string }} args
 */
async function transitionIncident({ id, to, actor, note, assignee, expectedStatus }) {
  const incident = await Incident.findById(id);
  if (!incident) throw new LifecycleError(404, 'Incident not found');

  const from = incident.status;
  // Stale-screen guard: a client may say which status it was looking at; if someone else already moved it, refuse.
  if (expectedStatus && expectedStatus !== from) {
    throw new LifecycleError(409, `This incident is now ${LABEL[from]} (it was changed by someone else) — refresh and try again`);
  }
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
    if (!incident.firstAssignedAdmin) { set.firstAssignedAdmin = assigneeId; set.firstAssignedAt = now; }
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

  await logActivity({
    actor: actor.id, role: actor.role, action: `incident.${to}`, targetModel: 'Incident', targetId: id,
    summary: `${LABEL[from]} → ${LABEL[to]}`, metadata: { from, to, ...(assigneeUser ? { assignee: set.assignedAdmin } : {}) },
  });

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
      if (sosEvent?.device) {
        const dev = await Device.findById(sosEvent.device).select('lastSeen').lean();
        const live = dev?.lastSeen && now.getTime() - new Date(dev.lastSeen).getTime() <= thresholds.device.staleMs;
        await Device.findByIdAndUpdate(sosEvent.device, { emergencyMode: false, status: live ? 'active' : 'inactive' });
      }
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
      severity: 'warning', link: `${assigneeUser.role === 'responder' ? '/responder' : '/admin'}/incidents/${updated._id}`,
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
    if (updated.assignedAdmin?._id) io.to(`user:${updated.assignedAdmin._id}`).emit('incident:updated', updated); // the assignee (admin or responder)
    if (sosEvent) {
      io.to('admin').emit('sos:updated', sosEvent);
      io.to(`tourist:${touristId}`).emit('sos:updated', sosEvent);
    }
  }

  return { incident: updated, sosEvent, changed: true };
}

const REASSIGNABLE = ['assigned', 'en_route'];

/**
 * Moves an already-assigned incident to a different responder/admin without changing its status.
 * Recorded in the timeline and the activity log; the original assignment proof stays verifiable.
 */
async function reassignIncident({ id, actor, assignee, note }) {
  const incident = await Incident.findById(id);
  if (!incident) throw new LifecycleError(404, 'Incident not found');
  if (!REASSIGNABLE.includes(incident.status)) throw new LifecycleError(409, 'Only an incident that is already assigned can be reassigned');
  if (String(incident.assignedAdmin) === String(assignee)) throw new LifecycleError(409, 'That person is already assigned');
  const to = await validateAssignee(assignee);
  const now = new Date();
  const set = { assignedAdmin: assignee, assignedAt: now };
  if (!incident.firstAssignedAdmin) { set.firstAssignedAdmin = incident.assignedAdmin; set.firstAssignedAt = incident.assignedAt || now; }
  const entry = {
    at: now, actor: actor.id, actorLabel: actor.role, action: `Reassigned to ${to.name}`,
    metadata: { from: String(incident.assignedAdmin), assignee, assigneeName: to.name, ...(note ? { note } : {}) },
  };
  const updated = await Incident.findOneAndUpdate(
    { _id: id, status: incident.status, assignedAdmin: incident.assignedAdmin }, { $set: set, $push: { timeline: entry } }, { new: true }
  );
  if (!updated) throw new LifecycleError(409, 'This incident was just changed by someone else — refresh and try again');
  await logActivity({ actor: actor.id, role: actor.role, action: 'incident.reassign', targetModel: 'Incident', targetId: id, summary: `Reassigned to ${to.name}`, metadata: { assignee } });
  await notifyUser(assignee, {
    type: 'incident_update', title: 'Incident assigned to you', message: 'Open the incident to respond.', severity: 'warning',
    link: `${to.role === 'responder' ? '/responder' : '/admin'}/incidents/${updated._id}`, payload: { incident: updated._id, tourist: String(updated.tourist) },
    dedupeKey: `incident-assign:${updated._id}:${assignee}:${now.getTime()}`,
  });
  await updated.populate('tourist', 'name email isDemo');
  await updated.populate('assignedAdmin', 'name role');
  const io = getIo();
  if (io) {
    io.to('admin').emit('incident:updated', updated);
    io.to(`user:${assignee}`).emit('incident:updated', updated);
    if (incident.assignedAdmin) io.to(`user:${incident.assignedAdmin}`).emit('incident:updated', updated);
  }
  return updated;
}

/** Adds evidence as a described reference (link or text) to the incident and its timeline. */
async function addEvidence({ id, actor, kind, title, value }) {
  const at = new Date();
  const updated = await Incident.findByIdAndUpdate(id, {
    $push: {
      evidence: { kind, title, value, addedBy: actor.id, at },
      timeline: { at, actor: actor.id, actorLabel: actor.role, action: 'Evidence added', metadata: { kind, title } },
    },
  }, { new: true }).populate('tourist', 'name email isDemo');
  if (!updated) throw new LifecycleError(404, 'Incident not found');
  await logActivity({ actor: actor.id, role: actor.role, action: 'incident.evidence', targetModel: 'Incident', targetId: id, summary: `Evidence added: ${title}` });
  broadcastIncident(updated);
  return updated;
}

/** Changes the priority (how urgently to act), recorded in the timeline. */
async function setPriority({ id, actor, priority }) {
  const incident = await Incident.findById(id).select('priority status').lean();
  if (!incident) throw new LifecycleError(404, 'Incident not found');
  if (incident.priority === priority) return Incident.findById(id).populate('tourist', 'name email isDemo');
  const updated = await Incident.findByIdAndUpdate(id, {
    $set: { priority },
    $push: { timeline: { at: new Date(), actor: actor.id, actorLabel: actor.role, action: `Priority ${incident.priority} → ${priority}`, metadata: { from: incident.priority, to: priority } } },
  }, { new: true }).populate('tourist', 'name email isDemo');
  await logActivity({ actor: actor.id, role: actor.role, action: 'incident.priority', targetModel: 'Incident', targetId: id, summary: `Priority → ${priority}` });
  broadcastIncident(updated);
  return updated;
}

/**
 * Escalates one active, high-priority incident that nobody has acknowledged (or that has stayed
 * unresolved far too long). Done at most once per incident; the original timestamps are untouched.
 */
async function escalateIncident(incident, reason) {
  const now = new Date();
  const updated = await Incident.findOneAndUpdate(
    { _id: incident._id, escalatedAt: null, status: { $in: ACTIVE_STATUSES } },
    {
      $set: { escalatedAt: now, escalationReason: reason, priority: 'urgent' },
      $push: { timeline: { at: now, actor: null, actorLabel: 'system', action: 'Escalated', metadata: { reason } } },
    },
    { new: true }
  );
  if (!updated) return null;
  await recordProof('incident_escalated', 'Incident', updated);
  await logActivity({ actor: null, role: 'system', action: 'incident.escalate', targetModel: 'Incident', targetId: updated._id, summary: reason });
  const { notifyAdmins } = require('../notifications/notify');
  await notifyAdmins({
    type: 'incident_update', title: 'Incident escalated', message: reason, severity: 'critical',
    link: `/admin/incidents/${updated._id}`, payload: { incident: updated._id, tourist: String(updated.tourist) },
    dedupeKey: `incident-escalated:${updated._id}`,
  });
  await updated.populate('tourist', 'name email isDemo');
  await updated.populate('assignedAdmin', 'name role');
  const io = getIo();
  if (io) {
    io.to('admin').emit('incident:updated', updated);
    if (updated.assignedAdmin?._id) io.to(`user:${updated.assignedAdmin._id}`).emit('incident:updated', updated);
  }
  return updated;
}

/** Appends a free-text note to the activity history (does not change the status). */
async function addIncidentNote({ id, actor, note }) {
  const entry = { at: new Date(), actor: actor.id, actorLabel: actor.role, action: 'Note', metadata: { note } };
  const updated = await Incident.findByIdAndUpdate(id, { $push: { timeline: entry } }, { new: true })
    .populate('tourist', 'name email isDemo');
  if (!updated) throw new LifecycleError(404, 'Incident not found');
  broadcastIncident(updated);
  return updated;
}

module.exports = { broadcastIncident, transitionIncident, addIncidentNote, reassignIncident, addEvidence, setPriority, escalateIncident, isOverdue, LifecycleError, ALLOWED, LABEL, ACTIVE_STATUSES };
