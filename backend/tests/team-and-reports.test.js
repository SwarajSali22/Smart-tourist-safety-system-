const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { request, app, models, auth } = h;
const { haversineKm } = require('../src/services/geo/haversine');
const { isOverdue } = require('../src/services/incidents/lifecycle');
const thresholds = require('../src/config/thresholds');

describe('responders, overdue, tourist detail, analytics ranges, CSV, help centers', () => {
  let admin; let responder; let responder2; let tourist; let incident;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin', { name: 'Ada' });
    responder = await h.createUser('responder', { name: 'Ravi Responder' });
    responder2 = await h.createUser('responder', { name: 'Rhea Responder' });
    tourist = await h.createUser('tourist', { name: 'Tara =cmd|calc' }); // formula-looking name to test CSV safety
    incident = await models.Incident.create({ tourist: tourist.user._id, type: 'other', severity: 'high', status: 'open', timeline: [{ action: 'seed' }] });
  });
  after(h.disconnect);

  const patch = (id, body, token) => request(app).patch(`/api/incidents/${id}/status`).set(auth(token)).send(body);

  describe('responder role + assignment', () => {
    test('admin can list assignable people and create a responder account', async () => {
      const r = await request(app).get('/api/users/assignable').set(auth(admin.token)).expect(200);
      const roles = r.body.users.map((u) => u.role);
      assert.ok(roles.includes('admin') && roles.includes('responder'));
      assert.ok(!r.body.users.some((u) => u.role === 'tourist'));
      const created = await request(app).post('/api/users/responders').set(auth(admin.token)).send({ name: 'New Resp', email: 'newresp@example.test', password: 'long-enough-1' }).expect(201);
      assert.equal(created.body.user.role, 'responder');
      await request(app).post('/api/users/responders').set(auth(admin.token)).send({ name: 'Dup', email: 'newresp@example.test', password: 'long-enough-1' }).expect(409);
      await request(app).post('/api/users/responders').set(auth(admin.token)).send({ name: 'x', email: 'bad', password: 'short' }).expect(400);
      await request(app).get('/api/users/assignable').set(auth(responder.token)).expect(403);
      await request(app).post('/api/users/responders').set(auth(tourist.token)).send({}).expect(403);
    });

    test('a responder sees nothing until an incident is assigned to them', async () => {
      const r = await request(app).get('/api/incidents').set(auth(responder.token)).expect(200);
      assert.equal(r.body.total, 0);
      await request(app).get(`/api/incidents/${incident._id}`).set(auth(responder.token)).expect(403);
      await patch(incident._id, { status: 'en_route' }, responder.token).expect(403);
    });

    test('admin acknowledges and assigns to a responder; the responder is notified with a /responder deep link', async () => {
      await patch(incident._id, { status: 'in_progress' }, admin.token).expect(200);
      const r = await patch(incident._id, { status: 'assigned', assignee: String(responder.user._id) }, admin.token).expect(200);
      assert.equal(r.body.incident.assignedAdmin.role, 'responder');
      const n = await h.eventually(() => models.Notification.findOne({ recipient: responder.user._id, title: /assigned to you/ }), { message: 'assignee notification' });
      assert.equal(n.link, `/responder/incidents/${incident._id}`);
    });

    test('the assigned responder sees only their incident and may only mark En route / Resolved', async () => {
      const list = await request(app).get('/api/incidents').set(auth(responder.token)).expect(200);
      assert.equal(list.body.total, 1);
      const detail = await request(app).get(`/api/incidents/${incident._id}`).set(auth(responder.token)).expect(200);
      assert.deepEqual(detail.body.allowedNext, ['en_route', 'resolved']);
      await request(app).get('/api/incidents').set(auth(responder2.token)).expect(200).expect((x) => assert.equal(x.body.total, 0));
      await request(app).get(`/api/incidents/${incident._id}`).set(auth(responder2.token)).expect(403);
      await patch(incident._id, { status: 'en_route' }, responder2.token).expect(403);       // someone else's
      await patch(incident._id, { status: 'closed' }, responder.token).expect(403);           // admin-only move
      await patch(incident._id, { status: 'assigned', assignee: String(responder2.user._id) }, responder.token).expect(403);
      await patch(incident._id, { status: 'en_route' }, responder.token).expect(200);
      await request(app).post(`/api/incidents/${incident._id}/notes`).set(auth(responder.token)).send({ note: 'On my way' }).expect(201);
      await request(app).post(`/api/incidents/${incident._id}/notes`).set(auth(responder2.token)).send({ note: 'x' }).expect(403);
      await patch(incident._id, { status: 'resolved', note: 'Handled' }, responder.token).expect(200);
      await patch(incident._id, { status: 'closed' }, admin.token).expect(200);
    });

    test('responders cannot reach admin-only data', async () => {
      for (const p of ['/api/tourists', '/api/devices', '/api/blockchain', '/api/analytics/overview', '/api/risk', '/api/sos']) {
        await request(app).get(p).set(auth(responder.token)).expect(403);
      }
      await request(app).get('/api/incidents/export.csv').set(auth(responder.token)).expect(403);
    });
  });

  describe('overdue (thresholds.js is the single source)', () => {
    test('isOverdue honours the configured limit per state and ignores finished incidents', () => {
      const now = Date.now();
      const stale = (status, minAgo) => ({ status, timeline: [{ at: new Date(now - minAgo * 60000) }] });
      assert.equal(isOverdue(stale('open', thresholds.incidentOverdueMs.open / 60000 + 1), now), true);
      assert.equal(isOverdue(stale('open', 0.1), now), false);
      assert.equal(isOverdue(stale('in_progress', 5), now), false);
      assert.equal(isOverdue(stale('in_progress', 11), now), true);
      assert.equal(isOverdue(stale('resolved', 9999), now), false);
      assert.equal(isOverdue(stale('closed', 9999), now), false);
    });

    test('the list and detail APIs expose the flag', async () => {
      const t2 = await h.createUser('tourist');
      const old = await models.Incident.create({ tourist: t2.user._id, type: 'sos', severity: 'critical', status: 'open', timeline: [{ action: 'seed', at: new Date(Date.now() - 60 * 60000) }] });
      const fresh = await models.Incident.create({ tourist: t2.user._id, type: 'sos', severity: 'critical', status: 'open', sourceKey: 'fresh-test', timeline: [{ action: 'seed' }] });
      const list = await request(app).get(`/api/incidents?tourist=${t2.user._id}`).set(auth(admin.token)).expect(200);
      assert.equal(list.body.incidents.find((i) => String(i._id) === String(old._id)).overdue, true);
      assert.equal(list.body.incidents.find((i) => String(i._id) === String(fresh._id)).overdue, false);
      const d = await request(app).get(`/api/incidents/${old._id}`).set(auth(admin.token)).expect(200);
      assert.equal(d.body.overdue, true);
    });
  });

  describe('tourist detail', () => {
    test('admin gets the full picture; tourists and responders are refused', async () => {
      const dev = await h.createDevice(tourist.user);
      await request(app).post(`/api/devices/${dev.device.deviceId}/telemetry`).set(dev.headers).send({ lat: 1, lng: 1, battery: 40 }).expect(200);
      const r = await request(app).get(`/api/tourists/${tourist.user._id}`).set(auth(admin.token)).expect(200);
      assert.equal(r.body.tourist.name, 'Tara =cmd|calc');
      assert.equal(r.body.tourist.passwordHash, undefined);
      assert.equal(r.body.device.apiKeyHash, undefined);
      assert.ok(Array.isArray(r.body.incidents) && r.body.incidents.length >= 1);
      assert.equal(typeof r.body.activeIncidents, 'number');
      assert.ok(r.body.profile && Array.isArray(r.body.profile.emergencyContacts));
      await request(app).get(`/api/tourists/${tourist.user._id}`).set(auth(tourist.token)).expect(403);
      await request(app).get(`/api/tourists/${tourist.user._id}`).set(auth(responder.token)).expect(403);
      await request(app).get(`/api/tourists/${admin.user._id}`).set(auth(admin.token)).expect(404); // not a tourist
      await request(app).get('/api/tourists/xyz').set(auth(admin.token)).expect(400);
      await request(app).get('/api/tourists/me').set(auth(tourist.token)).expect(200); // /me still works
    });
  });

  describe('analytics: date range, response times, check-in rate, by zone', () => {
    before(async () => {
      const t = await h.createUser('tourist');
      const d = await h.createDevice(t.user);
      const mk = (offsetMin, ackMin, resMin) => models.SOSEvent.create({
        tourist: t.user._id, device: d.device._id, location: { lat: 5, lng: 5 }, source: 'app', status: 'resolved',
        createdAt: new Date('2026-03-10T10:00:00Z'),
        acknowledgedAt: ackMin == null ? null : new Date(Date.parse('2026-03-10T10:00:00Z') + ackMin * 60000),
        resolvedAt: resMin == null ? null : new Date(Date.parse('2026-03-10T10:00:00Z') + resMin * 60000),
      }).then((s) => { void offsetMin; return s; });
      await mk(0, 2, 20); await mk(0, 4, 40); await mk(0, 6, 60); await mk(0, 8, 80); await mk(0, 10, null);
      await models.Incident.create({ tourist: t.user._id, type: 'sos', severity: 'critical', status: 'closed', sourceKey: 'an-1', createdAt: new Date('2026-03-10T10:00:00Z'), timeline: [{ action: 'x' }] });
      await models.Incident.create({ tourist: t.user._id, type: 'other', severity: 'low', status: 'open', sourceKey: 'an-2', createdAt: new Date('2026-03-12T10:00:00Z'), timeline: [{ action: 'x', at: new Date('2026-03-12T10:00:00Z') }] });
      const mkCheck = (iso, response, responded) => models.SafetyCheck.create({ tourist: t.user._id, scheduledAt: new Date(iso), response, respondedAt: responded ? new Date(iso) : null });
      await mkCheck('2026-03-10T09:00:00Z', 'safe', true); await mkCheck('2026-03-10T09:30:00Z', 'unsafe', true);
      await mkCheck('2026-03-10T10:00:00Z', 'no_response', false); await mkCheck('2026-03-10T10:30:00Z', 'safe', true);
      const z = await h.createZone('restricted', 7, 7);
      await models.GeofenceEvent.create({ tourist: t.user._id, zone: z._id, eventType: 'enter', location: { lat: 7, lng: 7 }, createdAt: new Date('2026-03-11T08:00:00Z') });
      await models.GeofenceEvent.create({ tourist: t.user._id, zone: z._id, eventType: 'enter', location: { lat: 7, lng: 7 }, createdAt: new Date('2026-03-11T09:00:00Z') });
    });

    const get = (q) => request(app).get(`/api/analytics/overview?${q}`).set(auth(admin.token)).expect(200).then((r) => r.body);

    test('range is honoured: daily buckets cover exactly from..to, zero-filled', async () => {
      const b = await get('from=2026-03-09&to=2026-03-13');
      assert.equal(b.range.days, 5);
      assert.deepEqual(b.incidentsByDay.map((d) => d.date), ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13']);
      const total = b.incidentsByDay.reduce((s, d) => s + d.count, 0);
      assert.equal(total, 2);
      assert.equal(b.incidents.total, 2);
      const narrow = await get('from=2026-03-11&to=2026-03-13');
      assert.equal(narrow.incidents.total, 1);
      const none = await get('from=2025-01-01&to=2025-01-05');
      assert.equal(none.incidents.total, 0);
      assert.equal(none.responseTimes.acknowledge.n, 0);
      assert.equal(none.responseTimes.acknowledge.avgMin, null);
    });

    test('response times: average, median and p90 for acknowledge and resolve', async () => {
      const b = await get('from=2026-03-10&to=2026-03-10');
      const ack = b.responseTimes.acknowledge;
      assert.equal(ack.n, 5);
      assert.equal(ack.avgMin, 6);          // (2+4+6+8+10)/5
      assert.equal(ack.medianMin, 6);
      assert.equal(ack.p90Min, 10);
      const res = b.responseTimes.resolve;
      assert.equal(res.n, 4);
      assert.equal(res.avgMin, 50);         // (20+40+60+80)/4
      assert.equal(b.avgAckMinutes, 6);     // legacy field kept
    });

    test('check-in response rate and outcome counts', async () => {
      const b = await get('from=2026-03-10&to=2026-03-10');
      assert.deepEqual({ total: b.checkIns.total, answered: b.checkIns.answered, safe: b.checkIns.safe, unsafe: b.checkIns.unsafe, unanswered: b.checkIns.unanswered }, { total: 4, answered: 3, safe: 2, unsafe: 1, unanswered: 1 });
      assert.equal(b.checkIns.responseRate, 75);
    });

    test('by-zone entries are counted within the range only', async () => {
      const inRange = await get('from=2026-03-11&to=2026-03-11');
      assert.equal(inRange.byZone.find((z) => z.type === 'restricted').entries, 2);
      const outside = await get('from=2026-03-01&to=2026-03-05');
      assert.equal(outside.byZone.length, 0);
    });

    test('ranges are capped at 92 days and bad dates fall back to the default window', async () => {
      const big = await get('from=2020-01-01&to=2026-03-13');
      assert.equal(big.range.days, 92);
      const garbage = await get('from=not-a-date&to=also-bad');
      assert.equal(garbage.range.days, 14);
    });
  });

  describe('CSV export', () => {
    test('exports exactly the filtered rows, with CSV-injection neutralised and a BOM for Excel', async () => {
      const evil = await h.createUser('tourist', { name: '=HYPERLINK("http://evil.example","click")' });
      await models.Incident.create({ tourist: evil.user._id, type: 'other', severity: 'low', sourceKey: 'csv-evil', timeline: [{ action: 'x' }], resolution: '+cmd|calc' });
      const ev = await request(app).get(`/api/incidents/export.csv?tourist=${evil.user._id}`).set(auth(admin.token)).expect(200);
      const evLine = ev.text.trim().split('\r\n')[1];
      assert.ok(!evLine.split(',')[1].startsWith('=') && !evLine.includes(',=HYPERLINK'), 'a leading = must not survive as a formula');
      assert.ok(evLine.includes("'=HYPERLINK") && evLine.includes("'+cmd|calc"), evLine);
      const r = await request(app).get(`/api/incidents/export.csv?tourist=${tourist.user._id}&sort=createdAt&order=asc`).set(auth(admin.token)).expect(200);
      assert.match(r.headers['content-type'], /text\/csv/);
      assert.match(r.headers['content-disposition'], /attachment/);
      const text = r.text;
      assert.ok(text.startsWith('﻿id,tourist,'), 'header row after BOM');
      const lines = text.trim().split('\r\n');
      assert.equal(lines.length, 2); // header + the single closed incident for that tourist
      assert.ok(lines[1].includes('Tara =cmd|calc'), 'an ordinary name with = inside is untouched');
      const filtered = await request(app).get('/api/incidents/export.csv?severity=critical&tourist=' + tourist.user._id).set(auth(admin.token)).expect(200);
      assert.equal(filtered.text.trim().split('\r\n').length, 1, 'no critical incidents for this tourist → header only');
      await request(app).get('/api/incidents/export.csv?status=bogus').set(auth(admin.token)).expect(400);
      await request(app).get('/api/incidents/export.csv').set(auth(tourist.token)).expect(403);
    });
  });

  describe('help centers (no seed data) + haversine nearest', () => {
    test('haversine distances are right', () => {
      // Delhi → Mumbai ≈ 1148 km; same point = 0; antipodes ≈ half the Earth's circumference
      const delhi = { lat: 28.6139, lng: 77.209 }; const mumbai = { lat: 19.076, lng: 72.8777 };
      assert.ok(Math.abs(haversineKm(delhi, mumbai) - 1148) < 6);
      assert.equal(haversineKm(delhi, delhi), 0);
      assert.ok(Math.abs(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }) - 20015) < 5);
      assert.ok(Math.abs(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111.19) < 0.1);
    });

    test('nothing is pre-seeded: a tourist asking for nearby help gets an honest empty list', async () => {
      assert.equal(await models.HelpCenter.countDocuments(), 0);
      const r = await request(app).get('/api/help-centers/nearby?lat=28.61&lng=77.2').set(auth(tourist.token)).expect(200);
      assert.deepEqual(r.body.helpCenters, []);
      assert.equal(r.body.total, 0);
    });

    test('admins add real help centers; tourists see the nearest first with distances', async () => {
      const add = (body) => request(app).post('/api/help-centers').set(auth(admin.token)).send(body).expect(201);
      await add({ name: 'Far Hospital', type: 'hospital', phone: '+91 11 5555 0001', location: { lat: 28.70, lng: 77.30 } });
      await add({ name: 'Near Police', type: 'police', phone: '100', location: { lat: 28.615, lng: 77.21 } });
      await add({ name: 'Mid Pharmacy', type: 'pharmacy', location: { lat: 28.64, lng: 77.23 } });
      const hidden = await add({ name: 'Closed Clinic', type: 'hospital', location: { lat: 28.6139, lng: 77.2091 } });
      await request(app).patch(`/api/help-centers/${hidden.body.helpCenter._id}`).set(auth(admin.token)).send({ isActive: false }).expect(200);

      const r = await request(app).get('/api/help-centers/nearby?lat=28.6139&lng=77.209&limit=3').set(auth(tourist.token)).expect(200);
      assert.deepEqual(r.body.helpCenters.map((x) => x.name), ['Near Police', 'Mid Pharmacy', 'Far Hospital']);
      const ds = r.body.helpCenters.map((x) => x.distanceKm);
      assert.deepEqual(ds, [...ds].sort((a, b) => a - b));
      assert.ok(ds[0] < 0.5 && ds[0] > 0.05, `distance ${ds[0]}`);
      assert.ok(!r.body.helpCenters.some((x) => x.name === 'Closed Clinic'), 'inactive centres are hidden from tourists');

      const typed = await request(app).get('/api/help-centers/nearby?lat=28.6139&lng=77.209&type=hospital').set(auth(tourist.token)).expect(200);
      assert.deepEqual(typed.body.helpCenters.map((x) => x.name), ['Far Hospital']);
      const limited = await request(app).get('/api/help-centers/nearby?lat=28.6139&lng=77.209&maxKm=1').set(auth(tourist.token)).expect(200);
      assert.deepEqual(limited.body.helpCenters.map((x) => x.name), ['Near Police']);
      const adminList = await request(app).get('/api/help-centers').set(auth(admin.token)).expect(200);
      assert.ok(adminList.body.helpCenters.some((x) => x.name === 'Closed Clinic'), 'admins still see inactive ones');
      const touristList = await request(app).get('/api/help-centers').set(auth(tourist.token)).expect(200);
      assert.ok(!touristList.body.helpCenters.some((x) => x.name === 'Closed Clinic'));
    });

    test('only admins can change help centers; input is validated', async () => {
      await request(app).post('/api/help-centers').set(auth(tourist.token)).send({ name: 'x', location: { lat: 1, lng: 1 } }).expect(403);
      await request(app).post('/api/help-centers').set(auth(admin.token)).send({ name: 'x', location: { lat: 99, lng: 1 } }).expect(400);
      await request(app).post('/api/help-centers').set(auth(admin.token)).send({ name: '', location: { lat: 1, lng: 1 } }).expect(400);
      await request(app).post('/api/help-centers').set(auth(admin.token)).send({ name: 'x', type: 'spaceport', location: { lat: 1, lng: 1 } }).expect(400);
      await request(app).get('/api/help-centers/nearby?lat=abc&lng=1').set(auth(tourist.token)).expect(400);
      await request(app).get('/api/help-centers/nearby?lat=1&lng=1').expect(401);
      await request(app).delete('/api/help-centers/507f1f77bcf86cd799439011').set(auth(admin.token)).expect(404);
      await request(app).delete('/api/help-centers/xyz').set(auth(admin.token)).expect(400);
    });
  });
});
