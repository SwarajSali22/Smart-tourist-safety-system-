const { HelpCenter } = require('../models');
const { haversineKm } = require('../services/geo/haversine');

const publicView = (h, distanceKm) => ({
  _id: h._id,
  name: h.name,
  type: h.type,
  phone: h.phone || null,
  address: h.address || null,
  location: h.location,
  ...(distanceKm !== undefined ? { distanceKm: Math.round(distanceKm * 100) / 100 } : {}),
});

// ── GET /api/help-centers  (any signed-in user; admins also see inactive ones) ──
async function listHelpCenters(req, res, next) {
  try {
    const filter = req.user.role === 'admin' ? {} : { isActive: true };
    const items = await HelpCenter.find(filter).sort({ type: 1, name: 1 }).limit(500).lean();
    return res.json({ success: true, helpCenters: items.map((h) => ({ ...publicView(h), isActive: h.isActive })) });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/help-centers/nearby?lat&lng&limit&maxKm&type  (any signed-in user) ──
// Nearest first by great-circle (haversine) distance. Empty when none have been added.
async function nearby(req, res, next) {
  try {
    const { lat, lng, limit, maxKm, type } = req.query;
    const items = await HelpCenter.find({ isActive: true, ...(type ? { type } : {}) }).limit(1000).lean();
    const ranked = items
      .map((h) => ({ h, d: haversineKm({ lat, lng }, h.location) }))
      .filter((x) => x.d <= maxKm)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((x) => publicView(x.h, x.d));
    return res.json({ success: true, helpCenters: ranked, total: items.length });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/help-centers  (admin) ──────────────────────────────────────────
async function createHelpCenter(req, res, next) {
  try {
    const b = req.body;
    const doc = await HelpCenter.create({ ...b, phone: b.phone || null, createdBy: req.user.id });
    return res.status(201).json({ success: true, helpCenter: { ...publicView(doc), isActive: doc.isActive } });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/help-centers/:id  (admin) ─────────────────────────────────────
async function updateHelpCenter(req, res, next) {
  try {
    const doc = await HelpCenter.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Help center not found' });
    return res.json({ success: true, helpCenter: { ...publicView(doc), isActive: doc.isActive } });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/help-centers/:id  (admin) ────────────────────────────────────
async function deleteHelpCenter(req, res, next) {
  try {
    const doc = await HelpCenter.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Help center not found' });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { listHelpCenters, nearby, createHelpCenter, updateHelpCenter, deleteHelpCenter };
