const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { setIo } = require('../src/services/realtime');
const { recordRun } = require('../src/services/health/jobStatus');
const { getHealthDetails } = require('../src/services/health/healthChecks');

const { request, app, models, auth } = h;

describe('responder collaboration', () => {
  let admin; let resp1; let resp2; let tourist; let incident;
  const emitted = [];

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin', { name: 'Collab Admin' });
    resp1 = await h.createUser('responder', { name: 'Resp One' });
    resp2 = await h.createUser('responder', { name: 'Resp Two' });
    tourist = await h.createUser('tourist', { name: 'Collab Tourist' });
    await h.createDevice(tourist.user, { lastLocation: { lat: 5, lng: 6 }, lastSeen: new Date() });
    incident = await models.Incident.create({ tourist: tourist.user._id, type: 'other', severity: 'high', timeline: [{ actorLabel: 'system', action: 'Created' }] });
    // Fake Socket.IO that records (room, event) so we can check WHO is told.
    setIo({ to: (room) => ({ emit: (event) => emitted.push({ room, event }) }) });
  });
  after(async () => { setIo(null); await h.disconnect(); });

  const id = () => String(incident._id);
  const patch = (path, body, token = admin.token) => request(app).patch(`/api/incidents/${id()}/${path}`).set(auth(token)).send(body);

  test('stale screens are refused: expectedStatus must match the current status', async () => {
    const r = await patch('status', { status: 'in_progress', expectedStatus: 'in_progress' }).expect(409);
    assert.match(r.body.message, /changed by someone else/);
    assert.equal((await models.Incident.findById(id())).status, 'open'); // nothing moved
    await patch('status', { status: 'in_progress', expectedStatus: 'open' }).expect(200);
    // a duplicate click carrying the same (now stale) expectation is refused, not applied twice
    await patch('status', { status: 'in_progress', expectedStatus: 'open' }).expect(409);
  });

  test('assignment and reassignment are listed chronologically in the handover summary', async () => {
    await patch('assign', { assignee: String(resp1.user._id) }).expect(200);
    await patch('assign', { assignee: String(resp2.user._id), note: 'Shift change' }).expect(200);
    const r = await request(app).get(`/api/incidents/${id()}/handover`).set(auth(admin.token)).expect(200);
    const hv = r.body.handover;
    assert.deepEqual(hv.assignments.map((a) => a.assignee), ['Resp One', 'Resp Two']);
    assert.ok(new Date(hv.assignments[0].at) <= new Date(hv.assignments[1].at));
    assert.equal(hv.currentAssignee.name, 'Resp Two');
    assert.equal(hv.lastKnownLocation.lat, 5);
    assert.equal(hv.incident.status, 'assigned');
  });

  test('handover respects roles: only the assigned responder (or an admin) may read it', async () => {
    await request(app).get(`/api/incidents/${id()}/handover`).set(auth(resp2.token)).expect(200);
    await request(app).get(`/api/incidents/${id()}/handover`).set(auth(resp1.token)).expect(403); // previous holder
    await request(app).get(`/api/incidents/${id()}/handover`).set(auth(tourist.token)).expect(403);
    await request(app).get(`/api/incidents/${id()}/handover`).expect(401);
  });

  test('a note keeps earlier timeline entries and reaches the assignee live, not just admins', async () => {
    const before = (await models.Incident.findById(id())).timeline.length;
    emitted.length = 0;
    await request(app).post(`/api/incidents/${id()}/notes`).set(auth(admin.token)).send({ note: 'Tourist has a medical condition' }).expect(201);
    const after = await models.Incident.findById(id());
    assert.equal(after.timeline.length, before + 1);
    assert.equal(after.timeline[0].action, 'Created'); // original entry untouched
    assert.ok(emitted.some((e) => e.room === `user:${resp2.user._id}` && e.event === 'incident:updated'), 'assignee notified');
    assert.ok(emitted.some((e) => e.room === 'admin'));
    assert.ok(!emitted.some((e) => e.room === `user:${resp1.user._id}`), 'previous holder is not notified');
    // and the responder's note is visible to admins in the handover
    await request(app).post(`/api/incidents/${id()}/notes`).set(auth(resp2.token)).send({ note: 'On site' }).expect(201);
    const hv = (await request(app).get(`/api/incidents/${id()}/handover`).set(auth(admin.token)).expect(200)).body.handover;
    assert.deepEqual(hv.recentNotes.map((n) => n.note), ['Tourist has a medical condition', 'On site']);
  });

  test('responders still cannot touch incidents that are not theirs (server-side)', async () => {
    await request(app).post(`/api/incidents/${id()}/notes`).set(auth(resp1.token)).send({ note: 'x' }).expect(403);
  });
});

