const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    location: { lat: { type: Number, required: true }, lng: { type: Number, required: true } },
    expectedArrival: { type: Date, required: true },
    radiusM: { type: Number, default: 250 },       // how close counts as "arrived"
    status: { type: String, enum: ['pending', 'arrived', 'skipped'], default: 'pending' },
    arrivedAt: { type: Date, default: null },
    arrivedVia: { type: String, enum: ['manual', 'gps', null], default: null },
    overdueAlertedAt: { type: Date, default: null }, // alert de-duplication
  },
  { _id: true }
);

const tripSchema = new mongoose.Schema(
  {
    tourist: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    destination: { type: String, required: true, trim: true, maxlength: 160 },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: { type: String, enum: ['planned', 'active', 'completed', 'cancelled'], default: 'planned' },
    stops: { type: [stopSchema], default: [] },
    // Scheduled "are you OK?" cadence while the trip is active (minutes; 0 = off)
    checkInEveryMin: { type: Number, default: 0, min: 0, max: 720 },
    lastCheckInAt: { type: Date, default: null },
    nextCheckInDue: { type: Date, default: null },
    checkInAlertedAt: { type: Date, default: null },
    // Route deviation: distance from the planned stop-to-stop path before warning (metres)
    deviationThresholdM: { type: Number, default: 1500 },
    deviationAlertedAt: { type: Date, default: null },
    // The tourist can acknowledge a warning ("I'm fine") to clear it without anyone being alerted further
    warningsAcknowledgedAt: { type: Date, default: null },
    alerts: {
      type: [{ kind: String, message: String, at: { type: Date, default: Date.now }, acknowledged: { type: Boolean, default: false } }],
      default: [],
    },
    cancelledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

tripSchema.index({ status: 1, endAt: 1 });

module.exports = mongoose.model('Trip', tripSchema);
