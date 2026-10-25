const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { sweep } = require('../src/jobs/safetyCheckScheduler');
const { reconcileSosState } = require('../src/services/sos/reconcile');

const { models } = h;
const MIN = 60 * 1000;

describe('SOS is never re-created from stale data', () => {
  before(h.connect);
  after(h.disconnect);

  test('a check that expired while the server was down is retired, not escalated to an SOS', async () => {
    const t = await h.createUser('tourist');
    const d = await h.createDevice(t.user, { lastLocation: { lat: 1, lng: 1 }, lastSeen: new Date() });
    const check = await models.SafetyCheck.create({ tourist: t.user._id, scheduledAt: new Date(Date.now() - 3 * 60 * MIN) });
    await sweep(null);
    assert.equal(await models.SOSEvent.countDocuments({ tourist: t.user._id }), 0);
    assert.equal((await models.SafetyCheck.findById(check._id)).escalated, true);
    assert.ok(d);
  });

  test('a stale device is not prompted, and an unanswered check from an offline device makes no SOS', async () => {
    const t = await h.createUser('tourist');
    await h.createDevice(t.user, { lastLocation: { lat: 1, lng: 1 }, lastSeen: new Date(Date.now() - 3 * 60 * MIN) });
    await sweep(null);
    assert.equal(await models.SafetyCheck.countDocuments({ tourist: t.user._id }), 0);

    const t2 = await h.createUser('tourist');
    await h.createDevice(t2.user, { lastLocation: { lat: 1, lng: 1 }, lastSeen: new Date(Date.now() - 40 * MIN) });
    await models.SafetyCheck.create({ tourist: t2.user._id, scheduledAt: new Date(Date.now() - 6 * MIN) });
    await sweep(null);
    assert.equal(await models.SOSEvent.countDocuments({ tourist: t2.user._id }), 0);
    assert.equal(await models.Incident.countDocuments({ tourist: t2.user._id, type: 'no_response' }), 1);
  });

  test('a live device that ignores a check still gets an SOS stamped with the real creation time', async () => {
    const t = await h.createUser('tourist');
    await h.createDevice(t.user, { lastLocation: { lat: 1, lng: 1 }, lastSeen: new Date() });
    await models.SafetyCheck.create({ tourist: t.user._id, scheduledAt: new Date(Date.now() - 6 * MIN) });
    const before = Date.now();
    await sweep(null);
    const sos = await models.SOSEvent.findOne({ tourist: t.user._id });
    assert.ok(sos);
    assert.ok(sos.createdAt.getTime() >= before - 1000);
  });

  test('startup reconcile closes an SOS whose incident is already resolved', async () => {
    const t = await h.createUser('tourist');
    const incident = await models.Incident.create({ tourist: t.user._id, type: 'sos', severity: 'critical', status: 'resolved', resolvedAt: new Date() });
    const sos = await models.SOSEvent.create({ tourist: t.user._id, location: { lat: 1, lng: 1 }, source: 'app', status: 'active', activeKey: String(t.user._id), incident: incident._id });
    assert.equal(await reconcileSosState(), 1);
    const after = await models.SOSEvent.findById(sos._id);
    assert.equal(after.status, 'resolved');
    assert.equal(after.activeKey, undefined);
  });
});
