const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { request, app, models, auth } = h;
const { triggerSos } = require('../src/services/sos/triggerSos');
const { verifyProof, verifyChain, recordProof } = require('../src/services/blockchain/auditChain');

describe('audit hash chain (a tamper-evident DATABASE chain — not a public blockchain)', () => {
  let admin; let tourist; let device; let sos; let incident; let proofs;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    tourist = await h.createUser('tourist');
    device = await h.createDevice(tourist.user);
    ({ sosEvent: sos, incident } = await triggerSos({ tourist: tourist.user._id, device: device.device._id, location: { lat: 12.34, lng: 56.78 }, source: 'app' }));
    proofs = await models.AuditProof.find().sort({ 'chainRef.sequenceNo': 1 });
  });
  after(h.disconnect);

  const verify = (id) => request(app).get(`/api/blockchain/verify/${id}`).set(auth(admin.token)).expect(200).then((r) => r.body.result);

  test('an SOS records proofs for the SOS and the incident, linked in a chain', async () => {
    const types = proofs.map((p) => p.eventType);
    assert.ok(types.includes('sos_triggered') && types.includes('incident_opened'));
    assert.deepEqual(proofs.map((p) => p.chainRef.sequenceNo), proofs.map((_, i) => i + 1));
    assert.equal(proofs[0].chainRef.previousHash, null);
    assert.equal(proofs[1].chainRef.previousHash, proofs[0].chainHash);
    const chain = await verifyChain();
    assert.equal(chain.valid, true);
    assert.equal(chain.length, proofs.length);
    assert.equal(chain.headHash, proofs.at(-1).chainHash);
    assert.deepEqual(chain.demo, { valid: true, length: 0, headHash: null }, 'no simulated events yet');
  });

  test('untouched records verify', async () => {
    for (const p of proofs) assert.equal((await verify(p._id)).status, 'verified');
  });

  test('MODIFIED: changing the SOS location after the fact is detected (and reverting it restores trust)', async () => {
    const proof = proofs.find((p) => p.eventType === 'sos_triggered');
    await models.SOSEvent.updateOne({ _id: sos._id }, { 'location.lat': 99 });
    const bad = await verify(proof._id);
    assert.equal(bad.status, 'modified');
    assert.equal(bad.checks.sourceMatches, false);
    assert.equal(bad.checks.payloadIntact, true);
    await models.SOSEvent.updateOne({ _id: sos._id }, { 'location.lat': 12.34 });
    assert.equal((await verify(proof._id)).status, 'verified');
  });

  test('legitimate lifecycle changes (status, assignment) do NOT break existing proofs', async () => {
    await request(app).patch(`/api/incidents/${incident._id}/status`).set(auth(admin.token)).send({ status: 'in_progress' }).expect(200);
    await request(app).patch(`/api/incidents/${incident._id}/status`).set(auth(admin.token)).send({ status: 'assigned' }).expect(200);
    for (const p of proofs) assert.equal((await verify(p._id)).status, 'verified', `${p.eventType} must survive normal workflow`);
  });

  test('assignment and resolution are recorded as new proofs', async () => {
    await request(app).patch(`/api/incidents/${incident._id}/status`).set(auth(admin.token)).send({ status: 'en_route' }).expect(200);
    await request(app).patch(`/api/incidents/${incident._id}/status`).set(auth(admin.token)).send({ status: 'resolved', note: 'all good' }).expect(200);
    const types = (await models.AuditProof.find().lean()).map((p) => p.eventType);
    for (const t of ['incident_assigned', 'incident_resolved', 'sos_resolved']) assert.ok(types.includes(t), `missing proof: ${t}`);
    const all = await models.AuditProof.find().sort({ 'chainRef.sequenceNo': 1 }).lean();
    for (const p of all) assert.equal((await verify(p._id)).status, 'verified');
    assert.equal((await verifyChain()).valid, true);
  });

  test('MODIFIED: editing a stored proof (data hash) breaks its own check and the whole chain', async () => {
    const proof = proofs[0];
    const original = proof.dataHash;
    await models.AuditProof.updateOne({ _id: proof._id }, { dataHash: 'f'.repeat(64) });
    assert.equal((await verify(proof._id)).status, 'modified');
    const chain = await verifyChain();
    assert.equal(chain.valid, false);
    assert.equal(chain.brokenAtSequence, 1);
    await models.AuditProof.updateOne({ _id: proof._id }, { dataHash: original });
    assert.equal((await verifyChain()).valid, true);
  });

  test('MODIFIED: a rewired link to the previous proof is detected per record and in the whole chain', async () => {
    const proof = proofs[1];
    const original = proof.chainRef.previousHash;
    await models.AuditProof.updateOne({ _id: proof._id }, { 'chainRef.previousHash': 'a'.repeat(64) });
    const bad = await verify(proof._id);
    assert.equal(bad.status, 'modified');
    assert.equal(bad.checks.chainIntact, false);
    const chain = await verifyChain();
    assert.equal(chain.valid, false);
    assert.equal(chain.brokenAtSequence, 2);
    await models.AuditProof.updateOne({ _id: proof._id }, { 'chainRef.previousHash': original });
    assert.equal((await verifyChain()).valid, true);
  });

  test('MODIFIED: a predecessor rewritten with a self-consistent hash breaks the link of the next proof', async () => {
    const [first, second] = proofs;
    await models.AuditProof.updateOne({ _id: first._id }, { chainHash: 'b'.repeat(64) });
    const bad = await verify(second._id);
    assert.equal(bad.status, 'modified');
    assert.equal(bad.checks.linkIntact, false);
    await models.AuditProof.updateOne({ _id: first._id }, { chainHash: first.chainHash });
    assert.equal((await verify(second._id)).checks.linkIntact, true);
  });

  test('chain: deleting a proof in the middle is detected (sequence gap)', async () => {
    const all = await models.AuditProof.find().sort({ 'chainRef.sequenceNo': 1 }).lean();
    const victim = all[1];
    await models.AuditProof.deleteOne({ _id: victim._id });
    const chain = await verifyChain();
    assert.equal(chain.valid, false);
    assert.equal(chain.reason, 'sequence gap');
    await models.AuditProof.create(victim); // restore
    assert.equal((await verifyChain()).valid, true);
  });

  test('MISSING: a proof whose source record was deleted is reported as missing, not as modified', async () => {
    const t2 = await h.createUser('tourist');
    const d2 = await h.createDevice(t2.user);
    const { sosEvent } = await triggerSos({ tourist: t2.user._id, device: d2.device._id, location: { lat: 1, lng: 1 }, source: 'app' });
    const proof = await models.AuditProof.findOne({ eventType: 'sos_triggered', eventRef: sosEvent._id });
    await models.SOSEvent.deleteOne({ _id: sosEvent._id });
    const result = await verify(proof._id);
    assert.equal(result.status, 'missing');
    assert.equal(result.checks.sourceFound, false);
  });

  test('FAILED: if the check cannot run, the API says "failed" rather than guessing a verdict', async () => {
    const original = models.AuditProof.findById;
    // simulate a database error during verification
    const auditChain = require('../src/services/blockchain/auditChain');
    const proof = proofs[0];
    const spy = models.AuditProof.findById;
    models.AuditProof.findById = () => { throw new Error('database unavailable'); };
    const origErr = console.error; console.error = () => {};
    try {
      const r = await request(app).get(`/api/blockchain/verify/${proof._id}`).set(auth(admin.token)).expect(200);
      assert.equal(r.body.result.status, 'failed');
      assert.ok(auditChain && spy);
    } finally {
      models.AuditProof.findById = original;
      console.error = origErr;
    }
  });

  test('simulated (demo) events are chained separately, so deleting them cannot break the real chain', async () => {
    const realBefore = await verifyChain();
    const demo = await h.createUser('tourist', { isDemo: true });
    const dd = await h.createDevice(demo.user, { isDemo: true });
    const { sosEvent } = await triggerSos({ tourist: demo.user._id, device: dd.device._id, location: { lat: 3, lng: 3 }, source: 'app' });
    const demoProofs = await models.AuditProof.find({ isDemo: true }).sort({ 'chainRef.sequenceNo': 1 });
    assert.ok(demoProofs.length >= 2);
    assert.deepEqual(demoProofs.map((p) => p.chainRef.sequenceNo), demoProofs.map((_, i) => i + 1), 'the demo chain has its own numbering');
    assert.equal(demoProofs[0].chainRef.previousHash, null);

    const realAfter = await verifyChain();
    assert.equal(realAfter.length, realBefore.length, 'demo events must not appear in the real chain');
    assert.equal(realAfter.headHash, realBefore.headHash);
    assert.equal(realAfter.demo.valid, true);
    assert.equal(realAfter.demo.length, demoProofs.length);
    assert.equal((await verify(demoProofs[0]._id)).status, 'verified');

    // "reset": remove the whole simulated chain + data
    await models.AuditProof.deleteMany({ isDemo: true });
    await models.SOSEvent.deleteOne({ _id: sosEvent._id });
    const cleaned = await verifyChain();
    assert.equal(cleaned.valid, true, 'the real chain is untouched by the demo reset');
    assert.equal(cleaned.length, realBefore.length);
    assert.equal(cleaned.demo.length, 0);
  });

  test('the proof list can be filtered to real or simulated proofs', async () => {
    const demo = await h.createUser('tourist', { isDemo: true });
    const dd = await h.createDevice(demo.user, { isDemo: true });
    await triggerSos({ tourist: demo.user._id, device: dd.device._id, location: { lat: 4, lng: 4 }, source: 'app' });
    const all = await request(app).get('/api/blockchain?limit=100').set(auth(admin.token)).expect(200);
    const real = await request(app).get('/api/blockchain?demo=0&limit=100').set(auth(admin.token)).expect(200);
    const sim = await request(app).get('/api/blockchain?demo=1&limit=100').set(auth(admin.token)).expect(200);
    assert.ok(real.body.proofs.every((p) => !p.isDemo));
    assert.ok(sim.body.proofs.length >= 2 && sim.body.proofs.every((p) => p.isDemo));
    assert.equal(all.body.total, real.body.total + sim.body.total);
    await models.AuditProof.deleteMany({ isDemo: true });
  });

  test('unknown proofs are 404, malformed ids 400, non-admins 403', async () => {
    await request(app).get('/api/blockchain/verify/507f1f77bcf86cd799439011').set(auth(admin.token)).expect(404);
    await request(app).get('/api/blockchain/verify/xyz').set(auth(admin.token)).expect(400);
    await request(app).get(`/api/blockchain/verify/${proofs[0]._id}`).set(auth(tourist.token)).expect(403);
    await request(app).get('/api/blockchain/verify-chain').set(auth(tourist.token)).expect(403);
  });

  test('recordProof never throws into the safety pipeline (errors are swallowed and logged)', async () => {
    const origErr = console.error; console.error = () => {};
    try {
      assert.equal(await recordProof('sos_triggered', 'SOSEvent', null), null);
    } finally { console.error = origErr; }
    assert.ok(verifyProof);
  });
});
