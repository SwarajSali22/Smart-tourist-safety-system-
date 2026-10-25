const mongoose = require('mongoose');

const safetyCheckSchema = new mongoose.Schema(
  {
    tourist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    // Null until the tourist responds
    respondedAt: {
      type: Date,
      default: null,
    },
    response: {
      type: String,
      enum: ['safe', 'unsafe', 'no_response'],
      default: 'no_response',
    },
    // If the tourist replied with a message
    message: {
      type: String,
      trim: true,
      default: null,
    },
    // The system that triggered this check
    triggeredBy: {
      type: String,
      enum: ['scheduler', 'admin', 'system'],
      default: 'scheduler',
    },
    // Whether an escalation was raised for this unanswered/unsafe check
    escalated: {
      type: Boolean,
      default: false,
    },
    incident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      default: null,
    },
    // ── Silence-clock workflow (services/safetyCheck/workflow.js). Admin-triggered checks leave these unset. ──
    // overdue (15 min, internal) → requested (20 min, tourist is asked) → escalated (25 min, admin safety alert) | closed
    stage: { type: String, enum: ['overdue', 'requested', 'escalated', 'closed'], default: 'requested' },
    // Time of the last qualifying signal when the silence began; one check per (tourist, episodeAt) = idempotent.
    episodeAt: { type: Date, default: undefined },
    overdueAt: { type: Date, default: null },
    requestedAt: { type: Date, default: null },
    escalatedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedReason: { type: String, enum: ['check_in', 'location_resumed', 'sos_active', null], default: null },
    // What we can honestly say about reaching the tourist (never claims SMS/push that was not sent).
    delivery: {
      type: { inApp: String, touristConnected: Boolean, sms: String, note: String },
      default: undefined, _id: false,
    },
    // Snapshot for the admin at escalation: last known position + age, zones, reasons, severity rule.
    context: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

safetyCheckSchema.pre('save', function remember(next) {
  this.$locals.wasNew = this.isNew;
  next();
});
safetyCheckSchema.post('save', function notifyTourist(doc) {
  if (!doc.$locals.wasNew || doc.stage === 'overdue') return; // an 'overdue' marker is internal until the 20-minute request
  require('../services/notifications/events').onSafetyCheckCreated(doc).catch((err) => console.error('[notify] check-in:', err.message));
});

safetyCheckSchema.index({ tourist: 1, scheduledAt: -1 });
safetyCheckSchema.index({ response: 1, escalated: 1 });
// At most one silence episode per (tourist, last-signal time): repeated sweeps and races cannot duplicate it.
safetyCheckSchema.index({ tourist: 1, episodeAt: 1 }, { unique: true, partialFilterExpression: { episodeAt: { $type: 'date' } } });

module.exports = mongoose.model('SafetyCheck', safetyCheckSchema);
