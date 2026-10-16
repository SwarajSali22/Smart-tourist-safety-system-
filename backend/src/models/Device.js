const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    tourist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // 'wristband' = ESP32 / simulator (device-key auth); 'phone' = the tourist's own
    // phone, auto-created from POST /tourists/me/location (JWT auth, no API key).
    type: {
      type: String,
      enum: ['wristband', 'phone'],
      default: 'wristband',
    },
    // Lightweight per-device secret issued at registration (Phase 3 stores the hash)
    apiKeyHash: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'lost', 'emergency'],
      default: 'inactive',
    },
    isSimulated: {
      type: Boolean,
      default: false,
    },
    isDemo: { type: Boolean, default: false },
    emergencyMode: {
      type: Boolean,
      default: false,
    },
    battery: {
      type: Number, // 0–100
      default: null,
    },
    lastSeen: {
      type: Date,
      default: null,
    },
    lastLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    // Zones this device is currently inside, kept in sync on every telemetry
    // ping so geofence enter/exit can be detected by diffing (Phase 6).
    currentZones: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Zone',
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Device', deviceSchema);
