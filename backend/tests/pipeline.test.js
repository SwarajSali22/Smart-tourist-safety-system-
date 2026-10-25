const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { request, app, models, auth, eventually } = h;

describe('telemetry → geofence → auto-SOS → risk pipeline', () => {
  let admin; let tourist; let device; let restricted; let safe;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    tourist = await h.createUser('tourist');
    device = await h.createDevice(tourist.user);
    await h.createZone('danger', 10, 10);
    restricted = await h.createZone('restricted', 20, 20);
    safe = await h.createZone('safe', 30, 30);
  });
  after(h.disconnect);

  const send = (d, body) => request(app).post(`/api/devices/${d.device.deviceId}/telemetry`).set(d.headers).send(body);

  test('device authentication: missing / wrong key / wrong device are 401, a phone device has no key', async () => {
    await request(app).post(`/api/devices/${device.device.deviceId}/telemetry`).send({ lat: 1, lng: 1 }).expect(401);
    await request(app).post(`/api/devices/${device.device.deviceId}/telemetry`).set({ 'X-Device-Id': device.device.deviceId, 'X-Api-Key': 'nope' }).send({ lat: 1, lng: 1 }).expect(401);
    await request(app).post('/api/devices/UNKNOWN/telemetry').set({ 'X-Device-Id': 'UNKNOWN', 'X-Api-Key': 'x' }).send({ lat: 1, lng: 1 }).expect(401);
    // a key for another device can't be used against this one
    const other = await h.createUser('tourist'); const od = await h.createDevice(other.user);
    await request(app).post(`/api/devices/${device.device.deviceId}/telemetry`).set(od.headers).send({ lat: 1, lng: 1 }).expect(400); // valid key, but for a different device
  });

  test('ordinary movement stores pings and updates the device — no zone, no incident', async () => {
    await send(device, { lat: 5, lng: 5, battery: 77 }).expect(200);
    const dev = await models.Device.findById(device.device._id);
    assert.equal(dev.lastLocation.lat, 5);
    assert.equal(dev.battery, 77);
    assert.equal(dev.status, 'active');
    assert.equal(await models.LocationPing.countDocuments({ device: device.device._id }), 1);
    assert.equal(await models.Incident.countDocuments({ tourist: tourist.user._id }), 0);
    const trail = await request(app).get(`/api/devices/${device.device.deviceId}/trail`).set(auth(admin.token)).expect(200);
    assert.equal(trail.body.trail.length, 1);
  });

  test('a safe zone is logged on enter/exit but raises nothing', async () => {
    await send(device, { lat: 30, lng: 30 }).expect(200);
    await send(device, { lat: 5, lng: 5 }).expect(200);
    const ev = await models.GeofenceEvent.find({ tourist: tourist.user._id, zone: safe._id }).sort({ createdAt: 1 });
    assert.deepEqual(ev.map((e) => e.eventType), ['enter', 'exit']);
    assert.equal(await models.Incident.countDocuments({ tourist: tourist.user._id }), 0);
    assert.equal(await models.AuditProof.countDocuments({ eventModel: 'GeofenceEvent' }), 0, 'safe-zone events are not violations');
  });

  test('a restricted zone is a recorded violation (audit proof) but not an SOS', async () => {
    await send(device, { lat: 20, lng: 20 }).expect(200);
    const ev = await eventually(() => models.GeofenceEvent.findOne({ tourist: tourist.user._id, zone: restricted._id, eventType: 'enter' }), { message: 'geofence event' });
    await eventually(() => models.AuditProof.findOne({ eventType: 'geofence_violation', eventRef: ev._id }), { message: 'violation proof' });
    assert.equal(await models.SOSEvent.countDocuments({ tourist: tourist.user._id }), 0);
    await send(device, { lat: 5, lng: 5 }).expect(200);
  });

  test('entering a danger zone auto-triggers one SOS, an emergency flag, a critical risk score and audit proofs', async () => {
    await send(device, { lat: 10, lng: 10 }).expect(200);
    const sos = await eventually(() => models.SOSEvent.findOne({ tourist: tourist.user._id }), { message: 'auto-SOS' });
    assert.equal(sos.source, 'auto_geofence');
    assert.equal(sos.status, 'active');
    const dev = await models.Device.findById(device.device._id);
    assert.equal(dev.emergencyMode, true);
    assert.equal(dev.status, 'emergency');
    const risk = await models.RiskAssessment.findOne({ tourist: tourist.user._id }).sort({ evaluatedAt: -1 });
    assert.equal(risk.level, 'critical');
    assert.equal(risk.ruleTriggered, true);
    const proofs = (await models.AuditProof.find().lean()).map((p) => p.eventType);
    for (const t of ['sos_triggered', 'incident_opened', 'geofence_violation']) assert.ok(proofs.includes(t), `missing ${t} proof`);

    // staying inside does not raise a second SOS
    await send(device, { lat: 10.001, lng: 10.001 }).expect(200);
    assert.equal(await models.SOSEvent.countDocuments({ tourist: tourist.user._id }), 1);
    assert.equal(await models.Incident.countDocuments({ tourist: tourist.user._id, type: 'sos' }), 1);
  });

  test('acknowledge + resolve through the API clears the emergency (the full simulator loop)', async () => {
    const incident = await models.Incident.findOne({ tourist: tourist.user._id, type: 'sos' });
    await request(app).patch(`/api/incidents/${incident._id}/acknowledge`).set(auth(admin.token)).expect(200);
    await request(app).patch(`/api/incidents/${incident._id}/resolve`).set(auth(admin.token)).send({ resolution: 'ok' }).expect(200);
    const dev = await models.Device.findById(device.device._id);
    assert.equal(dev.emergencyMode, false);
    // a held button after resolution is a NEW emergency, not a duplicate of the old one
    await send(device, { lat: 5, lng: 5, sosPressed: true }).expect(200);
    const second = await eventually(() => models.SOSEvent.findOne({ tourist: tourist.user._id, status: 'active' }), { message: 'button SOS' });
    assert.equal(second.source, 'button');
    await send(device, { lat: 5, lng: 5, sosPressed: true }).expect(200); // held down: still one SOS
    assert.equal(await models.SOSEvent.countDocuments({ tourist: tourist.user._id, status: 'active' }), 1);
  });

  describe('tourist phone GPS (POST /tourists/me/location)', () => {
    test('first report auto-creates a phone device, stores a ping and runs the same geofence/risk services', async () => {
      const t = await h.createUser('tourist');
      const r = await request(app).post('/api/tourists/me/location').set(auth(t.token)).send({ lat: 9.5, lng: 9.5, accuracy: 12 }).expect(200);
      assert.equal(r.body.accepted, true);
      const dev = await models.Device.findOne({ tourist: t.user._id });
      assert.equal(dev.type, 'phone');
      assert.equal(dev.apiKeyHash, null);
      assert.equal(dev.isSimulated, false);
      const ping = await models.LocationPing.findOne({ tourist: t.user._id });
      assert.equal(ping.accuracy, 12);
      // …and it walks into the danger zone: auto-SOS, via the very same pipeline
      await new Promise((res) => setTimeout(res, 3100)); // 1 request / 3 s limit is exercised separately
      await request(app).post('/api/tourists/me/location').set(auth(t.token)).send({ lat: 10, lng: 10 }).expect(200);
      const sos = await eventually(() => models.SOSEvent.findOne({ tourist: t.user._id }), { message: 'phone auto-SOS' });
      assert.equal(sos.source, 'auto_geofence');
      // a phone ping must not clear an emergency that is in progress
      await new Promise((res) => setTimeout(res, 3100));
      await request(app).post('/api/tourists/me/location').set(auth(t.token)).send({ lat: 10, lng: 10 }).expect(200);
      assert.equal((await models.Device.findOne({ tourist: t.user._id })).emergencyMode, true);
    });

    test('a phone device cannot be used with the device-key route', async () => {
      const dev = await models.Device.findOne({ type: 'phone' });
      await request(app).post(`/api/devices/${dev.deviceId}/telemetry`).set({ 'X-Device-Id': dev.deviceId, 'X-Api-Key': 'anything' }).send({ lat: 1, lng: 1 }).expect(401);
    });

    test('a tourist who already has a wristband gets accepted:false and no second device', async () => {
      await request(app).post('/api/tourists/me/location').set(auth(tourist.token)).send({ lat: 1, lng: 1 }).expect(200)
        .expect((r) => { assert.equal(r.body.accepted, false); assert.equal(r.body.reason, 'wristband_assigned'); });
      assert.equal(await models.Device.countDocuments({ tourist: tourist.user._id }), 1);
    });

    test('an admin can replace a phone-tracked tourist phone device only on purpose (replacePhone); a second device is refused', async () => {
      const t = await h.createUser('tourist');
      await request(app).post('/api/tourists/me/location').set(auth(t.token)).send({ lat: 1, lng: 1 }).expect(200);
      // Without confirmation nothing changes: the working phone device and its location survive.
      const refused = await request(app).post('/api/devices').set(auth(admin.token)).send({ tourist: String(t.user._id) }).expect(409);
      assert.equal(refused.body.code, 'phone_device_in_use');
      const still = await models.Device.findOne({ tourist: t.user._id });
      assert.equal(still.type, 'phone');
      assert.equal(still.lastLocation.lat, 1);
      // With explicit confirmation it is replaced, as before.
      const r = await request(app).post('/api/devices').set(auth(admin.token)).send({ tourist: String(t.user._id), replacePhone: true }).expect(201);
      assert.equal(r.body.device.type, 'wristband');
      assert.ok(r.body.apiKey);
      assert.equal(await models.Device.countDocuments({ tourist: t.user._id }), 1);
      await request(app).post('/api/devices').set(auth(admin.token)).send({ tourist: String(t.user._id), replacePhone: true }).expect(409);
      assert.ok(await models.ActivityLog.findOne({ action: 'device.replace_phone' }));
    });

    test('a simulator that never reported blocks phone GPS honestly, can be removed safely, and then the phone is recorded', async () => {
      const t = await h.createUser('tourist');
      const reg = await request(app).post('/api/devices').set(auth(admin.token)).send({ tourist: String(t.user._id) }).expect(201);
      assert.equal(reg.body.device.isSimulated, true);
      assert.equal(reg.body.device.status, 'inactive');
      // The phone report is not recorded, and the answer says why (and that the assigned device never reported).
      const blocked = await request(app).post('/api/tourists/me/location').set(auth(t.token)).send({ lat: 2, lng: 2 }).expect(200);
      assert.equal(blocked.body.accepted, false);
      assert.deepEqual(blocked.body.device, { deviceId: reg.body.device.deviceId, isSimulated: true, hasReported: false });
      assert.equal(await models.LocationPing.countDocuments({ tourist: t.user._id }), 0);
      // SOS cannot invent a location: a clear, actionable error (with the 112 reminder), nothing is created.
      const sos = await request(app).post('/api/sos').set(auth(t.token)).send({}).expect(400);
      assert.equal(sos.body.code, 'no_device_location');
      assert.match(sos.body.message, /simulator/);
      assert.match(sos.body.message, /112/);
      assert.equal(await models.SOSEvent.countDocuments({ tourist: t.user._id }), 0);
      // Only an admin may remove it, and only because it never reported anything.
      await request(app).delete(`/api/devices/${reg.body.device.deviceId}`).set(auth(t.token)).expect(403);
      await request(app).delete(`/api/devices/${reg.body.device.deviceId}`).set(auth(admin.token)).expect(200);
      assert.equal(await models.Device.countDocuments({ tourist: t.user._id }), 0);
      assert.equal((await models.TouristProfile.findOne({ user: t.user._id })).device, null);
      assert.ok(await models.ActivityLog.findOne({ action: 'device.remove_unused' }));
      // Now the phone is recorded against the right tourist and shows as a live phone device.
      await new Promise((res) => setTimeout(res, 3100));
      const ok = await request(app).post('/api/tourists/me/location').set(auth(t.token)).send({ lat: 3, lng: 3, accuracy: 9 }).expect(200);
      assert.equal(ok.body.accepted, true);
      const dev = await models.Device.findOne({ tourist: t.user._id });
      assert.equal(dev.type, 'phone');
      assert.equal(dev.isSimulated, false);
      assert.equal(dev.status, 'active');
      assert.deepEqual({ lat: dev.lastLocation.lat, lng: dev.lastLocation.lng }, { lat: 3, lng: 3 });
      assert.ok(dev.lastSeen);
      // The admin device list returns it with coordinates in lat/lng order, tied to the right tourist.
      const list = await request(app).get('/api/devices').set(auth(admin.token)).expect(200);
      const row = list.body.devices.find((d) => d.deviceId === dev.deviceId);
      assert.equal(row.type, 'phone');
      assert.equal(row.lastLocation.lat, 3);
      assert.equal(row.lastLocation.lng, 3);
      assert.equal(String(row.tourist._id), String(t.user._id));
      // An SOS now has a real location to use.
      await request(app).post('/api/sos').set(auth(t.token)).send({}).expect(201);
      const ev = await models.SOSEvent.findOne({ tourist: t.user._id });
      assert.equal(ev.location.lat, 3);
    });

    test('a device that has reported data can never be removed', async () => {
      const t = await h.createUser('tourist');
      await request(app).post('/api/tourists/me/location').set(auth(t.token)).send({ lat: 4, lng: 4 }).expect(200);
      const phone = await models.Device.findOne({ tourist: t.user._id });
      const r = await request(app).delete(`/api/devices/${phone.deviceId}`).set(auth(admin.token)).expect(409);
      assert.equal(r.body.code, 'device_has_history');
      assert.ok(await models.Device.findById(phone._id));
    });

    test('a phone report is stored against the signed-in tourist only, and other tourists cannot read the device list', async () => {
      const a = await h.createUser('tourist');
      const b = await h.createUser('tourist');
      await request(app).post('/api/tourists/me/location').set(auth(a.token)).send({ lat: 5, lng: 6 }).expect(200);
      await request(app).post('/api/tourists/me/location').set(auth(b.token)).send({ lat: 7, lng: 8 }).expect(200);
      const da = await models.Device.findOne({ tourist: a.user._id });
      const db = await models.Device.findOne({ tourist: b.user._id });
      assert.notEqual(String(da._id), String(db._id));
      assert.deepEqual([da.lastLocation.lat, da.lastLocation.lng], [5, 6]);
      assert.deepEqual([db.lastLocation.lat, db.lastLocation.lng], [7, 8]);
      await request(app).get('/api/devices').set(auth(a.token)).expect(403);
    });
  });

  test('device list never exposes API-key hashes and labels demo/simulated data', async () => {
    const demo = await h.createUser('tourist', { isDemo: true });
    await h.createDevice(demo.user, { isDemo: true });
    const r = await request(app).get('/api/devices').set(auth(admin.token)).expect(200);
    assert.ok(r.body.devices.length >= 3);
    assert.ok(r.body.devices.every((d) => d.apiKeyHash === undefined));
    assert.ok(r.body.devices.some((d) => d.isDemo === true && d.tourist.isDemo === true));
  });
});
