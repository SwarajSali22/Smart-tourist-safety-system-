const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Delivery channel
    channel: {
      type: String,
      enum: ['socket', 'sms', 'email', 'push'],
      required: true,
    },
    type: {
      type: String,
      enum: [
        'sos_alert',
        'geofence_violation',
        'safety_check_prompt',
        'safety_check_missed',
        'risk_escalation',
        'incident_update',
        'general',
      ],
      required: true,
    },
    // Flexible payload so every notification type can carry its own shape
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // In-app notification content (the `payload` above carries machine-readable context)
    title: { type: String, default: null },
    message: { type: String, default: null },
    link: { type: String, default: null },        // deep link inside the app, e.g. /admin/incidents/<id>
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    isDemo: { type: Boolean, default: false },    // came from a simulated tourist
    // Idempotency: one notification per (source event, recipient)
    dedupeKey: { type: String, default: undefined },
    acknowledged: {
      type: Boolean,
      default: false,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
    // Whether the delivery itself succeeded
    delivered: {
      type: Boolean,
      default: false,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ acknowledged: 1 });
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Notification', notificationSchema);
