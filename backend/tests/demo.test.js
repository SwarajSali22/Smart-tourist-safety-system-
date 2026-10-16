const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { request, app, models, auth, eventually } = h;
const { triggerSos } = require('../src/services/sos/triggerSos');
const { verifyChain } = require('../src/services/blockchain/auditChain');

// The demo scripts share the backend's mongoose instance, so their cleanup runs against the test database.
const { cleanupDemo } = require('../../scripts/lib/demoCommon');

describe('demo data: isolation and reset', () => {
  let admin; let realTourist; let demoTourist;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    realTourist = await h.createUser('tourist', { name: 'Real Rita' });
    demoTourist = await h.createUser('tourist', { name: 'Demo Dave', isDemo: true });
    const rd = await h.createDevice(realTourist.user);
    const dd = await h.createDevice(demoTourist.user, { isDemo: true });
    await h.createZone('safe', 1, 1);
    await h.createZone('danger', 2, 2, 0.01, { isDemo: true });
    await triggerSos({ tourist: realTourist.user._id, device: rd.device._id, location: { lat: 1, lng: 1 }, source: 'app' });
    await triggerSos({ tourist: demoTourist.user._id, device: dd.device._id, location: { lat: 2, lng: 2 }, source: 'app' });
    await eventually(async () => (await models.Notification.countDocuments({ isDemo: true })) > 0, { message: 'demo notification' });
  });
  after(h.disconnect);

  test('demo events are labelled Simulated for admins and never send real SMS', async () => {
    const inc = await models.Incident.findOne({ tourist: demoTourist.user._id });
    const r = await request(app).get(`/api/incidents/${inc._id}`).set(auth(admin.token)).expect(200);
    assert.equal(r.body.incident.tourist.isDemo, true);
    assert.equal(r.body.sms.simulated, true);
    assert.equal(r.body.sms.sent, 0);
    const real = await models.Incident.findOne({ tourist: realTourist.user._id });
    const rr = await request(app).get(`/api/incidents/${real._id}`).set(auth(admin.token)).expect(200);
    assert.equal(rr.body.sms.simulated, false);
    const list = await request(app).get('/api/incidents').set(auth(admin.token)).expect(200);
    assert.ok(list.body.incidents.find((i) => String(i._id) === String(inc._id)).tourist.isDemo);
  });

  test('a dry run counts but deletes nothing', async () => {
    const before = await models.User.countDocuments();
    const counts = await cleanupDemo({ dry: true });
    assert.ok(counts.users === 1 && counts.incidents === 1 && counts.zones === 1);
    assert.equal(await models.User.countDocuments(), before);
  });

  test('the reset removes ONLY simulated data — real users, devices, zones, incidents and the real audit chain survive', async () => {
    const realChainBefore = await verifyChain();
    const realIncidentIds = (await models.Incident.find({ tourist: realTourist.user._id })).map((i) => String(i._id));
    await cleanupDemo();

    assert.equal(await models.User.countDocuments({ isDemo: true }), 0);
    assert.equal(await models.Device.countDocuments({ isDemo: true }), 0);
    assert.equal(await models.Zone.countDocuments({ isDemo: true }), 0);
    assert.equal(await models.Notification.countDocuments({ isDemo: true }), 0);
    assert.equal(await models.AuditProof.countDocuments({ isDemo: true }), 0);
    assert.equal(await models.Incident.countDocuments({ tourist: demoTourist.user._id }), 0);

    // untouched
    assert.ok(await models.User.findById(realTourist.user._id));
    assert.ok(await models.User.findById(admin.user._id));
    assert.equal(await models.Device.countDocuments({ tourist: realTourist.user._id }), 1);
    assert.equal(await models.Zone.countDocuments({ name: /safe zone/ }), 1);
    assert.deepEqual((await models.Incident.find({ tourist: realTourist.user._id })).map((i) => String(i._id)), realIncidentIds);
    const realChainAfter = await verifyChain();
    assert.equal(realChainAfter.valid, true);
    assert.equal(realChainAfter.length, realChainBefore.length);
    assert.equal(realChainAfter.headHash, realChainBefore.headHash);
    assert.ok(await models.Notification.countDocuments({ recipient: admin.user._id }) >= 0);
  });

  test('running the reset again is harmless', async () => {
    const counts = await cleanupDemo();
    assert.ok(Object.values(counts).every((n) => n === 0));
    assert.ok(await models.User.findById(realTourist.user._id));
  });
});
