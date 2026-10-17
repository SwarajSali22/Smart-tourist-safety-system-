const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { request, app, models, auth, env } = h;

describe('login portals, responder management, place search (mocked provider)', () => {
  let admin; let tourist; let responder;
  const realFetch = global.fetch;
  let calls; let respond;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    tourist = await h.createUser('tourist');
    responder = await h.createUser('responder', { phone: '+91 90000 00001' });
  });
  after(async () => {
    global.fetch = realFetch;
    env.geocode.userAgent = '';
    await h.disconnect();
  });
  beforeEach(() => {
    calls = [];
    env.geocode.userAgent = 'sts-test/1.0';
    respond = async () => ({ ok: true, status: 200, json: async () => [] });
    global.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return respond(url, opts); };
  });

  const login = (u, portal) => request(app).post('/api/auth/login').send({ email: u.user.email, password: u.password, portal });

  test('staff portal accepts admins and responders but refuses tourists before issuing tokens', async () => {
    assert.equal((await login(admin, 'staff')).status, 200);
    assert.equal((await login(responder, 'staff')).status, 200);
    const r = await login(tourist, 'staff');
    assert.equal(r.status, 403);
    assert.equal(r.body.accessToken, undefined);
  });

  test('tourist portal refuses staff accounts; no portal keeps the old behaviour', async () => {
    assert.equal((await login(tourist, 'tourist')).status, 200);
    assert.equal((await login(admin, 'tourist')).status, 403);
    assert.equal((await login(admin)).status, 200);
    const bad = await request(app).post('/api/auth/login').send({ email: admin.user.email, password: 'wrong-password', portal: 'staff' });
    assert.equal(bad.status, 401);
  });

  test('public registration can never create an administrator', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'Eve', email: `eve${Date.now()}@example.test`, password: 'Password-123', role: 'admin' });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.role, 'tourist');
  });

  test('team list can include deactivated accounts and phone numbers', async () => {
    const r = await request(app).get('/api/users/assignable?all=1').set(auth(admin.token)).expect(200);
    const mine = r.body.users.find((u) => u._id === String(responder.user._id));
    assert.equal(mine.phone, '+91 90000 00001');
    assert.equal(mine.isActive, true);
  });

  test('admins can edit and deactivate responders, never admins; deactivated responders cannot sign in', async () => {
    await request(app).patch(`/api/users/${responder.user._id}`).set(auth(admin.token)).send({ name: 'Renamed', phone: '+91 91111 11111' }).expect(200);
    assert.equal((await models.User.findById(responder.user._id)).name, 'Renamed');
    await request(app).patch(`/api/users/${admin.user._id}`).set(auth(admin.token)).send({ isActive: false }).expect(403);
    await request(app).patch(`/api/users/${responder.user._id}`).set(auth(tourist.token)).send({ isActive: false }).expect(403);
    await request(app).patch(`/api/users/${responder.user._id}`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    assert.equal((await login(responder, 'staff')).status, 401);
    await request(app).patch(`/api/users/${responder.user._id}`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    assert.equal((await login(responder, 'staff')).status, 200);
  });

  test('a responder with active incidents cannot be deactivated', async () => {
    await models.Incident.create({ tourist: tourist.user._id, type: 'sos', severity: 'critical', status: 'assigned', assignedAdmin: responder.user._id, timeline: [] });
    const r = await request(app).patch(`/api/users/${responder.user._id}`).set(auth(admin.token)).send({ isActive: false });
    assert.equal(r.status, 409);
    await models.Incident.deleteMany({});
  });

  test('place search is admin-only, validated, and proxies a category-aware query with a User-Agent', async () => {
    await request(app).get('/api/geocode/search?q=apollo&type=hospital').set(auth(tourist.token)).expect(403);
    await request(app).get('/api/geocode/search?q=a').set(auth(admin.token)).expect(400);
    respond = async () => ({
      ok: true, status: 200,
      json: async () => [
        { place_id: 1, name: 'Apollo Hospital', display_name: 'Apollo Hospital, Delhi, India', lat: '28.54', lon: '77.28', category: 'amenity', type: 'hospital', extratags: { phone: '+91 11 2692 5858' } },
        { place_id: 2, name: 'Apollo Pharmacy', display_name: 'Apollo Pharmacy, Delhi', lat: '28.5', lon: '77.2', category: 'amenity', type: 'pharmacy', extratags: {} },
      ],
    });
    const r = await request(app).get('/api/geocode/search?q=apollo&type=hospital').set(auth(admin.token)).expect(200);
    assert.equal(r.body.results.length, 1, 'other categories are filtered out when real matches exist');
    assert.deepEqual(
      { name: r.body.results[0].name, lat: r.body.results[0].lat, lng: r.body.results[0].lng, phone: r.body.results[0].phone, type: r.body.results[0].suggestedType },
      { name: 'Apollo Hospital', lat: 28.54, lng: 77.28, phone: '+91 11 2692 5858', type: 'hospital' },
    );
    assert.match(calls[0].url, /q=apollo\+hospital/);
    assert.equal(calls[0].opts.headers['User-Agent'], 'sts-test/1.0');
  });

  test('reverse geocoding keeps the typed coordinates and suggests a category', async () => {
    respond = async () => ({
      ok: true, status: 200,
      json: async () => ({ place_id: 9, name: 'City Police Station', display_name: 'City Police Station, Pune', lat: '18.5201', lon: '73.8567', category: 'amenity', type: 'police', extratags: {} }),
    });
    const r = await request(app).get('/api/geocode/reverse?lat=18.52&lng=73.85').set(auth(admin.token)).expect(200);
    assert.equal(r.body.result.lat, 18.52);
    assert.equal(r.body.result.lng, 73.85);
    assert.equal(r.body.result.suggestedType, 'police');
    await request(app).get('/api/geocode/reverse?lat=91&lng=0').set(auth(admin.token)).expect(400);
  });

  test('provider failures and a missing User-Agent are reported cleanly', async () => {
    respond = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const f = await request(app).get('/api/geocode/search?q=failing+place').set(auth(admin.token));
    assert.equal(f.status, 502);
    assert.match(f.body.message, /provider/);
    respond = async () => { const e = new Error('x'); e.name = 'TimeoutError'; throw e; };
    assert.match((await request(app).get('/api/geocode/search?q=slow+place').set(auth(admin.token))).body.message, /timed out/);
    env.geocode.userAgent = '';
    const n = await request(app).get('/api/geocode/search?q=unconfigured').set(auth(admin.token));
    assert.equal(n.status, 503);
    assert.equal((await request(app).get('/api/geocode/status').set(auth(admin.token))).body.configured, false);
  });

  test('help centers accept the new Emergency Service category', async () => {
    const r = await request(app).post('/api/help-centers').set(auth(admin.token))
      .send({ name: 'Ambulance Hub', type: 'emergency', location: { lat: 12.9, lng: 77.6 } }).expect(201);
    assert.equal(r.body.helpCenter.type, 'emergency');
  });
});
