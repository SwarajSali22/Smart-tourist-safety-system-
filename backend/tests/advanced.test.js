const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { sweep } = require('../src/jobs/safetyCheckScheduler');
const { assessRoute } = require('../src/services/routing/routeRisk');
const { verifyProof } = require('../src/services/blockchain/auditChain');

const { request, app, models, auth } = h;
const MIN = 60 * 1000;

describe('incident management extensions', () => {
  let admin; let responder; let responder2; let tourist; let incident;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    responder = await h.createUser('responder');
    responder2 = await h.createUser('responder');
    tourist = await h.createUser('tourist');
    incident = await models.Incident.create({ tourist: tourist.user._id, type: 'other', severity: 'high', status: 'open', timeline: [{ action: 'created', actorLabel: 'system' }] });
  });
  after(h.disconnect);

  test('priority defaults from severity and can be changed with a timeline entry', async () => {
    assert.equal(incident.priority, 'high');
    const res = await request(app).patch(`/api/incidents/${incident._id}/priority`).set(auth(admin.token)).send({ priority: 'low' }).expect(200);
    assert.equal(res.body.incident.priority, 'low');
    await request(app).patch(`/api/incidents/${incident._id}/priority`).set(auth(admin.token)).send({ priority: 'bogus' }).expect(400);
    await request(app).patch(`/api/incidents/${incident._id}/priority`).set(auth(responder.token)).send({ priority: 'low' }).expect(403);
  });

  test('assign then reassign keeps the status, the original creation time and a verifiable assignment proof', async () => {
    const created = incident.createdAt.toISOString();
    await request(app).patch(`/api/incidents/${incident._id}/status`).set(auth(admin.token)).send({ status: 'in_progress' }).expect(200);
    await request(app).patch(`/api/incidents/${incident._id}/assign`).set(auth(admin.token)).send({ assignee: String(responder.user._id) }).expect(200);
    const proof = await models.AuditProof.findOne({ eventType: 'incident_assigned', eventRef: incident._id });
    assert.equal((await verifyProof(proof._id)).status, 'verified');

    const re = await request(app).patch(`/api/incidents/${incident._id}/assign`).set(auth(admin.token)).send({ assignee: String(responder2.user._id) }).expect(200);
    assert.equal(re.body.reassigned, true);
    assert.equal(re.body.incident.status, 'assigned');
    assert.equal(String(re.body.incident.assignedAdmin._id), String(responder2.user._id));
    assert.equal(re.body.incident.createdAt, created);
    assert.equal((await verifyProof(proof._id)).status, 'verified', 'original assignment proof still verifies after reassignment');
    await request(app).patch(`/api/incidents/${incident._id}/assign`).set(auth(admin.token)).send({ assignee: String(responder2.user._id) }).expect(409);
  });

  test('evidence accepts safe links and text only; the first responder can no longer see it after reassignment', async () => {
    await request(app).post(`/api/incidents/${incident._id}/evidence`).set(auth(admin.token)).send({ kind: 'link', title: 'CCTV', value: 'javascript:alert(1)' }).expect(400);
    const ok = await request(app).post(`/api/incidents/${incident._id}/evidence`).set(auth(admin.token)).send({ kind: 'link', title: 'CCTV', value: 'https://example.com/clip' }).expect(201);
    assert.equal(ok.body.incident.evidence.length, 1);
    await request(app).get(`/api/incidents/${incident._id}`).set(auth(responder.token)).expect(403);
    const detail = await request(app).get(`/api/incidents/${incident._id}`).set(auth(responder2.token)).expect(200);
    assert.ok(detail.body.metrics.responseMinutes != null);
  });

  test('an unacknowledged high-priority incident escalates once; a resolved one never does', async () => {
    const t2 = await h.createUser('tourist');
    const old = new Date(Date.now() - 30 * MIN);
    const stale = await models.Incident.create({ tourist: t2.user._id, type: 'other', severity: 'critical', status: 'open', createdAt: old, timeline: [] });
    const done = await models.Incident.create({ tourist: t2.user._id, type: 'other', severity: 'critical', status: 'resolved', createdAt: old, timeline: [] });
    await sweep(null); await sweep(null);
    const after1 = await models.Incident.findById(stale._id);
    assert.ok(after1.escalatedAt);
    assert.equal(after1.timeline.filter((t) => t.action === 'Escalated').length, 1);
    assert.equal(after1.createdAt.toISOString(), old.toISOString());
    assert.equal((await models.Incident.findById(done._id)).escalatedAt, null);
    const proof = await models.AuditProof.findOne({ eventType: 'incident_escalated', eventRef: stale._id });
    assert.equal((await verifyProof(proof._id)).status, 'verified');
    const list = await request(app).get('/api/incidents?escalated=1').set(auth(admin.token)).expect(200);
    assert.ok(list.body.incidents.some((i) => String(i._id) === String(stale._id)));
  });

  test('administrator actions are written to the activity log; denied access and failed sign-ins too', async () => {
    await request(app).get('/api/analytics/report').set(auth(tourist.token)).expect(403);
    await request(app).post('/api/auth/login').send({ email: admin.user.email, password: 'wrong-password-1' }).expect(401);
    const log = await request(app).get('/api/audit/activity?limit=100').set(auth(admin.token)).expect(200);
    const actions = log.body.activity.map((a) => `${a.action}:${a.outcome}`);
    assert.ok(actions.includes('incident.assigned:success'));
    assert.ok(actions.includes('incident.reassign:success'));
    assert.ok(actions.includes('authz.denied:denied'));
    assert.ok(actions.includes('auth.login:failure'));
    assert.ok(!JSON.stringify(log.body).match(/wrong-password|passwordHash/));
    await request(app).get('/api/audit/activity').set(auth(tourist.token)).expect(403);
  });
});

