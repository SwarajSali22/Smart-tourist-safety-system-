const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { request, app, models, auth, eventually } = h;
const { createNotification } = require('../src/services/notifications/notify');
const { triggerSos, SosAlreadyActiveError } = require('../src/services/sos/triggerSos');

describe('persistent notifications + idempotency', () => {
  let admin; let admin2; let tourist; let other; let device;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    admin2 = await h.createUser('admin');
    tourist = await h.createUser('tourist', { name: 'Nia Notified' });
    other = await h.createUser('tourist');
    device = await h.createDevice(tourist.user);
    await h.createZone('danger', 20, 20);
    await h.createZone('restricted', 30, 30);
  });
  after(h.disconnect);

  const list = (u, q = '') => request(app).get(`/api/notifications${q}`).set(auth(u.token)).expect(200).then((r) => r.body);
  const telemetry = (lat, lng, extra = {}) => request(app).post(`/api/devices/${device.device.deviceId}/telemetry`).set(device.headers).send({ lat, lng, battery: 90, ...extra });

  test('an SOS notifies every admin exactly once (persistent, unread, deep-linked) and the tourist about the zone', async () => {
    await telemetry(19.5, 19.5).expect(200);
    await telemetry(20, 20).expect(200); // enters the danger zone → auto-SOS
    const incident = await eventually(() => models.Incident.findOne({ tourist: tourist.user._id, type: 'sos' }), { message: 'incident' });

    for (const a of [admin, admin2]) {
      const body = await eventually(async () => { const b = await list(a); return b.notifications.some((n) => n.type === 'sos_alert') ? b : null; }, { message: 'admin notification' });
      const sos = body.notifications.filter((n) => n.type === 'sos_alert');
      assert.equal(sos.length, 1, 'one SOS notification per admin');
      assert.equal(sos[0].read, false);
      assert.equal(sos[0].severity, 'critical');
      assert.equal(sos[0].link, `/admin/incidents/${incident._id}`);
      assert.ok(body.unreadCount >= 1);
    }
    const mine = await eventually(async () => { const b = await list(tourist); return b.notifications.some((n) => n.type === 'geofence_violation') ? b : null; }, { message: 'tourist notification' });
    const geo = mine.notifications.find((n) => n.type === 'geofence_violation');
    assert.equal(geo.severity, 'critical');
    assert.equal(geo.link, '/tourist/map');
    assert.equal(geo.payload.danger, true);
    // a danger-zone entry is covered by the SOS: admins are not sent a second, duplicate notification for it
    assert.equal((await list(admin)).notifications.filter((n) => n.type === 'geofence_violation').length, 0);
  });

  test('replaying the same source event never creates a second notification (dedupeKey)', async () => {
    const spec = { recipient: tourist.user._id, type: 'general', title: 't', message: 'm', dedupeKey: 'replay-test-1' };
    const first = await createNotification(spec);
    const second = await createNotification(spec);
    assert.ok(first && !second);
    assert.equal(await models.Notification.countDocuments({ dedupeKey: 'replay-test-1' }), 1);
  });

  test('an incident is unique per source event: a second incident for the same SOS is refused, and no extra notification appears', async () => {
    const incident = await models.Incident.findOne({ tourist: tourist.user._id, type: 'sos' });
    const before = await models.Notification.countDocuments({ 'payload.incident': incident._id });
    await assert.rejects(
      models.Incident.create({ tourist: tourist.user._id, type: 'sos', severity: 'critical', sourceRef: incident.sourceRef, timeline: [{ action: 'dup' }] }),
      (err) => err.code === 11000
    );
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await models.Notification.countDocuments({ 'payload.incident': incident._id }), before);
  });

  test('two simultaneous SOS triggers produce one SOS and one incident (database-enforced)', async () => {
    const t2 = await h.createUser('tourist');
    const d2 = await h.createDevice(t2.user);
    const args = { tourist: t2.user._id, device: d2.device._id, location: { lat: 1, lng: 1 }, source: 'app' };
    const results = await Promise.allSettled([triggerSos(args), triggerSos(args), triggerSos(args)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof SosAlreadyActiveError));
    assert.equal(await models.SOSEvent.countDocuments({ tourist: t2.user._id }), 1);
    assert.equal(await models.Incident.countDocuments({ tourist: t2.user._id }), 1);
  });

  test('a restricted-zone entry notifies the tourist AND the admins (no SOS)', async () => {
    const t3 = await h.createUser('tourist', { name: 'Rex Restricted' });
    const d3 = await h.createDevice(t3.user);
    const send = (lat, lng) => request(app).post(`/api/devices/${d3.device.deviceId}/telemetry`).set(d3.headers).send({ lat, lng }).expect(200);
    await send(29.5, 29.5); await send(30, 30);
    await eventually(async () => (await list(admin)).notifications.some((n) => n.type === 'geofence_violation' && /Rex Restricted/.test(n.title)), { message: 'admin zone notification' });
    assert.equal(await models.SOSEvent.countDocuments({ tourist: t3.user._id }), 0);
    const mine = await eventually(async () => { const b = await list(t3); return b.notifications.find((n) => n.type === 'geofence_violation'); }, { message: 'tourist zone notification' });
    assert.equal(mine.severity, 'warning');
  });

  test('read state: mark one, mark all, unread filter, and the count stays correct', async () => {
    const before = await list(admin);
    assert.ok(before.unreadCount >= 2);
    const first = before.notifications[0];
    await request(app).patch(`/api/notifications/${first._id}/read`).set(auth(admin.token)).expect(200);
    const afterOne = await list(admin);
    assert.equal(afterOne.unreadCount, before.unreadCount - 1);
    assert.ok(afterOne.notifications.find((n) => n._id === first._id).read);
    const unread = await list(admin, '?unread=1');
    assert.ok(unread.notifications.every((n) => n.read === false));
    await request(app).post('/api/notifications/read-all').set(auth(admin.token)).expect(200);
    assert.equal((await list(admin)).unreadCount, 0);
    // the other admin's state is independent
    assert.ok((await list(admin2)).unreadCount >= 1);
  });

  test('users can only read/modify their own notifications', async () => {
    const mineOfAdmin2 = (await list(admin2)).notifications[0];
    await request(app).patch(`/api/notifications/${mineOfAdmin2._id}/read`).set(auth(admin.token)).expect(404);
    await request(app).patch(`/api/notifications/${mineOfAdmin2._id}/read`).set(auth(other.token)).expect(404);
    assert.equal((await models.Notification.findById(mineOfAdmin2._id)).read, false);
    const otherList = await list(other);
    assert.ok(otherList.notifications.every((n) => String(n.recipient) === String(other.user._id)));
    await request(app).get('/api/notifications').expect(401);
    await request(app).patch('/api/notifications/not-an-id/read').set(auth(admin.token)).expect(400);
    await request(app).get('/api/notifications?limit=9999').set(auth(admin.token)).expect(400);
  });

  test('a safety check-in prompt notifies the tourist (model hook; scheduler untouched)', async () => {
    const t4 = await h.createUser('tourist');
    await request(app).post('/api/safety-checks/trigger').set(auth(admin.token)).send({ tourist: String(t4.user._id) }).expect(201);
    const n = await eventually(async () => (await list(t4)).notifications.find((x) => x.type === 'safety_check_prompt'), { message: 'check-in notification' });
    assert.equal(n.link, '/tourist/checks');
  });

  test('notifications from simulated tourists are labelled as such', async () => {
    const demo = await h.createUser('tourist', { name: 'Demo Dan', isDemo: true });
    const dd = await h.createDevice(demo.user, { isDemo: true });
    await triggerSos({ tourist: demo.user._id, device: dd.device._id, location: { lat: 2, lng: 2 }, source: 'app' });
    const n = await eventually(async () => (await list(admin)).notifications.find((x) => /Demo Dan/.test(x.title)), { message: 'demo notification' });
    assert.match(n.title, /^\[Simulated\]/);
    assert.equal(n.isDemo, true);
  });

  test('SMS is never reported as sent when it was not (no Twilio keys → no SMS rows)', async () => {
    assert.equal(await models.Notification.countDocuments({ channel: 'sms' }), 0);
  });
});
