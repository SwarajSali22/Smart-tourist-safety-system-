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
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

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
      enum: ['open', 'in_progress', 'resolved', 'closed'],
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
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
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
  },
  { timestamps: true }
);

incidentSchema.index({ tourist: 1, createdAt: -1 });
incidentSchema.index({ status: 1, severity: -1 });

module.exports = mongoose.model('Incident', incidentSchema);
