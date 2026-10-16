const mongoose = require('mongoose');

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    relationship: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const itineraryItemSchema = new mongoose.Schema(
  {
    destination: { type: String, trim: true },
    arrivalAt: { type: Date, default: null },
    departureAt: { type: Date, default: null },
    notes: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const touristProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },
    emergencyContacts: {
      type: [emergencyContactSchema],
      default: [],
    },
    itinerary: {
      type: [itineraryItemSchema],
      default: [],
    },
    nationality: { type: String, trim: true, default: null },
    language: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TouristProfile', touristProfileSchema);
