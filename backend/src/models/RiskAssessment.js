const mongoose = require('mongoose');

// Risk bands (from Phase 0 plan):
//   0–29  Low
//  30–59  Medium
//  60–84  High
//  85–100 Critical / Emergency
const riskAssessmentSchema = new mongoose.Schema(
  {
    tourist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    level: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      required: true,
    },
    // Weighted factor breakdown so the score is fully explainable
    factors: {
      safetyCheckScore: { type: Number, default: 0 },   // contribution from check responses
      zoneRiskScore: { type: Number, default: 0 },      // current zone risk level
      violationScore: { type: Number, default: 0 },     // recent geofence violations
      incidentScore: { type: Number, default: 0 },      // open/recent incidents
      movementScore: { type: Number, default: 0 },      // movement anomaly
      connectivityScore: { type: Number, default: 0 },  // device offline / battery low
    },
    // Plain-language reason for each factor ({ key, label, points, max, detail })
    explanation: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Was the position behind this score too old to say where the tourist is now?
    locationStale: { type: Boolean, default: false },
    locationAgeMin: { type: Number, default: null },
    // How the score was produced — it is rule-based/hybrid, not a trained ML model
    method: { type: String, default: 'rule-based-hybrid' },
    // Rule-triggered override (e.g. SOS pressed, danger zone entered)
    ruleTriggered: {
      type: Boolean,
      default: false,
    },
    ruleName: {
      type: String,
      default: null,
    },
    evaluatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: false }
);

riskAssessmentSchema.index({ tourist: 1, evaluatedAt: -1 });

module.exports = mongoose.model('RiskAssessment', riskAssessmentSchema);
