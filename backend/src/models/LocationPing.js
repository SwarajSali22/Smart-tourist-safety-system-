const mongoose = require('mongoose');

const locationPingSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
    },
    tourist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    altitude: { type: Number, default: null },   // metres
    speed: { type: Number, default: null },       // km/h
    accuracy: { type: Number, default: null },    // metres
    battery: { type: Number, default: null },     // 0–100
    timestamp: { type: Date, required: true, default: Date.now },
  },
  {
    // Skip the default createdAt/updatedAt — timestamp above is the authoritative
    // time and we index on it.
    timestamps: false,
  }
);

// Primary query pattern: "give me recent pings for device X"
locationPingSchema.index({ device: 1, timestamp: -1 });
// Secondary: all pings for a tourist in a time window
locationPingSchema.index({ tourist: 1, timestamp: -1 });

module.exports = mongoose.model('LocationPing', locationPingSchema);
