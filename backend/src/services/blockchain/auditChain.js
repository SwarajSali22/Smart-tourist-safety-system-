const crypto = require('crypto');
const { AuditProof, SOSEvent, Incident, GeofenceEvent, RiskAssessment, User } = require('../../models');

/**
 * Internal SHA-256 hash-chain (Phase 14). MongoDB stays the system of record;
 * each AuditProof stores a hash of the event's *immutable* fields plus a link
 * to the previous proof, so editing a source record — or deleting/reordering
 * proofs — is detectable. Only hashes and ids are chained, never PII beyond
 * what is already in the referenced record.
 */

const MODELS = { SOSEvent, Incident, GeofenceEvent, RiskAssessment };

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Stable stringify: sorted keys, ISO dates, ids as hex strings.
function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== 'object') return JSON.stringify(value);
  if (value._bsontype === 'ObjectId' || typeof value.toHexString === 'function') {
    return JSON.stringify(String(value));
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

const idOf = (v) => (v == null ? null : String(v._id || v));
const iso = (d) => (d ? new Date(d).toISOString() : null);

// Only fields that never change after the event is created/resolved.
const PAYLOAD = {
  sos_triggered: (d) => ({
    id: idOf(d),
    tourist: idOf(d.tourist),
    device: idOf(d.device),
    location: { lat: d.location?.lat, lng: d.location?.lng },
    source: d.source,
    createdAt: iso(d.createdAt),
  }),
  sos_resolved: (d) => ({
    id: idOf(d),
    status: d.status,
    resolvedAt: iso(d.resolvedAt),
    resolutionNote: d.resolutionNote || null,
  }),
  geofence_violation: (d) => ({
    id: idOf(d),
    tourist: idOf(d.tourist),
    zone: idOf(d.zone),
    device: idOf(d.device),
    eventType: d.eventType,
    location: { lat: d.location?.lat, lng: d.location?.lng },
    createdAt: iso(d.createdAt),
  }),
  risk_escalation: (d) => ({
    id: idOf(d),
    tourist: idOf(d.tourist),
    score: d.score,
    level: d.level,
    ruleTriggered: Boolean(d.ruleTriggered),
    ruleName: d.ruleName || null,
    evaluatedAt: iso(d.evaluatedAt),
  }),
  incident_opened: (d) => ({
    id: idOf(d),
    tourist: idOf(d.tourist),
    type: d.type,
    sourceRef: { refModel: d.sourceRef?.refModel || null, refId: idOf(d.sourceRef?.refId) },
    createdAt: iso(d.createdAt),
  }),
  incident_assigned: (d) => ({
    id: idOf(d),
    assignedAdmin: idOf(d.assignedAdmin),
    assignedAt: iso(d.assignedAt),
  }),
  incident_resolved: (d) => ({
    id: idOf(d),
    status: d.status,
    resolution: d.resolution || null,
    resolvedAt: iso(d.resolvedAt),
  }),
};

const chainHashOf = ({ previousHash, sequenceNo, eventType, dataHash }) =>
  sha256(`${previousHash || 'GENESIS'}|${sequenceNo}|${eventType}|${dataHash}`);

// Serialise writes so concurrent events can't claim the same sequence number
// (single backend instance assumed — see docs if scaling out).
let queue = Promise.resolve();

// Real and simulated events live in two independent chains.
const partition = (isDemo) => (isDemo ? { isDemo: true } : { isDemo: { $ne: true } });

async function _isDemoEvent(doc) {
  const tourist = idOf(doc.tourist);
  if (!tourist) return false; // e.g. resolution records carry no tourist: fall back to the real chain
  const u = await User.findById(tourist).select('isDemo').lean();
  return Boolean(u?.isDemo);
}

async function _record(eventType, eventModel, doc) {
  const payload = PAYLOAD[eventType](doc);
  const dataHash = sha256(canonicalize(payload));
  let isDemo = await _isDemoEvent(doc);
  if (!isDemo && !doc.tourist) {
    // sos_resolved / incident_resolved / incident_assigned: follow the source record's tourist
    const src = await MODELS[eventModel].findById(doc._id).select('tourist').lean();
    isDemo = src?.tourist ? await _isDemoEvent(src) : false;
  }
  const last = await AuditProof.findOne(partition(isDemo)).sort({ 'chainRef.sequenceNo': -1 }).select('chainHash chainRef');
  const sequenceNo = last ? last.chainRef.sequenceNo + 1 : 1;
  const previousHash = last ? last.chainHash : null;
  return AuditProof.create({
    eventType,
    eventModel,
    eventRef: doc._id,
    isDemo,
    dataHash,
    canonicalPayload: payload,
    chainRef: { previousHash, sequenceNo },
    chainHash: chainHashOf({ previousHash, sequenceNo, eventType, dataHash }),
  });
}

/** Never throws — auditing must not break the safety pipeline it observes. */
function recordProof(eventType, eventModel, doc) {
  const run = queue.then(() => _record(eventType, eventModel, doc));
  queue = run.catch(() => {});
  return run.catch((err) => {
    console.error('[auditChain] failed to record proof:', err.message);
    return null;
  });
}

async function verifyProof(proofId) {
  const proof = await AuditProof.findById(proofId).lean();
  if (!proof) return null;

  const payloadIntact = sha256(canonicalize(proof.canonicalPayload)) === proof.dataHash;
  const chainIntact =
    chainHashOf({
      previousHash: proof.chainRef.previousHash,
      sequenceNo: proof.chainRef.sequenceNo,
      eventType: proof.eventType,
      dataHash: proof.dataHash,
    }) === proof.chainHash;

  const source = await MODELS[proof.eventModel].findById(proof.eventRef).lean();
  const sourceFound = Boolean(source);
  const sourceMatches =
    sourceFound && sha256(canonicalize(PAYLOAD[proof.eventType](source))) === proof.dataHash;

  const verified = payloadIntact && chainIntact && sourceMatches;
  // verified — everything matches
  // missing  — the source record no longer exists in the database
  // modified — the source record, the stored payload or the chain link was changed after it was hashed
  const status = verified ? 'verified' : !sourceFound ? 'missing' : 'modified';
  await AuditProof.updateOne({ _id: proof._id }, { verified, verifiedAt: new Date() });

  return {
    proofId: proof._id,
    eventType: proof.eventType,
    sequenceNo: proof.chainRef.sequenceNo,
    status,
    checks: { payloadIntact, chainIntact, sourceFound, sourceMatches },
    dataHash: proof.dataHash,
    checkedAt: new Date(),
  };
}

async function _verifyPartition(isDemo) {
  const proofs = await AuditProof.find(partition(isDemo)).sort({ 'chainRef.sequenceNo': 1 }).limit(10000).lean();
  let prev = null;
  let expectedSeq = 1;
  for (const p of proofs) {
    const linkOk = p.chainRef.previousHash === (prev ? prev.chainHash : null);
    const seqOk = p.chainRef.sequenceNo === expectedSeq;
    const hashOk =
      chainHashOf({
        previousHash: p.chainRef.previousHash,
        sequenceNo: p.chainRef.sequenceNo,
        eventType: p.eventType,
        dataHash: p.dataHash,
      }) === p.chainHash && sha256(canonicalize(p.canonicalPayload)) === p.dataHash;
    if (!linkOk || !seqOk || !hashOk) {
      return {
        valid: false,
        length: proofs.length,
        brokenAtSequence: p.chainRef.sequenceNo,
        reason: !seqOk ? 'sequence gap' : !linkOk ? 'broken link' : 'hash mismatch',
      };
    }
    prev = p;
    expectedSeq += 1;
  }
  return { valid: true, length: proofs.length, headHash: prev ? prev.chainHash : null };
}

/**
 * Verifies the REAL chain (the top-level fields) and reports the simulated chain
 * separately under `demo` — demo data can come and go without affecting real records.
 */
async function verifyChain() {
  const [real, demo] = await Promise.all([_verifyPartition(false), _verifyPartition(true)]);
  return { ...real, demo };
}

module.exports = { recordProof, verifyProof, verifyChain, canonicalize };
