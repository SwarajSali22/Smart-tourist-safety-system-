const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { escalateUnsafeResponse } = require('../src/services/safetyCheck/escalate');
const { triggerSos, SosAlreadyActiveError } = require('../src/services/sos/triggerSos');

const { models } = h;

describe('event correlation', () => {
  let t; let other;
  before(async () => {
    await h.connect();
    t = await h.createUser('tourist', { name: 'Cora Related' });
    other = await h.createUser('tourist', { name: 'Olga Other' });
  });
  after(h.disconnect);

  const check = (u) => models.SafetyCheck.create({ tourist: u.user._id, scheduledAt: new Date(), response: 'unsafe' });

  test('an "unsafe" reply during an active SOS joins that incident instead of opening a duplicate', async () => {
    const { incident } = await triggerSos({ tourist: t.user._id, device: null, location: { lat: 1, lng: 1 }, source: 'app' });
    const sc = await check(t);
    const joined = await escalateUnsafeResponse(sc, null);
    assert.equal(String(joined._id), String(incident._id));
    assert.equal(await models.Incident.countDocuments({ tourist: t.user._id }), 1);
    const full = await models.Incident.findById(incident._id);
    assert.equal(full.timeline[0].action, 'SOS triggered (app)'); // original entry untouched
    assert.ok(full.timeline.some((e) => e.metadata?.correlated && e.metadata.sourceModel === 'SafetyCheck'));
    assert.equal(String((await models.SafetyCheck.findById(sc._id)).incident), String(incident._id));
  });

  test('a genuine new SOS is never absorbed: a second SOS is still refused only by the one-active-SOS rule', async () => {
    await assert.rejects(triggerSos({ tourist: t.user._id, device: null, location: { lat: 1, lng: 1 }, source: 'app' }), SosAlreadyActiveError);
    await models.SOSEvent.updateMany({ tourist: t.user._id }, { $set: { status: 'resolved' }, $unset: { activeKey: '' } });
    await models.Incident.updateMany({ tourist: t.user._id }, { $set: { status: 'resolved' } });
    const again = await triggerSos({ tourist: t.user._id, device: null, location: { lat: 1, lng: 1 }, source: 'app' });
    assert.equal(again.incident.status, 'open');
  });

  test('other tourists and finished incidents are never correlated', async () => {
    const sc = await check(other);
    const inc = await escalateUnsafeResponse(sc, null);
    assert.equal(inc.type, 'other');
    assert.equal(await models.Incident.countDocuments({ tourist: other.user._id }), 1);
  });

  describe('geofence events', () => {
    let a; let b; let devA; let devB;
    before(async () => {
      a = await h.createUser('tourist', { name: 'Geo A' });
      b = await h.createUser('tourist', { name: 'Geo B' });
      devA = await h.createDevice(a.user);
      devB = await h.createDevice(b.user);
      await h.createZone('restricted', 20, 20);
    });
    const ping = (d, lat, lng) => h.request(h.app).post(`/api/devices/${d.device.deviceId}/telemetry`).set(d.headers).send({ lat, lng, battery: 80 }).expect(200);

    test('a restricted-zone entry with no active incident creates no incident (not every warning is an emergency)', async () => {
      await ping(devB, 20, 20);
      assert.equal(await models.GeofenceEvent.countDocuments({ tourist: b.user._id, eventType: 'enter' }), 1);
      assert.equal(await models.Incident.countDocuments({ tourist: b.user._id, type: { $in: ['sos', 'geofence_violation'] } }), 0);
    });

    test('with an active SOS nearby the entry is added to that incident; the event, SOS and other tourists are untouched', async () => {
      const { incident } = await triggerSos({ tourist: a.user._id, device: devA.device._id, location: { lat: 20.001, lng: 20.001 }, source: 'app' });
      await ping(devA, 20, 20);
      const full = await models.Incident.findById(incident._id);
      const entry = full.timeline.find((e) => e.metadata?.sourceModel === 'GeofenceEvent');
      assert.ok(entry, 'geofence entry on the timeline');
      assert.equal(full.timeline[0].action, 'SOS triggered (app)');
      assert.equal(await models.Incident.countDocuments({ tourist: a.user._id }), 1); // no duplicate
      const ev = await models.GeofenceEvent.findOne({ tourist: a.user._id, eventType: 'enter' });
      assert.equal(String(ev._id), entry.metadata.sourceId);
      // tourist B has no incident and gained none
      assert.equal(await models.Incident.countDocuments({ tourist: b.user._id }), 0);
    });

    test('a far-away active incident is not correlated (location rule)', async () => {
      const { findRelatedIncident } = require('../src/services/incidents/correlate');
      const rel = await findRelatedIncident(a.user._id, { location: { lat: 25, lng: 25 } });
      assert.equal(rel, null);
    });
  });

  describe('active SOS list', () => {
    test('GET /api/sos still returns an old open SOS when 100+ newer events exist', async () => {
      const admin = await h.createUser('admin', { name: 'List Admin' });
      const old = await h.createUser('tourist', { name: 'Old Open' });
      const mk = (tourist, status, createdAt) => models.SOSEvent.collection.insertOne({ tourist, location: { lat: 1, lng: 1 }, source: 'app', status, createdAt, updatedAt: createdAt, ...(status === 'active' ? { activeKey: String(tourist) } : {}) });
      await mk(old.user._id, 'active', new Date(Date.now() - 10 * 86400000));
      for (let i = 0; i < 105; i += 1) await mk(new models.User()._id, 'resolved', new Date(Date.now() - i * 1000));
      const r = await h.request(h.app).get('/api/sos').set(h.auth(admin.token)).expect(200);
      assert.ok(r.body.events.some((e) => e.status === 'active' && e.tourist?.name === 'Old Open'));
      assert.ok(r.body.events.length > 100 && r.body.events.length <= 100 + 5); // newest 100 plus the extra open one(s)
    });
  });
});
