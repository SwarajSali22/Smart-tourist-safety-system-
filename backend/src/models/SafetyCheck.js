const mongoose = require('mongoose');

const safetyCheckSchema = new mongoose.Schema(
  {
    tourist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    scheduledAt: {
      type: Date,
      required: true,
    },
    // Null until the tourist responds
    respondedAt: {
      type: Date,
      default: null,
    },
    response: {
      type: String,
      enum: ['safe', 'unsafe', 'no_response'],
      default: 'no_response',
    },
    // If the tourist replied with a message
    message: {
      type: String,
      trim: true,
      default: null,
    },
    // The system that triggered this check
    triggeredBy: {
      type: String,
      enum: ['scheduler', 'admin', 'system'],
      default: 'scheduler',
    },
    // Whether an escalation was raised for this unanswered/unsafe check
    escalated: {
      type: Boolean,
      default: false,
    },
    incident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      default: null,
    },
  },
  { timestamps: true }
);

safetyCheckSchema.index({ tourist: 1, scheduledAt: -1 });
safetyCheckSchema.index({ response: 1, escalated: 1 });

module.exports = mongoose.model('SafetyCheck', safetyCheckSchema);
