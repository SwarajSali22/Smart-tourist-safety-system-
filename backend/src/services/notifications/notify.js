const { Notification, User } = require('../../models');
const { emitToUser } = require('../realtime');

/**
 * Persistent in-app notifications. One row per (recipient, source event):
 * `dedupeKey` + a unique sparse index make creation idempotent — replaying the
 * same event never produces a second notification.
 *
 * The row is stored first, then pushed live as `notification:new` to the
 * recipient's personal room (`user:<id>`), so a user who was offline still
 * finds it in their list afterwards.
 */
async function createNotification({ recipient, type, title, message, link = null, severity = 'info', payload = {}, dedupeKey, isDemo = false }) {
  try {
    const doc = await Notification.create({
      recipient, channel: 'socket', type, title, message, link, severity, payload, isDemo,
      dedupeKey: dedupeKey || undefined,
      delivered: true, deliveredAt: new Date(),
    });
    emitToUser(String(recipient), 'notification:new', doc.toObject());
    return doc;
  } catch (err) {
    if (err.code === 11000) return null; // already notified for this event
    console.error('[notify] failed:', err.message);
    return null;
  }
}

/** Every active admin gets their own notification (own read state). */
async function notifyAdmins(spec) {
  const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean();
  return Promise.all(admins.map((a) => createNotification({
    ...spec, recipient: a._id, dedupeKey: spec.dedupeKey ? `${spec.dedupeKey}:${a._id}` : undefined,
  })));
}

/** Notify one specific user (e.g. the assignee or the tourist). */
const notifyUser = (recipient, spec) => createNotification({
  ...spec, recipient, dedupeKey: spec.dedupeKey ? `${spec.dedupeKey}:${recipient}` : undefined,
});

module.exports = { createNotification, notifyAdmins, notifyUser };
