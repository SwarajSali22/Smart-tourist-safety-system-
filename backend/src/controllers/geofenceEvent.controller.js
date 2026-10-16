const { GeofenceEvent } = require('../models');

// ── GET /api/geofence-events  (admin only) ────────────────────────────────────
async function listGeofenceEvents(req, res, next) {
  try {
    const filter = {};
    if (req.query.resolved === 'true') filter.resolved = true;
    if (req.query.resolved === 'false') filter.resolved = false;

    const events = await GeofenceEvent.find(filter)
      .populate('tourist', 'name email')
      .populate('zone', 'name type')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/geofence-events/:id/resolve  (admin only) ─────────────────────
async function resolveGeofenceEvent(req, res, next) {
  try {
    const event = await GeofenceEvent.findByIdAndUpdate(
      req.params.id,
      { resolved: true, resolvedAt: new Date(), resolvedBy: req.user.id },
      { new: true }
    );
    if (!event) {
      return res.status(404).json({ success: false, message: 'Geofence event not found' });
    }
    return res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

module.exports = { listGeofenceEvents, resolveGeofenceEvent };
