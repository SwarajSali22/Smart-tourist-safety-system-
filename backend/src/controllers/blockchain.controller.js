const { AuditProof, Incident } = require('../models');
const { verifyProof, verifyChain } = require('../services/blockchain/auditChain');

// ── GET /api/blockchain  (admin) — newest proofs first ───────────────────────
async function listProofs(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    // ?demo=1 → only simulated proofs, ?demo=0 → only real ones, default: both (newest first)
    const filter = req.query.demo === '1' ? { isDemo: true } : req.query.demo === '0' ? { isDemo: { $ne: true } } : {};
    const proofs = await AuditProof.find(filter)
      .select('-canonicalPayload')
      .sort({ createdAt: -1, 'chainRef.sequenceNo': -1 })
      .limit(limit)
      .lean();
    const total = await AuditProof.countDocuments(filter);
    return res.json({ success: true, proofs, total });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/blockchain/verify/:proofId  (admin) ─────────────────────────────
async function verifyOne(req, res, next) {
  try {
    let result;
    try {
      result = await verifyProof(req.params.proofId);
    } catch (err) {
      // The check itself could not run (database error …) — say so rather than guessing.
      console.error('[audit] verify failed:', err.message);
      return res.json({ success: true, result: { proofId: req.params.proofId, status: 'failed', message: 'The verification could not be completed. Try again.' } });
    }
    if (!result) return res.status(404).json({ success: false, message: 'Proof not found' });
    return res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/blockchain/verify-chain  (admin) ────────────────────────────────
async function verifyWholeChain(req, res, next) {
  try {
    return res.json({ success: true, result: await verifyChain() });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/blockchain/incident/:id  (admin) — proofs for an incident + its SOS ─
async function proofsForIncident(req, res, next) {
  try {
    const incident = await Incident.findById(req.params.id).lean();
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    const refs = [incident._id];
    if (incident.sourceRef?.refId) refs.push(incident.sourceRef.refId);
    const proofs = await AuditProof.find({ eventRef: { $in: refs } })
      .select('-canonicalPayload')
      .sort({ 'chainRef.sequenceNo': 1 })
      .lean();
    return res.json({ success: true, proofs });
  } catch (err) {
    next(err);
  }
}

module.exports = { listProofs, verifyOne, verifyWholeChain, proofsForIncident };
