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

geofenceEventSchema.pre('save', function remember(next) {
  this.$locals.wasNew = this.isNew;
  next();
});
geofenceEventSchema.post('save', function notifyOnEnter(doc) {
  if (!doc.$locals.wasNew || doc.eventType !== 'enter') return;
  require('../services/notifications/events').onGeofenceEnter(doc).catch((err) => console.error('[notify] geofence:', err.message));
});

geofenceEventSchema.index({ tourist: 1, createdAt: -1 });
geofenceEventSchema.index({ resolved: 1 });

module.exports = mongoose.model('GeofenceEvent', geofenceEventSchema);
