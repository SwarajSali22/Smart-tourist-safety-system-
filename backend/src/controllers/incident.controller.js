const mongoose = require('mongoose');
const { Incident, SOSEvent, Device, User, Notification } = require('../models');
const { transitionIncident, addIncidentNote, reassignIncident, addEvidence, setPriority, isOverdue, ALLOWED, ACTIVE_STATUSES } = require('../services/incidents/lifecycle');
const { isConfigured: smsConfigured } = require('../services/notifications/sms');

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const actorOf = (req) => ({ id: req.user.id, role: req.user.role });

// Responders may only act on incidents ASSIGNED TO THEM, and only move them forward in the field:
// en route → resolved. (Assigning, acknowledging and closing stay with admins.)
const RESPONDER_MOVES = ['en_route', 'resolved'];
async function guardResponder(req, res, id, to) {
  if (req.user.role !== 'responder') return true;
  const inc = await Incident.findById(id).select('assignedAdmin').lean();
  if (!inc) { res.status(404).json({ success: false, message: 'Incident not found' }); return false; }
  if (String(inc.assignedAdmin) !== req.user.id) { res.status(403).json({ success: false, message: 'This incident is not assigned to you' }); return false; }
  if (to && !RESPONDER_MOVES.includes(to)) { res.status(403).json({ success: false, message: 'Responders can only mark an incident En route or Resolved' }); return false; }
  return true;
}

/** Builds the Mongo filter from the (zod-validated) query — shared by the list and the CSV export. */
async function buildMatch(req) {
  const { status, severity, priority, escalated, type, active, tourist, assignee, q, from, to } = req.query;
  const match = {};
  if (status.length) match.status = { $in: status };
  else if (active) match.status = { $in: ACTIVE_STATUSES };
  if (severity.length) match.severity = { $in: severity };
  if (priority.length) match.priority = { $in: priority };
  if (escalated) match.escalatedAt = { $ne: null };
  if (type.length) match.type = { $in: type };
  if (tourist) match.tourist = new mongoose.Types.ObjectId(tourist);
  // a responder only ever sees their own assignments
  const assigneeId = req.user.role === 'responder' ? req.user.id : assignee;
  if (assigneeId) match.assignedAdmin = new mongoose.Types.ObjectId(assigneeId);
  if (from || to) {
    match.createdAt = {};
    if (from && !Number.isNaN(Date.parse(from))) match.createdAt.$gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) match.createdAt.$lte = new Date(to);
    if (!Object.keys(match.createdAt).length) delete match.createdAt;
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ role: 'tourist', $or: [{ name: rx }, { email: rx }] }).select('_id').limit(200).lean();
    const ors = [{ tourist: { $in: users.map((u) => u._id) } }, { type: rx }];
    if (/^[0-9a-fA-F]{24}$/.test(q)) ors.push({ _id: new mongoose.Types.ObjectId(q) });
    match.$or = ors;
  }
  return match;
}

const sortStageFor = (sort, order) => {
  const dir = order === 'asc' ? 1 : -1;
  if (sort === 'severity') return { severityRank: dir, createdAt: -1, _id: -1 };
  if (sort === 'status') return { statusRank: dir, createdAt: -1, _id: -1 };
  if (sort === 'type') return { type: dir, createdAt: -1, _id: -1 };
  return { createdAt: dir, _id: dir };
};

const rankFields = {
  severityRank: { $indexOfArray: [SEVERITY_ORDER, '$severity'] },
  statusRank: { $indexOfArray: [Incident.STATUSES, '$status'] },
  lastActivity: { $arrayElemAt: ['$timeline', -1] },
  activityCount: { $size: { $ifNull: ['$timeline', []] } },
};

