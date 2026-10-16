const mongoose = require('mongoose');

const geofenceEventSchema = new mongoose.Schema(
  {
    tourist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    zone: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Zone',
      required: true,
    },
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },
    eventType: {
      type: String,
      enum: ['enter', 'exit'],
      required: true,
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    resolved: {
      type: Boolean,
      default: false,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Links to the AuditProof record created for this event
    auditProof: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AuditProof',
      default: null,
    },
  },
  { timestamps: true }
);

geofenceEventSchema.index({ tourist: 1, createdAt: -1 });
geofenceEventSchema.index({ resolved: 1 });

module.exports = mongoose.model('GeofenceEvent', geofenceEventSchema);
