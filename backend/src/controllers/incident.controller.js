const { Incident, SOSEvent, Device } = require('../models');
const { recordProof } = require('../services/blockchain/auditChain');

// ── GET /api/incidents  (admin only) ──────────────────────────────────────────
async function listIncidents(req, res, next) {
  try {
    const incidents = await Incident.find()
      .populate('tourist', 'name email')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ success: true, incidents });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/incidents/:id  (admin, or the owning tourist) ───────────────────
async function getIncident(req, res, next) {
  try {
    const incident = await Incident.findById(req.params.id).populate('tourist', 'name email').lean();
    if (!incident) {
      return res.status(404).json({ success: false, message: 'Incident not found' });
    }

    const isOwner = incident.tourist?._id.toString() === req.user.id;
    if (req.user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    return res.json({ success: true, incident });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/incidents/:id/acknowledge  (admin only) ────────────────────────
async function acknowledgeIncident(req, res, next) {
  try {
    const incident = await Incident.findById(req.params.id);
    if (!incident) {
      return res.status(404).json({ success: false, message: 'Incident not found' });
    }

    incident.status = 'in_progress';
    incident.timeline.push({ actor: req.user.id, actorLabel: 'admin', action: 'Incident acknowledged' });
    await incident.save();

    let sosEvent = null;
    if (incident.sourceRef?.refModel === 'SOSEvent') {
      sosEvent = await SOSEvent.findByIdAndUpdate(
        incident.sourceRef.refId,
        { status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: req.user.id },
        { new: true }
      );
    }

    // Populate for the live payload: clients render the tourist's name from it.
    await incident.populate('tourist', 'name email');
    _emitIncidentUpdate(req, incident, sosEvent);
    return res.json({ success: true, incident, sosEvent });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/incidents/:id/resolve  (admin only) ─────────────────────────────
async function resolveIncident(req, res, next) {
  try {
    const { resolution } = req.body;

    const incident = await Incident.findById(req.params.id);
    if (!incident) {
      return res.status(404).json({ success: false, message: 'Incident not found' });
    }

    incident.status = 'resolved';
    incident.resolution = resolution || null;
    incident.resolvedAt = new Date();
    incident.timeline.push({ actor: req.user.id, actorLabel: 'admin', action: 'Incident resolved' });
    await incident.save();

    let sosEvent = null;
    if (incident.sourceRef?.refModel === 'SOSEvent') {
      sosEvent = await SOSEvent.findByIdAndUpdate(
        incident.sourceRef.refId,
        { status: 'resolved', resolvedAt: new Date(), resolvedBy: req.user.id, resolutionNote: resolution || null },
        { new: true }
      );
      // Clear the device's emergency signal now that the SOS is closed.
      if (sosEvent?.device) {
        await Device.findByIdAndUpdate(sosEvent.device, { emergencyMode: false, status: 'active' });
      }
    }

    await recordProof('incident_resolved', 'Incident', incident);
    if (sosEvent) await recordProof('sos_resolved', 'SOSEvent', sosEvent);

    // Populate for the live payload: clients render the tourist's name from it.
    await incident.populate('tourist', 'name email');
    _emitIncidentUpdate(req, incident, sosEvent);
    return res.json({ success: true, incident, sosEvent });
  } catch (err) {
    next(err);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function _emitIncidentUpdate(req, incident, sosEvent) {
  const io = req.app.get('io');
  if (!io) return;
  io.to('admin').emit('incident:updated', incident);
  io.to(`tourist:${incident.tourist}`).emit('incident:updated', incident);
  if (sosEvent) {
    io.to('admin').emit('sos:updated', sosEvent);
    io.to(`tourist:${incident.tourist}`).emit('sos:updated', sosEvent);
  }
}

module.exports = { listIncidents, getIncident, acknowledgeIncident, resolveIncident };
