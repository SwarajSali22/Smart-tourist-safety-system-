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

module.exports = mongoose.model('Notification', notificationSchema);
