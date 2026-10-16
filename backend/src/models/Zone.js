const mongoose = require('mongoose');

// GeoJSON Polygon or MultiPolygon stored for $geoWithin / $geoIntersects queries.
// Enable 2dsphere index below so MongoDB can use these queries efficiently.
const zoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    type: {
      type: String,
      enum: ['safe', 'danger', 'restricted'],
      required: true,
    },
    riskLevel: {
      type: Number,   // 0–100, mirrors the risk-assessment scale
      min: 0,
      max: 100,
      default: 0,
    },
    // GeoJSON geometry — Polygon or MultiPolygon
    geometry: {
      type: {
        type: String,
        enum: ['Polygon', 'MultiPolygon'],
        required: true,
      },
      coordinates: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

zoneSchema.index({ geometry: '2dsphere' });

module.exports = mongoose.model('Zone', zoneSchema);
