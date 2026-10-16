const { Zone } = require('../models');

const ZONE_TYPES = ['safe', 'danger', 'restricted'];

// ── GET /api/zones  (any authenticated user) ──────────────────────────────────
async function listZones(req, res, next) {
  try {
    const zones = await Zone.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, zones });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/zones  (admin only) ──────────────────────────────────────────────
async function createZone(req, res, next) {
  try {
    const { name, description, type, riskLevel, geometry } = req.body;

    if (!name || !type || !geometry) {
      return res.status(400).json({ success: false, message: 'name, type and geometry are required' });
    }
    if (!ZONE_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of ${ZONE_TYPES.join(', ')}` });
    }
    if (geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
      return res.status(400).json({ success: false, message: 'geometry must be a GeoJSON Polygon' });
    }

    const ring = geometry.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 3) {
      return res.status(400).json({ success: false, message: 'polygon must have at least 3 points' });
    }

    // Auto-close the ring if the client sent an open one (click-to-place UI does).
    const [firstLng, firstLat] = ring[0];
    const [lastLng, lastLat] = ring[ring.length - 1];
    const closedRing = firstLng === lastLng && firstLat === lastLat ? ring : [...ring, ring[0]];

    const zone = await Zone.create({
      name,
      description: description || null,
      type,
      riskLevel: typeof riskLevel === 'number' ? riskLevel : 0,
      geometry: { type: 'Polygon', coordinates: [closedRing] },
      createdBy: req.user.id,
    });

    req.app.get('io')?.emit('zone:created', zone);

    return res.status(201).json({ success: true, zone });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/zones/:id  (admin only) ─────────────────────────────────────────
async function updateZone(req, res, next) {
  try {
    const { name, description, type, riskLevel, isActive } = req.body;
    if (type && !ZONE_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of ${ZONE_TYPES.join(', ')}` });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (type !== undefined) updates.type = type;
    if (riskLevel !== undefined) updates.riskLevel = riskLevel;
    if (isActive !== undefined) updates.isActive = isActive;

    const zone = await Zone.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!zone) {
      return res.status(404).json({ success: false, message: 'Zone not found' });
    }

    req.app.get('io')?.emit('zone:updated', zone);

    return res.json({ success: true, zone });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/zones/:id  (admin only) ───────────────────────────────────────
async function deleteZone(req, res, next) {
  try {
    const zone = await Zone.findByIdAndDelete(req.params.id);
    if (!zone) {
      return res.status(404).json({ success: false, message: 'Zone not found' });
    }

    req.app.get('io')?.emit('zone:deleted', { _id: zone._id });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listZones, createZone, updateZone, deleteZone };