describe('trips: planning, monitoring and false-alarm safeguards', () => {
  let tourist; let other; let admin; let device; let trip;
  const iso = (offMin) => new Date(Date.now() + offMin * MIN).toISOString();

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    tourist = await h.createUser('tourist');
    other = await h.createUser('tourist');
    device = await h.createDevice(tourist.user, { lastLocation: { lat: 10, lng: 10 }, lastSeen: new Date() });
  });
  after(h.disconnect);

  test('a tourist creates a trip with stops; validation rejects bad input; others cannot see it', async () => {
    await request(app).post('/api/trips').set(auth(tourist.token)).send({ name: 'x', destination: 'y', startAt: iso(-60), endAt: iso(-120), stops: [{ name: 's', lat: 1, lng: 1, expectedArrival: iso(10) }] }).expect(400);
    await request(app).post('/api/trips').set(auth(tourist.token)).send({ name: 'x', destination: 'y', startAt: iso(-60), endAt: iso(120), stops: [] }).expect(400);
    const res = await request(app).post('/api/trips').set(auth(tourist.token)).send({
      name: 'Old town walk', destination: 'Old town', startAt: iso(-60), endAt: iso(240), checkInEveryMin: 30,
      stops: [
        { name: 'Fort', lat: 10, lng: 10, expectedArrival: iso(-45) },
        { name: 'Market', lat: 10.05, lng: 10.05, expectedArrival: iso(-30) },
      ],
    }).expect(201);
    trip = res.body.trip;
    await request(app).get(`/api/trips/${trip._id}`).set(auth(other.token)).expect(404);
    await request(app).get(`/api/trips/${trip._id}`).set(auth(admin.token)).expect(403);
    const mine = await request(app).get('/api/trips').set(auth(other.token)).expect(200);
    assert.equal(mine.body.trips.length, 0);
    const all = await request(app).get('/api/trips?active=1').set(auth(admin.token)).expect(200);
    assert.equal(all.body.trips.length, 0, 'planned trip is not active until it starts');
  });

  test('monitor: GPS confirms the first stop, alerts once for the overdue second stop, raises no SOS', async () => {
    await request(app).patch(`/api/trips/${trip._id}/start`).set(auth(tourist.token)).expect(200);
    await sweep(null); await sweep(null);
    const t = await models.Trip.findById(trip._id);
    assert.equal(t.stops[0].status, 'arrived');
    assert.equal(t.stops[0].arrivedVia, 'gps');
    assert.equal(t.stops[1].status, 'pending');
    assert.ok(t.stops[1].overdueAlertedAt);
    assert.equal(t.alerts.filter((a) => a.kind === 'stop_overdue').length, 1, 'de-duplicated');
    assert.equal(await models.SOSEvent.countDocuments({ tourist: tourist.user._id }), 0);
    const notes = await models.Notification.find({ recipient: tourist.user._id, title: 'Trip reminder' });
    assert.equal(notes.length, 1);
  });

  test('missed check-in warns once without SOS; confirming a check-in resets it', async () => {
    await models.Trip.updateOne({ _id: trip._id }, { nextCheckInDue: new Date(Date.now() - 20 * MIN) });
    await sweep(null); await sweep(null);
    let t = await models.Trip.findById(trip._id);
    assert.equal(t.alerts.filter((a) => a.kind === 'checkin_missed').length, 1);
    assert.equal(await models.SOSEvent.countDocuments({ tourist: tourist.user._id }), 0);
    const res = await request(app).post(`/api/trips/${trip._id}/check-in`).set(auth(tourist.token)).expect(200);
    assert.equal(res.body.trip.checkInAlertedAt, null);
    assert.ok(new Date(res.body.trip.nextCheckInDue) > new Date());
    t = await models.Trip.findById(trip._id);
    assert.ok(t.alerts.filter((a) => a.kind === 'checkin_missed').every((a) => a.acknowledged));
  });

  test('deviation from the planned route warns once, and clears when back on route', async () => {
    await models.Device.updateOne({ _id: device.device._id }, { lastLocation: { lat: 10.6, lng: 10.0 }, lastSeen: new Date() });
    await sweep(null); await sweep(null);
    let t = await models.Trip.findById(trip._id);
    assert.equal(t.alerts.filter((a) => a.kind === 'deviation').length, 1);
    assert.match(t.alerts.find((a) => a.kind === 'deviation').message, /simulated/);
    await models.Device.updateOne({ _id: device.device._id }, { lastLocation: { lat: 10.02, lng: 10.02 }, lastSeen: new Date() });
    await sweep(null);
    t = await models.Trip.findById(trip._id);
    assert.equal(t.deviationAlertedAt, null);
  });

  test('manual arrival, acknowledging warnings and cancelling work; a stale position never triggers deviation', async () => {
    const stopId = (await models.Trip.findById(trip._id)).stops[1]._id;
    const r = await request(app).post(`/api/trips/${trip._id}/stops/${stopId}/arrive`).set(auth(tourist.token)).expect(200);
    assert.equal(r.body.trip.stops[1].arrivedVia, 'manual');
    await request(app).post(`/api/trips/${trip._id}/stops/${stopId}/arrive`).set(auth(other.token)).expect(404);
    const ack = await request(app).post(`/api/trips/${trip._id}/acknowledge`).set(auth(tourist.token)).expect(200);
    assert.ok(ack.body.trip.alerts.every((a) => a.acknowledged));
    await models.Device.updateOne({ _id: device.device._id }, { lastLocation: { lat: 40, lng: 40 }, lastSeen: new Date(Date.now() - 2 * 3600 * 1000) });
    await sweep(null);
    assert.equal((await models.Trip.findById(trip._id)).deviationAlertedAt, null);
    const c = await request(app).patch(`/api/trips/${trip._id}/cancel`).set(auth(tourist.token)).expect(200);
    assert.equal(c.body.trip.status, 'cancelled');
  });
});

