const { AuditProof, Incident } = require('../models');
const { verifyProof, verifyChain } = require('../services/blockchain/auditChain');

// ── GET /api/blockchain  (admin) — newest proofs first ───────────────────────
async function listProofs(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const proofs = await AuditProof.find()
      .select('-canonicalPayload')
      .sort({ 'chainRef.sequenceNo': -1 })
      .limit(limit)
      .lean();
    const total = await AuditProof.estimatedDocumentCount();
    return res.json({ success: true, proofs, total });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/blockchain/verify/:proofId  (admin) ─────────────────────────────
async function verifyOne(req, res, next) {
  try {
    const result = await verifyProof(req.params.proofId);
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
