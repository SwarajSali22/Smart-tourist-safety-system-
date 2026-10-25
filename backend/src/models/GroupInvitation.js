const mongoose = require('mongoose');

/**
 * Invitation to join ONE group as a tourist. Only a SHA-256 hash of the token is stored (the link is shown once, at
 * creation). Valid while: not revoked, not expired, and usedCount < maxUses. It can never grant any role but tourist.
 */
const groupInvitationSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'TouristGroup', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    maxUses: { type: Number, required: true, min: 1, max: 500, default: 20 },
    usedCount: { type: Number, default: 0 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
groupInvitationSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model('GroupInvitation', groupInvitationSchema);