describe('route risk, analytics report and idempotency', () => {
  let admin; let tourist;
  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    tourist = await h.createUser('tourist');
    await h.createZone('danger', 10, 10, 0.01, { riskLevel: 90 });
  });
  after(h.disconnect);

  const osrm = (routes) => async () => ({ ok: true, json: async () => ({ code: 'Ok', routes: routes.map((coords) => ({ geometry: { coordinates: coords }, distance: 2000, duration: 300 })) }) });

  test('prefers the alternative that avoids the configured zone and never calls a route safe', async () => {
    const through = [[9.9, 10], [10, 10], [10.1, 10]];
    const around = [[9.9, 10], [9.9, 10.1], [10.1, 10.1]];
    const out = await assessRoute({ lat: 10, lng: 9.9 }, { lat: 10, lng: 10.1 }, { fetchImpl: osrm([through, around]) });
    assert.equal(out.source, 'routing_service');
    assert.ok(out.routes[0].zones.length >= 1);
    assert.equal(out.routes[1].zones.length, 0);
    assert.equal(out.recommendedIndex, 1);
    assert.doesNotMatch(out.message, /\bis safe\b/i);
    assert.match(out.disclaimer, /not.*guaranteed safe/i);
  });

  test('falls back to a labelled straight line when routing is unavailable', async () => {
    const out = await assessRoute({ lat: 10, lng: 9.9 }, { lat: 10, lng: 10.1 }, { fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(out.source, 'straight_line');
    assert.match(out.note, /unavailable/);
    assert.ok(out.routes[0].zones.length >= 1);
  });

  test('route-risk endpoint validates input and requires sign-in', async () => {
    await request(app).post('/api/route-risk').send({}).expect(401);
    await request(app).post('/api/route-risk').set(auth(tourist.token)).send({ from: { lat: 1, lng: 1 }, to: { lat: 1, lng: 1 } }).expect(400);
  });

  test('report: presets, filters, comparison, drill-down data, CSV and PDF', async () => {
    const a = await models.Incident.create({ tourist: tourist.user._id, type: 'sos', severity: 'critical', status: 'resolved', resolvedAt: new Date(), timeline: [{ at: new Date(Date.now() + 2 * MIN), action: 'x', metadata: { to: 'in_progress' } }] });
    await models.Incident.create({ tourist: tourist.user._id, type: 'other', severity: 'low', status: 'open', timeline: [] });
    await models.Incident.create({ tourist: tourist.user._id, type: 'other', severity: 'low', status: 'open', createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000), timeline: [] });

    const r24 = await request(app).get('/api/analytics/report?range=24h').set(auth(admin.token)).expect(200);
    assert.equal(r24.body.summary.totalIncidents, 2);
    assert.equal(r24.body.trend.granularity, 'hour');
    const r7 = await request(app).get('/api/analytics/report?range=7d').set(auth(admin.token)).expect(200);
    assert.equal(r7.body.summary.totalIncidents, 3);
    assert.equal(r7.body.summary.resolvedIncidents, 1);
    assert.equal(r7.body.summary.avgResponseMin, 2);
    assert.equal(r7.body.trend.buckets.reduce((s, b) => s + b.count, 0), 3);
    const sev = await request(app).get('/api/analytics/report?range=7d&severity=critical&type=sos').set(auth(admin.token)).expect(200);
    assert.equal(sev.body.summary.totalIncidents, 1);
    const none = await request(app).get(`/api/analytics/report?range=7d&tourist=${admin.user._id}`).set(auth(admin.token)).expect(200);
    assert.equal(none.body.summary.totalIncidents, 0);
    const day = new Date().toISOString().slice(0, 10);
    const custom = await request(app).get(`/api/analytics/report?from=${day}&to=${day}`).set(auth(admin.token)).expect(200);
    assert.equal(custom.body.range.preset, 'custom');
    assert.equal(custom.body.summary.totalIncidents, 2);
    await request(app).get('/api/analytics/report?severity=nope').set(auth(admin.token)).expect(400);

    const csv = await request(app).get('/api/analytics/report.csv?range=7d&severity=critical').set(auth(admin.token)).expect(200);
    assert.match(csv.text, /critical/);
    assert.equal(csv.text.trim().split(/\r?\n/).length, 2);
    assert.ok(csv.text.includes(String(a._id)));

    const pdf = await request(app).get('/api/analytics/report.pdf?range=7d').set(auth(admin.token)).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.length > 2000);
    await request(app).get('/api/analytics/report.pdf').set(auth(tourist.token)).expect(403);
  });

  test('a replayed request with the same Idempotency-Key is answered once and applied once', async () => {
    const t = await h.createUser('tourist');
    await h.createDevice(t.user, { lastLocation: { lat: 1, lng: 1 }, lastSeen: new Date() });
    const key = 'evt_0123456789abcdef';
    const first = await request(app).post('/api/sos').set(auth(t.token)).set('Idempotency-Key', key).send({}).expect(201);
    const again = await request(app).post('/api/sos').set(auth(t.token)).set('Idempotency-Key', key).send({}).expect(201);
    assert.equal(again.headers['idempotent-replay'], 'true');
    assert.equal(again.body.sosEvent._id, first.body.sosEvent._id);
    assert.equal(await models.SOSEvent.countDocuments({ tourist: t.user._id }), 1);
    await request(app).post('/api/sos').set(auth(t.token)).set('Idempotency-Key', 'bad key!').send({}).expect(400);
    // an SOS held offline records when the button was pressed but never overrides the server's own time
    const t2 = await h.createUser('tourist');
    await h.createDevice(t2.user, { lastLocation: { lat: 1, lng: 1 }, lastSeen: new Date() });
    const pressed = new Date(Date.now() - 10 * MIN).toISOString();
    const q = await request(app).post('/api/sos').set(auth(t2.token)).send({ clientTriggeredAt: pressed }).expect(201);
    assert.equal(new Date(q.body.sosEvent.clientTriggeredAt).toISOString(), pressed);
    assert.ok(Date.now() - new Date(q.body.sosEvent.createdAt).getTime() < 60000);
  });

  test('risk assessment explains every factor and exposes its method honestly', async () => {
    const t = await h.createUser('tourist');
    await h.createDevice(t.user, { lastLocation: { lat: 10.005, lng: 10.0 }, lastSeen: new Date(), currentZones: [] });
    const { evaluateRisk } = require('../src/services/riskAssessment/evaluateRisk');
    const { riskAssessment } = await evaluateRisk(t.user._id, null, { force: true });
    assert.equal(riskAssessment.method, 'rule-based-hybrid');
    assert.equal(riskAssessment.explanation.length, 6);
    assert.equal(riskAssessment.explanation.reduce((s, e) => s + e.points, 0), riskAssessment.score);
    const near = riskAssessment.explanation.find((e) => e.key === 'zoneRiskScore');
    assert.ok(near.points > 0 || /inside|Within/.test(near.detail));
    const cfg = await request(app).get('/api/risk/config').set(auth(admin.token)).expect(200);
    assert.match(cfg.body.description, /No trained machine-learning model/);
  });
});
