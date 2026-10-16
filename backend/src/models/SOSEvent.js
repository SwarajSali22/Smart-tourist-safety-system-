const mongoose = require('mongoose');

const sosEventSchema = new mongoose.Schema(
  {
    tourist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    // How the SOS was triggered
    source: {
      type: String,
      enum: ['button', 'app', 'auto_no_response', 'auto_geofence', 'auto_risk_critical'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'acknowledged', 'resolved', 'false_alarm'],
      default: 'active',
    },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolutionNote: { type: String, trim: true, default: null },
    incident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      default: null,
    },
    // Set to the tourist id while the SOS is active/acknowledged and removed when it ends.
    // The unique sparse index below makes a second concurrent SOS impossible.
    activeKey: { type: String, default: undefined },
    auditProof: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AuditProof',
      default: null,
    },
  },
  { timestamps: true }
);

sosEventSchema.index({ tourist: 1, createdAt: -1 });
sosEventSchema.index({ status: 1 });
sosEventSchema.index({ activeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('SOSEvent', sosEventSchema);
