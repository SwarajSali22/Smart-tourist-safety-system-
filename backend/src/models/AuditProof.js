const mongoose = require('mongoose');

// Stores a tamper-evident hash for every critical event.
// MongoDB remains the system of record — this collection proves that the
// event data hasn't changed since it was first recorded.
//
// Each proof links to the hash of the previous proof (chainRef.previousHash)
// forming an internal hash-chain.  An optional publicTxHash can be added
// later when the public-testnet anchor (Phase 14) is enabled.
const auditProofSchema = new mongoose.Schema(
  {
    // Which type of event this proof covers
    eventType: {
      type: String,
      enum: [
        'sos_triggered',
        'sos_resolved',
        'geofence_violation',
        'geofence_resolved',
        'risk_escalation',
        'incident_opened',
        'incident_resolved',
        'incident_assigned',
        'admin_action',
      ],
      required: true,
    },
    // Polymorphic reference to the source document
    eventModel: {
      type: String,
      enum: ['SOSEvent', 'GeofenceEvent', 'RiskAssessment', 'Incident'],
      required: true,
    },
    eventRef: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // SHA-256 hex digest of the canonicalized event payload
    dataHash: {
      type: String,
      required: true,
    },
    // sha256(previousHash | sequenceNo | eventType | dataHash) — links the chain
    chainHash: { type: String, default: null },

    // The raw payload that was hashed (stored so we can re-verify on demand)
    canonicalPayload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Internal hash-chain link
    chainRef: {
      previousHash: { type: String, default: null }, // hash of the previous AuditProof
      sequenceNo: { type: Number, default: 0 },      // monotonically increasing
    },
    // Optional public blockchain anchor (Phase 14)
    publicAnchor: {
      network: { type: String, default: null },        // e.g. "polygon-amoy"
      txHash: { type: String, default: null },
      anchoredAt: { type: Date, default: null },
    },
    // Simulated (demo) events are chained SEPARATELY from real ones, so the demo reset can
    // delete them without breaking the real chain.
    isDemo: { type: Boolean, default: false },
    verified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

auditProofSchema.index({ eventRef: 1 });
auditProofSchema.index({ 'chainRef.sequenceNo': 1 });
auditProofSchema.index({ isDemo: 1, 'chainRef.sequenceNo': 1 });

module.exports = mongoose.model('AuditProof', auditProofSchema);
