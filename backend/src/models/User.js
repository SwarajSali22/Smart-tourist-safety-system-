const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    role: {
      type: String,
      enum: ['tourist', 'admin', 'responder'],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Seeded by scripts/demoScenarios.js; removed by scripts/demoReset.js. Shown as "Simulated" in the UI.
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
