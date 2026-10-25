const mongoose = require('mongoose');

// Append-only record of who did what (authentication, privileged and incident actions).
// Separate from the SHA-256 AuditProof chain, which covers the safety events themselves.
const activityLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: null },
    action: { type: String, required: true, index: true }, // e.g. auth.login, incident.assign
    outcome: { type: String, enum: ['success', 'failure', 'denied'], default: 'success' },
    targetModel: { type: String, default: null },
    targetId: { type: String, default: null },
    summary: { type: String, default: null },
    ip: { type: String, default: null },
    // Never put secrets, tokens or passwords here.
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { versionKey: false }
);

activityLogSchema.index({ actor: 1, at: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
