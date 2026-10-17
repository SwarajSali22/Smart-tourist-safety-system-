const { User, Incident } = require('../models');
const { hashPassword } = require('../services/auth.service');
const { ACTIVE_STATUSES } = require('../services/incidents/lifecycle');

// ── GET /api/users/assignable  (admin) — who an incident can be assigned to ──
async function listAssignable(req, res, next) {
  try {
    const users = await User.find({ role: { $in: ['admin', 'responder'] }, isActive: { $ne: false } })
      .select('name email role isDemo')
      .sort({ role: 1, name: 1 })
      .lean();
    const load = await Incident.aggregate([
      { $match: { assignedAdmin: { $in: users.map((u) => u._id) }, status: { $in: ACTIVE_STATUSES } } },
      { $group: { _id: '$assignedAdmin', active: { $sum: 1 } } },
    ]);
    const byUser = new Map(load.map((l) => [String(l._id), l.active]));
    return res.json({ success: true, users: users.map((u) => ({ ...u, activeIncidents: byUser.get(String(u._id)) || 0 })) });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/users/responders  (admin) — create a responder account ─────────
async function createResponder(req, res, next) {
  try {
    const { name, email, password, phone } = req.body;
    if (await User.findOne({ email })) return res.status(409).json({ success: false, message: 'Email already registered' });
    const user = await User.create({ name, email, phone: phone || null, passwordHash: await hashPassword(password), role: 'responder' });
    return res.status(201).json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAssignable, createResponder };