describe('system health', () => {
  let admin; let tourist;
  before(async () => {
    await h.connect();
    admin = await h.createUser('admin', { name: 'Health Admin' });
    tourist = await h.createUser('tourist', { name: 'Health Tourist' });
  });
  after(h.disconnect);

  test('details are admin-only; the public probe stays public and minimal', async () => {
    await request(app).get('/api/health/details').expect(401);
    await request(app).get('/api/health/details').set(auth(tourist.token)).expect(403);
    const pub = await request(app).get('/api/health').expect(200);
    assert.equal(pub.body.components, undefined);
  });

  test('reports real component states, a checked-at time, and leaks no secrets', async () => {
    const r = await request(app).get('/api/health/details').set(auth(admin.token)).expect(200);
    const { components } = r.body;
    assert.equal(components.database.status, 'healthy');
    assert.ok(Number.isFinite(components.database.latencyMs));
    assert.ok(!Number.isNaN(Date.parse(r.body.checkedAt)));
    for (const name of ['api', 'database', 'realtime', 'sms', 'devices', 'scheduler']) {
      assert.ok(['healthy', 'degraded', 'unavailable', 'unknown'].includes(components[name].status), name);
    }
    // nothing verifiable about the socket server in the test process → "unknown", never a fake "healthy"
    assert.equal(components.realtime.status, 'unknown');
    const text = JSON.stringify(r.body);
    for (const secret of [process.env.JWT_SECRET, process.env.TWILIO_AUTH_TOKEN, process.env.TWILIO_ACCOUNT_SID, process.env.MONGODB_URI].filter(Boolean)) {
      assert.ok(!text.includes(secret));
    }
  });

  test('device freshness comes from real last-seen times', async () => {
    const t2 = await h.createUser('tourist');
    await h.createDevice(tourist.user, { lastSeen: new Date() });
    await h.createDevice(t2.user, { lastSeen: new Date(Date.now() - 3 * 60 * 60 * 1000) });
    const d = (await getHealthDetails({ force: true })).components.devices;
    assert.equal(d.live, 1);
    assert.equal(d.offline, 1);
    assert.equal(d.status, 'healthy');
  });

  test('scheduler: a failed sweep is shown as degraded with its error; a good one as healthy', async () => {
    recordRun('safetyCheckScheduler', { ok: false, error: 'boom', durationMs: 5, expectedEveryMs: 60000 });
    let s = (await getHealthDetails({ force: true }));
    assert.equal(s.components.scheduler.status, 'degraded');
    assert.ok(s.recentFailures.some((f) => f.component === 'scheduler' && f.message === 'boom'));
    assert.equal(s.overall, 'degraded');
    recordRun('safetyCheckScheduler', { ok: true, durationMs: 4, expectedEveryMs: 60000 });
    s = await getHealthDetails({ force: true });
    assert.equal(s.components.scheduler.status, 'healthy');
  });

  test('SMS is never reported as delivered — only as accepted by the provider', async () => {
    const env = require('../src/config/env');
    const old = { ...env.twilio };
    Object.assign(env.twilio, { accountSid: 'ACxxxxxxxx', authToken: 'tok', from: '+10000000000' });
    try {
      await models.Notification.create({ recipient: tourist.user._id, channel: 'sms', type: 'sos_alert', severity: 'critical', delivered: true, deliveredAt: new Date(), payload: {}, dedupeKey: 'sms:t:1' });
      await models.Notification.create({ recipient: tourist.user._id, channel: 'sms', type: 'sos_alert', severity: 'critical', delivered: false, error: 'SMS provider timed out', payload: {}, dedupeKey: 'sms:t:2' });
      const sms = (await getHealthDetails({ force: true })).components.sms;
      assert.equal(sms.status, 'degraded');
      assert.deepEqual(sms.last24h, { attempts: 2, acceptedByProvider: 1, failed: 1 });
      assert.ok(!/deliver/i.test(sms.message));
      assert.ok(!JSON.stringify(sms).includes('tok"'));
    } finally {
      Object.assign(env.twilio, old);
    }
  });
});
