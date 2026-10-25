const mongoose = require('mongoose');

const timelineEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true, default: Date.now },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorLabel: { type: String, default: 'system' }, // "system", "admin", tourist name, etc.
    action: { type: String, required: true },         // free-text description
    metadata: { type: mongoose.Schema.Types.Mixed, default: null }, // e.g. { from, to, note, assignee }
  },
  { _id: false }
);

/**
 * Lifecycle (validated server-side in services/incidents/lifecycle.js):
 *   New → Acknowledged → Assigned → En Route → Resolved → Closed
 * Stored values keep the original names for the first two so existing data and
 * clients keep working: open = New, in_progress = Acknowledged.
 */
const STATUSES = ['open', 'in_progress', 'assigned', 'en_route', 'resolved', 'closed'];

const incidentSchema = new mongoose.Schema(
  {
    tourist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['sos', 'geofence_violation', 'no_response', 'risk_escalation', 'other'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      required: true,
    },
    status: {
      type: String,
      enum: STATUSES,
      default: 'open',
    },
    // The source record that created this incident
    sourceRef: {
      refModel: {
        type: String,
        enum: ['SOSEvent', 'GeofenceEvent', 'SafetyCheck', 'RiskAssessment'],
        default: null,
      },
      refId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
    },
    // Idempotency: one incident per source event. Derived from sourceRef (see hook below).
    sourceKey: { type: String, default: undefined },
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedAt: { type: Date, default: null },
    timeline: {
      type: [timelineEntrySchema],
      default: [],
    },
    resolution: {
      type: String,
      trim: true,
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    // Priority is separate from severity: severity is what happened, priority is how urgently we act.
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    // Escalation of unacknowledged / unresolved high-priority incidents (set once, never cleared)
    escalatedAt: { type: Date, default: null },
    escalationReason: { type: String, default: null },
    // First assignment, kept immutable so its audit proof stays verifiable after a reassignment
    firstAssignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    firstAssignedAt: { type: Date, default: null },
    // Evidence is recorded as a described reference (link or text), never an uploaded executable file.
    evidence: {
      type: [{
        kind: { type: String, enum: ['link', 'text'], required: true },
        title: { type: String, required: true, trim: true, maxlength: 140 },
        value: { type: String, required: true, trim: true, maxlength: 1000 },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

incidentSchema.index({ tourist: 1, createdAt: -1 });
incidentSchema.index({ status: 1, severity: -1 });
incidentSchema.index({ status: 1, severity: -1, createdAt: -1 });
incidentSchema.index({ sourceKey: 1 }, { unique: true, sparse: true });

const PRIORITY_FOR = { critical: 'urgent', high: 'high', medium: 'normal', low: 'low' };
incidentSchema.pre('validate', function setPriority(next) {
  if (this.isNew && !this.isModified('priority')) this.priority = PRIORITY_FOR[this.severity] || 'normal';
  next();
});

incidentSchema.pre('validate', function setSourceKey(next) {
  if (!this.sourceKey && this.sourceRef?.refModel && this.sourceRef?.refId) {
    this.sourceKey = `${this.sourceRef.refModel}:${this.sourceRef.refId}`;
  }
  next();
});

// Notify admins (persistent, deduplicated) exactly once when an incident is created —
// whichever code path created it (SOS, missed check-in, risk escalation …).
incidentSchema.pre('save', function remember(next) {
  this.$locals.wasNew = this.isNew;
  next();
});
incidentSchema.post('save', function notifyOnCreate(doc) {
  if (!doc.$locals.wasNew) return;
  require('../services/notifications/events').onIncidentCreated(doc).catch((err) => console.error('[notify] incident:', err.message));
});

const Incident = mongoose.model('Incident', incidentSchema);
Incident.STATUSES = STATUSES;
module.exports = Incident;