// ── GET /api/incidents  (admin, responder) — server-side search / filter / sort / pagination ──
//   ?status=open,in_progress  ?active=1  ?severity=critical  ?type=sos  ?tourist=<id>  ?assignee=<id>
//   ?q=<text>  ?from=<date> ?to=<date>  ?sort=createdAt|severity|status|type  ?order=asc|desc
//   ?page=1 ?limit=20
async function listIncidents(req, res, next) {
  try {
    const { sort, order, page, limit } = req.query;
    const match = await buildMatch(req);

    const [total, rows] = await Promise.all([
      Incident.countDocuments(match),
      Incident.aggregate([
        { $match: match },
        { $addFields: rankFields },
        { $sort: sortStageFor(sort, order) },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { timeline: 0, severityRank: 0, statusRank: 0 } },
      ]),
    ]);
    await Incident.populate(rows, [
      { path: 'tourist', select: 'name email isDemo' },
      { path: 'assignedAdmin', select: 'name role' },
    ]);

    const nowMs = Date.now();
    rows.forEach((r) => { r.overdue = isOverdue(r, nowMs); });
    return res.json({ success: true, incidents: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
}

// CSV cells that start with = + - @ can be executed as formulas by spreadsheet apps: neutralise them.
const csvCell = (v) => {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

// ── GET /api/incidents/export.csv  (admin) — every row matching the same filters (max 5000) ──
async function exportIncidents(req, res, next) {
  try {
    const { sort, order } = req.query;
    const match = await buildMatch(req);
    const rows = await Incident.aggregate([
      { $match: match },
      { $addFields: rankFields },
      { $sort: sortStageFor(sort, order) },
      { $limit: 5000 },
      { $project: { timeline: 0, severityRank: 0, statusRank: 0 } },
    ]);
    await Incident.populate(rows, [{ path: 'tourist', select: 'name email isDemo' }, { path: 'assignedAdmin', select: 'name' }]);
    const head = ['id', 'tourist', 'tourist_email', 'simulated', 'type', 'severity', 'status', 'assigned_to', 'created_at', 'resolved_at', 'closed_at', 'overdue', 'resolution'];
    const lines = [head.join(',')];
    const nowMs = Date.now();
    rows.forEach((r) => lines.push([
      r._id, r.tourist?.name, r.tourist?.email, r.tourist?.isDemo ? 'yes' : 'no', r.type, r.severity, r.status,
      r.assignedAdmin?.name, r.createdAt?.toISOString?.(), r.resolvedAt?.toISOString?.() || '', r.closedAt?.toISOString?.() || '',
      isOverdue(r, nowMs) ? 'yes' : 'no', r.resolution,
    ].map(csvCell).join(',')));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="incidents.csv"');
    return res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
  } catch (err) {
    next(err);
  }
}

/** Response / resolution times, always measured from the incident's original creation time. */
function timingOf(incident, sosEvent) {
  const created = new Date(incident.createdAt).getTime();
  const ackEntry = (incident.timeline || []).find((t) => t.metadata?.to === 'in_progress');
  const ackAt = ackEntry?.at || sosEvent?.acknowledgedAt || null;
  const doneAt = incident.resolvedAt || null;
  const mins = (t) => (t ? Math.round(((new Date(t).getTime() - created) / 60000) * 10) / 10 : null);
  return { acknowledgedAt: ackAt, responseMinutes: mins(ackAt), resolvedAt: doneAt, resolutionMinutes: mins(doneAt) };
}

// ── GET /api/incidents/:id  (admin, or the owning tourist) ───────────────────
async function getIncident(req, res, next) {
  try {
    const incident = await Incident.findById(req.params.id)
      .populate('tourist', 'name email phone isDemo')
      .populate('assignedAdmin', 'name role')
      .lean();
    if (!incident) {
      return res.status(404).json({ success: false, message: 'Incident not found' });
    }
    const isOwner = incident.tourist?._id.toString() === req.user.id;
    if (req.user.role === 'tourist' && !isOwner) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (req.user.role === 'responder' && String(incident.assignedAdmin?._id) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'This incident is not assigned to you' });
    }

    // Tourists get the incident without internal admin metadata.
    if (req.user.role === 'tourist') {
      return res.json({
        success: true,
        incident: { _id: incident._id, type: incident.type, severity: incident.severity, status: incident.status, createdAt: incident.createdAt, resolvedAt: incident.resolvedAt },
      });
    }

    let sosEvent = null;
    let sms = null;
    if (incident.sourceRef?.refModel === 'SOSEvent') {
      sosEvent = await SOSEvent.findById(incident.sourceRef.refId).lean();
      // Honest SMS status: only what actually happened (Notification rows written per send attempt).
      const rows = await Notification.find({ channel: 'sms', 'payload.sosEvent': incident.sourceRef.refId }).select('delivered error payload.contact createdAt').lean();
      sms = {
        configured: smsConfigured(),
        simulated: Boolean(incident.tourist?.isDemo), // demo data never sends real SMS
        sent: rows.filter((r) => r.delivered).length,
        failed: rows.filter((r) => !r.delivered).length,
        attempts: rows.map((r) => ({ contact: r.payload?.contact, delivered: r.delivered, error: r.error || null, at: r.createdAt })),
      };
    }
    const device = await Device.findOne({ tourist: incident.tourist._id }).select('deviceId type isSimulated status lastSeen lastLocation battery emergencyMode').lean();

    return res.json({
      success: true,
      incident,
      metrics: timingOf(incident, sosEvent),
      sosEvent,
      sms,
      device,
      allowedNext: (ALLOWED[incident.status] || []).filter((s) => req.user.role !== 'responder' || RESPONDER_MOVES.includes(s)),
      overdue: isOverdue(incident),
    });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/incidents/:id/status  (admin) — the one validated transition endpoint ──
async function setStatus(req, res, next) {
  try {
    const { status, note, assignee, expectedStatus } = req.body;
    if (!(await guardResponder(req, res, req.params.id, status))) return undefined;
    const { incident, sosEvent, changed } = await transitionIncident({ id: req.params.id, to: status, actor: actorOf(req), note, assignee, expectedStatus });
    return res.json({ success: true, incident, sosEvent: sosEvent || null, changed });
  } catch (err) {
    next(err);
  }
}

// ── legacy endpoints, now thin wrappers over the lifecycle ───────────────────
// PATCH /api/incidents/:id/acknowledge  ==  status → in_progress
async function acknowledgeIncident(req, res, next) {
  try {
    const { incident, sosEvent } = await transitionIncident({ id: req.params.id, to: 'in_progress', actor: actorOf(req) });
    return res.json({ success: true, incident, sosEvent: sosEvent || null });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/incidents/:id/resolve  ==  status → resolved (+ optional resolution note)
async function resolveIncident(req, res, next) {
  try {
    const { incident, sosEvent } = await transitionIncident({ id: req.params.id, to: 'resolved', actor: actorOf(req), note: req.body.resolution });
    return res.json({ success: true, incident, sosEvent: sosEvent || null });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/incidents/:id/notes  (admin) ───────────────────────────────────
async function addNote(req, res, next) {
  try {
    if (!(await guardResponder(req, res, req.params.id))) return undefined;
    const incident = await addIncidentNote({ id: req.params.id, actor: actorOf(req), note: req.body.note });
    return res.status(201).json({ success: true, incident });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/incidents/:id/assign  (admin) — assign or reassign to an active admin/responder ──
async function assignIncident(req, res, next) {
  try {
    const inc = await Incident.findById(req.params.id).select('status').lean();
    if (!inc) return res.status(404).json({ success: false, message: 'Incident not found' });
    if (['assigned', 'en_route'].includes(inc.status)) {
      const incident = await reassignIncident({ id: req.params.id, actor: actorOf(req), assignee: req.body.assignee, note: req.body.note });
      return res.json({ success: true, incident, reassigned: true });
    }
    const { incident } = await transitionIncident({ id: req.params.id, to: 'assigned', actor: actorOf(req), assignee: req.body.assignee, note: req.body.note });
    return res.json({ success: true, incident, reassigned: false });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/incidents/:id/priority  (admin) ───────────────────────────────
async function changePriority(req, res, next) {
  try {
    const incident = await setPriority({ id: req.params.id, actor: actorOf(req), priority: req.body.priority });
    return res.json({ success: true, incident });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/incidents/:id/evidence  (admin, assigned responder) ────────────
async function addIncidentEvidence(req, res, next) {
  try {
    if (!(await guardResponder(req, res, req.params.id))) return undefined;
    const incident = await addEvidence({ id: req.params.id, actor: actorOf(req), ...req.body });
    return res.status(201).json({ success: true, incident });
  } catch (err) {
    next(err);
  }
}

/**
 * ── GET /api/incidents/:id/handover  (admin, or the responder assigned to it) ──
 * A read-only summary built ONLY from what is already recorded (timeline, device, SOS) so whoever
 * takes over sees: where the case stands, who has held it and when, what was done, the latest notes
 * and the last known location. Nothing here is written or invented.
 */
async function getHandover(req, res, next) {
  try {
    const incident = await Incident.findById(req.params.id)
      .populate('tourist', 'name phone isDemo').populate('assignedAdmin', 'name role').lean();
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    if (req.user.role === 'responder' && String(incident.assignedAdmin?._id) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'This incident is not assigned to you' });
    }
    const timeline = incident.timeline || [];
    const meta = (t) => t.metadata || {};
    // Chronological record of who held the case: every assignment / reassignment entry, in order.
    const assignments = timeline
      .filter((t) => meta(t).to === 'assigned' || /^Reassigned to /.test(t.action))
      .map((t) => ({ at: t.at, by: t.actorLabel, assignee: meta(t).assigneeName || null, note: meta(t).note || null }));
    const notes = timeline.filter((t) => t.action === 'Note').slice(-5).map((t) => ({ at: t.at, by: t.actorLabel, note: meta(t).note }));
    const actions = timeline.filter((t) => t.action !== 'Note').slice(-8).map((t) => ({ at: t.at, by: t.actorLabel, action: t.action }));
    const device = await Device.findOne({ tourist: incident.tourist?._id }).select('lastLocation lastSeen battery isSimulated').lean();
    const sos = incident.sourceRef?.refModel === 'SOSEvent' ? await SOSEvent.findById(incident.sourceRef.refId).select('location source createdAt').lean() : null;
    return res.json({
      success: true,
      handover: {
        incident: { _id: incident._id, type: incident.type, severity: incident.severity, priority: incident.priority, status: incident.status, createdAt: incident.createdAt, escalatedAt: incident.escalatedAt },
        tourist: { name: incident.tourist?.name, phone: incident.tourist?.phone || null, simulated: Boolean(incident.tourist?.isDemo) },
        currentAssignee: incident.assignedAdmin ? { name: incident.assignedAdmin.name, role: incident.assignedAdmin.role, since: incident.assignedAt } : null,
        assignments,
        recentActions: actions,
        recentNotes: notes,
        evidenceCount: (incident.evidence || []).length,
        lastKnownLocation: device?.lastLocation?.lat != null ? { ...device.lastLocation, lastSeen: device.lastSeen, simulated: Boolean(device.isSimulated) } : (sos?.location ? { ...sos.location, lastSeen: sos.createdAt } : null),
        allowedNext: (ALLOWED[incident.status] || []).filter((st) => req.user.role !== 'responder' || RESPONDER_MOVES.includes(st)),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHandover, assignIncident, changePriority, addIncidentEvidence, timingOf, buildMatch, listIncidents, exportIncidents, getIncident, setStatus, acknowledgeIncident, resolveIncident, addNote };
