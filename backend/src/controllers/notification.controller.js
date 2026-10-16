const { Notification } = require('../models');

// All handlers act on the CALLER's own notifications only (recipient = req.user.id).

// ── GET /api/notifications?unread=1&limit=&page= ─────────────────────────────
async function listNotifications(req, res, next) {
  try {
    const { unread, limit, page } = req.query;
    const filter = { recipient: req.user.id, channel: 'socket' };
    if (unread) filter.read = false;
    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: req.user.id, channel: 'socket', read: false }),
    ]);
    return res.json({ success: true, notifications: items, total, unreadCount, page, limit });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/notifications/:id/read ────────────────────────────────────────
async function markRead(req, res, next) {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { read: true, readAt: new Date() },
      { new: true }
    );
    if (!n) return res.status(404).json({ success: false, message: 'Notification not found' });
    return res.json({ success: true, notification: n });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/notifications/read-all ─────────────────────────────────────────
async function markAllRead(req, res, next) {
  try {
    const r = await Notification.updateMany({ recipient: req.user.id, channel: 'socket', read: false }, { read: true, readAt: new Date() });
    return res.json({ success: true, updated: r.modifiedCount });
  } catch (err) {
    next(err);
  }
}

module.exports = { listNotifications, markRead, markAllRead };
