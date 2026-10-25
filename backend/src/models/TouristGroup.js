const mongoose = require('mongoose');

/** A named group of tourists run by staff (a tour party). Members are TouristProfile.group. */
const touristGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TouristGroup', touristGroupSchema);
