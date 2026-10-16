const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { request, app, models, auth } = h;

describe('incident lifecycle', () => {
  let admin; let admin2; let tourist; let other; let device;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin', { name: 'Ada Admin' });
    admin2 = await h.createUser('admin', { name: 'Bo Admin' });
    tourist = await h.createUser('tourist', { name: 'Tess Tourist' });
    other = await h.createUser('tourist', { name: 'Otto Other' });
    device = await h.createDevice(tourist.user);
    await h.createZone('danger', 10, 10);
  });
  after(h.disconnect);

  /** Gets the tourist into the danger zone through the real telemetry API → auto-SOS + incident. */
  async function triggerAutoSos(t = tourist, d = device) {
    await request(app).post(`/api/devices/${d.device.deviceId}/telemetry`).set(d.headers).send({ lat: 9.5, lng: 9.5, battery: 80 }).expect(200);
    await request(app).post(`/api/devices/${d.device.deviceId}/telemetry`).set(d.headers).send({ lat: 10, lng: 10, battery: 80 }).expect(200);
    const sos = await h.eventually(() => models.SOSEvent.findOne({ tourist: t.user._id, status: { $in: ['active', 'acknowledged'] } }), { message: 'auto-SOS' });
    const incident = await models.Incident.findById(sos.incident);
    return { sos, incident };
  }

  const setStatus = (id, body, token = admin.token) => request(app).patch(`/api/incidents/${id}/status`).set(auth(token)).send(body);

  test('danger-zone telemetry creates exactly one SOS + one incident (New)', async () => {
    const { sos, incident } = await triggerAutoSos();
    assert.equal(sos.source, 'auto_geofence');
    assert.equal(incident.status, 'open');
    assert.equal(incident.type, 'sos');
    assert.equal(await models.Incident.countDocuments({ tourist: tourist.user._id, type: 'sos' }), 1);
    assert.equal(incident.sourceKey, `SOSEvent:${sos._id}`);
  });

  test('walks the full lifecycle New → Acknowledged → Assigned → En route → Resolved → Closed', async () => {
    const incident = await models.Incident.findOne({ tourist: tourist.user._id, type: 'sos' });
    const id = String(incident._id);

    let r = await setStatus(id, { status: 'in_progress' }).expect(200);
    assert.equal(r.body.incident.status, 'in_progress');
    assert.equal((await models.SOSEvent.findById(incident.sourceRef.refId)).status, 'acknowledged');

    r = await setStatus(id, { status: 'assigned', assignee: String(admin2.user._id) }).expect(200);
    assert.equal(String(r.body.incident.assignedAdmin._id), String(admin2.user._id));

    await setStatus(id, { status: 'en_route' }).expect(200);
    r = await setStatus(id, { status: 'resolved', note: 'Tourist found safe' }).expect(200);
    assert.equal(r.body.incident.resolution, 'Tourist found safe');
    assert.ok(r.body.incident.resolvedAt);

    // resolving the SOS clears the emergency flag and frees the tourist to raise a new SOS
    const sosDoc = await models.SOSEvent.findById(incident.sourceRef.refId);
    assert.equal(sosDoc.status, 'resolved');
    assert.equal(sosDoc.activeKey, undefined);
    const dev = await models.Device.findById(device.device._id);
    assert.equal(dev.emergencyMode, false);

    r = await setStatus(id, { status: 'closed' }).expect(200);
    assert.equal(r.body.incident.status, 'closed');

    // activity history records every step with from/to
    const final = await models.Incident.findById(id).lean();
    const moves = final.timeline.filter((t) => t.metadata?.to).map((t) => `${t.metadata.from}>${t.metadata.to}`);
    assert.deepEqual(moves, ['open>in_progress', 'in_progress>assigned', 'assigned>en_route', 'en_route>resolved', 'resolved>closed']);
    assert.ok(final.timeline.every((t) => t.at && t.actorLabel));
  });

  test('invalid transitions are rejected server-side with 409', async () => {
    const { incident } = await triggerAutoSos();
    const id = String(incident._id);

    let r = await setStatus(id, { status: 'en_route' }).expect(409); // New → En route is not allowed
    assert.match(r.body.message, /Cannot move an incident from New to En route/);
    r = await setStatus(id, { status: 'closed' }).expect(409);
    r = await setStatus(id, { status: 'assigned' }).expect(409); // must acknowledge first

    await setStatus(id, { status: 'resolved' }).expect(200);   // resolve straight from New is allowed
    r = await setStatus(id, { status: 'in_progress' }).expect(409); // cannot go backwards
    assert.match(r.body.message, /Resolved to Acknowledged/);
    await setStatus(id, { status: 'closed' }).expect(200);
    r = await setStatus(id, { status: 'resolved' }).expect(409); // closed is final
    assert.equal((await models.Incident.findById(id)).status, 'closed');
  });

  test('same-status requests are idempotent; unknown statuses are 400 (zod)', async () => {
    const { incident } = await triggerAutoSos();
    const id = String(incident._id);
    await setStatus(id, { status: 'in_progress' }).expect(200);
    const again = await setStatus(id, { status: 'in_progress' }).expect(200);
    assert.equal(again.body.changed, false);
    const bad = await setStatus(id, { status: 'teleported' }).expect(400);
    assert.equal(bad.body.success, false);
    await setStatus('not-an-id', { status: 'in_progress' }).expect(400);
    await setStatus(id, { status: 'resolved' }).expect(200);
    await setStatus(id, { status: 'closed' }).expect(200);
  });

  test('concurrent conflicting moves: exactly one wins, state is consistent', async () => {
    const { incident } = await triggerAutoSos();
    const id = String(incident._id);
    const [a, b] = await Promise.all([
      setStatus(id, { status: 'in_progress' }, admin.token),
      setStatus(id, { status: 'resolved' }, admin2.token),
    ]);
    assert.ok([a.status, b.status].every((s) => [200, 409].includes(s)));
    const doc = await models.Incident.findById(id);
    assert.ok(['in_progress', 'resolved'].includes(doc.status));
    // history has no duplicate/contradictory entries for a single move
    const moves = doc.timeline.filter((t) => t.metadata?.to);
    assert.ok(moves.length >= 1 && moves.length <= 2);
    await setStatus(id, { status: 'resolved' }); await setStatus(id, { status: 'closed' });
  });

  test('assignment needs an active admin/responder', async () => {
    const { incident } = await triggerAutoSos();
    const id = String(incident._id);
    await setStatus(id, { status: 'in_progress' }).expect(200);
    const bad = await setStatus(id, { status: 'assigned', assignee: String(other.user._id) }).expect(400); // a tourist
    assert.match(bad.body.message, /admin or responder/);
    const ok = await setStatus(id, { status: 'assigned' }).expect(200); // defaults to the caller
    assert.equal(String(ok.body.incident.assignedAdmin._id), String(admin.user._id));
    await setStatus(id, { status: 'resolved' }); await setStatus(id, { status: 'closed' });
  });

  test('legacy /acknowledge and /resolve map onto the lifecycle', async () => {
    const { incident } = await triggerAutoSos();
    const id = String(incident._id);
    await request(app).patch(`/api/incidents/${id}/acknowledge`).set(auth(admin.token)).expect(200);
    assert.equal((await models.Incident.findById(id)).status, 'in_progress');
    await request(app).patch(`/api/incidents/${id}/resolve`).set(auth(admin.token)).send({ resolution: 'done' }).expect(200);
    const doc = await models.Incident.findById(id);
    assert.equal(doc.status, 'resolved');
    assert.equal(doc.resolution, 'done');
    await setStatus(id, { status: 'closed' });
  });

  test('notes are added to the activity history without changing status', async () => {
    const { incident } = await triggerAutoSos();
    const id = String(incident._id);
    await request(app).post(`/api/incidents/${id}/notes`).set(auth(admin.token)).send({ note: 'Called the hotel' }).expect(201);
    await request(app).post(`/api/incidents/${id}/notes`).set(auth(admin.token)).send({ note: '' }).expect(400);
    const doc = await models.Incident.findById(id);
    assert.equal(doc.status, 'open');
    assert.ok(doc.timeline.some((t) => t.action === 'Note' && t.metadata.note === 'Called the hotel'));
    await setStatus(id, { status: 'resolved' }); await setStatus(id, { status: 'closed' });
  });

  test('access control: tourists cannot list, transition or read others’ incidents', async () => {
    const { incident } = await triggerAutoSos();
    const id = String(incident._id);
    await request(app).get('/api/incidents').set(auth(tourist.token)).expect(403);
    await request(app).get('/api/incidents').expect(401);
    await setStatus(id, { status: 'in_progress' }, tourist.token).expect(403);
    await request(app).get(`/api/incidents/${id}`).set(auth(other.token)).expect(403);
    const own = await request(app).get(`/api/incidents/${id}`).set(auth(tourist.token)).expect(200);
    assert.equal(own.body.incident.timeline, undefined, 'tourists must not see internal activity history');
    const adm = await request(app).get(`/api/incidents/${id}`).set(auth(admin.token)).expect(200);
    assert.ok(Array.isArray(adm.body.allowedNext));
    assert.ok(adm.body.sms && typeof adm.body.sms.configured === 'boolean', 'SMS status must be reported honestly');
    assert.equal(adm.body.sms.sent, 0, 'no SMS was sent in tests');
    await setStatus(id, { status: 'resolved' }); await setStatus(id, { status: 'closed' });
  });

  describe('server-side search / filter / sort / pagination', () => {
    before(async () => {
      const mk = (over) => models.Incident.create({ tourist: other.user._id, type: 'other', severity: 'low', status: 'open', timeline: [{ action: 'seed' }], ...over });
      await mk({ severity: 'low', createdAt: new Date('2026-01-01') });
      await mk({ severity: 'critical', type: 'risk_escalation', createdAt: new Date('2026-01-02') });
      await mk({ severity: 'medium', status: 'resolved', createdAt: new Date('2026-01-03') });
      await mk({ severity: 'high', status: 'closed', createdAt: new Date('2026-01-04') });
    });

    test('pagination returns page slices with totals', async () => {
      const first = await request(app).get('/api/incidents?limit=3&page=1').set(auth(admin.token)).expect(200);
      assert.equal(first.body.incidents.length, 3);
      assert.ok(first.body.total >= 4);
      assert.equal(first.body.pages, Math.ceil(first.body.total / 3));
      const second = await request(app).get('/api/incidents?limit=3&page=2').set(auth(admin.token)).expect(200);
      const ids = new Set([...first.body.incidents, ...second.body.incidents].map((i) => i._id));
      assert.equal(ids.size, first.body.incidents.length + second.body.incidents.length, 'pages must not overlap');
    });

    test('filters: status list, active=1, severity, type, tourist', async () => {
      const get = (q) => request(app).get(`/api/incidents?${q}`).set(auth(admin.token)).expect(200).then((r) => r.body);
      let b = await get(`tourist=${other.user._id}&status=resolved,closed`);
      assert.ok(b.incidents.length === 2 && b.incidents.every((i) => ['resolved', 'closed'].includes(i.status)));
      b = await get(`tourist=${other.user._id}&active=1`);
      assert.ok(b.incidents.length === 2 && b.incidents.every((i) => i.status === 'open'));
      b = await get(`tourist=${other.user._id}&severity=critical`);
      assert.equal(b.total, 1);
      b = await get(`tourist=${other.user._id}&type=risk_escalation`);
      assert.equal(b.total, 1);
    });

    test('sort by severity ranks critical > high > medium > low (not alphabetically)', async () => {
      const r = await request(app).get(`/api/incidents?tourist=${other.user._id}&sort=severity&order=desc`).set(auth(admin.token)).expect(200);
      assert.deepEqual(r.body.incidents.map((i) => i.severity), ['critical', 'high', 'medium', 'low']);
      const asc = await request(app).get(`/api/incidents?tourist=${other.user._id}&sort=severity&order=asc`).set(auth(admin.token)).expect(200);
      assert.deepEqual(asc.body.incidents.map((i) => i.severity), ['low', 'medium', 'high', 'critical']);
      const byDate = await request(app).get(`/api/incidents?tourist=${other.user._id}&sort=createdAt&order=asc`).set(auth(admin.token)).expect(200);
      assert.deepEqual(byDate.body.incidents.map((i) => i.severity), ['low', 'critical', 'medium', 'high']);
    });

    test('search matches tourist name / email / type', async () => {
      const get = (q) => request(app).get(`/api/incidents?q=${encodeURIComponent(q)}`).set(auth(admin.token)).expect(200).then((r) => r.body);
      assert.ok((await get('Otto')).incidents.every((i) => i.tourist.name === 'Otto Other'));
      assert.ok((await get('otto')).total >= 4, 'case-insensitive');
      assert.ok((await get('risk_escalation')).incidents.some((i) => i.type === 'risk_escalation'));
      assert.equal((await get('zzz-no-such-person')).total, 0);
      assert.equal((await get('.*')).total, 0, 'regex characters are escaped, not interpreted');
    });

    test('bad query parameters are rejected with the standard error shape', async () => {
      for (const q of ['status=bogus', 'limit=1000', 'page=0', 'sort=password', 'tourist=xyz']) {
        const r = await request(app).get(`/api/incidents?${q}`).set(auth(admin.token)).expect(400);
        assert.equal(r.body.success, false);
        assert.equal(typeof r.body.message, 'string');
      }
    });
  });
});
