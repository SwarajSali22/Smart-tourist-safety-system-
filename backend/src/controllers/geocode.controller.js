const { searchPlaces, reverse, isConfigured } = require('../services/geocoding/geocode');

// GET /api/geocode/status  (admin) — lets the UI explain a missing configuration up front
function status(req, res) {
  res.json({ success: true, configured: isConfigured() });
}

// GET /api/geocode/search?q&type  (admin)
async function search(req, res, next) {
  try {
    const results = await searchPlaces(req.query.q, req.query.type);
    res.json({ success: true, results });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    return next(err);
  }
}

// GET /api/geocode/reverse?lat&lng  (admin) — result is null when nothing is known at that point
async function reverseLookup(req, res, next) {
  try {
    const result = await reverse(req.query.lat, req.query.lng);
    res.json({ success: true, result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    return next(err);
  }
}

module.exports = { status, search, reverseLookup };
