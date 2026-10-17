const mongoose = require('mongoose');

/**
 * A place a tourist can get help (hospital, police station …). There is NO seed data:
 * admins add the real ones for their area, and tourists see only what was added.
 */
const helpCenterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['hospital', 'police', 'fire', 'embassy', 'pharmacy', 'other'], default: 'other' },
    phone: { type: String, trim: true, default: null },
    address: { type: String, trim: true, default: null },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

helpCenterSchema.index({ isActive: 1, type: 1 });

module.exports = mongoose.model('HelpCenter', helpCenterSchema);
