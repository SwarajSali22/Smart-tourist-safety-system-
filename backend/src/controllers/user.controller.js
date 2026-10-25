const { User, Incident } = require('../models');
const { hashPassword } = require('../services/auth.service');
const { ACTIVE_STATUSES } = require('../services/incidents/lifecycle');
const { logActivity } = require('../services/activity/logActivity');

// ── GET /api/users/assignable  (admin) — who an incident can be assigned to ──
async function listAssignable(req, res, next) {
  try {
    // ?all=1 (Team page) also lists deactivated accounts; assignment pickers only want active ones.
    const activeOnly = req.query.all !== '1';
    const users = await User.find({ role: { $in: ['admin', 'responder'] }, ...(activeOnly ? { isActive: { $ne: false } } : {}) })
      .select('name email phone role isDemo isActive createdAt')
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
    await logActivity({ req, action: 'user.create_responder', targetModel: 'User', targetId: user._id, summary: `Created responder ${user.name}` });
    return res.status(201).json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/users/:id  (admin) — edit or deactivate a RESPONDER (admins are never editable here) ──
async function updateResponder(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role !== 'responder') return res.status(403).json({ success: false, message: 'Only responder accounts can be changed here' });
    const { name, phone, isActive } = req.body;
    if (isActive === false && user.isActive !== false) {
      const open = await Incident.countDocuments({ assignedAdmin: user._id, status: { $in: ACTIVE_STATUSES } });
      if (open) return res.status(409).json({ success: false, message: `Reassign their ${open} active incident${open === 1 ? '' : 's'} before deactivating this responder` });
    }
    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone || null;
    if (isActive !== undefined) user.isActive = isActive;
    await user.save();
    await logActivity({ req, action: isActive === undefined ? 'user.update' : isActive ? 'user.reactivate' : 'user.deactivate', targetModel: 'User', targetId: user._id, summary: user.name });
    return res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, isActive: user.isActive } });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAssignable, createResponder, updateResponder };
