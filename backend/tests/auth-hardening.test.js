const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { request, app, env, models, auth } = h;
const { errorHandler } = require('../src/middleware/errorHandler');

describe('auth, roles and API hardening', () => {
  let admin; let tourist; let locUser; let locUser2;

  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    tourist = await h.createUser('tourist');
    locUser = await h.createUser('tourist');
    locUser2 = await h.createUser('tourist');
  });
  after(h.disconnect);

  describe('registration + login', () => {
    test('registering creates a tourist and never trusts a client-supplied role', async () => {
      const r = await request(app).post('/api/auth/register').send({ name: 'Eve', email: 'Eve@Example.test', password: 'long-enough-1', role: 'admin' }).expect(201);
      assert.equal(r.body.user.role, 'tourist');
      assert.ok(r.body.accessToken && r.body.refreshToken);
      assert.equal(r.body.user.passwordHash, undefined);
      const doc = await models.User.findOne({ email: 'eve@example.test' });
      assert.equal(doc.role, 'tourist');
      assert.notEqual(doc.passwordHash, 'long-enough-1');
      assert.ok(await models.TouristProfile.findOne({ user: doc._id }), 'a tourist profile is created');
    });

    test('invalid input → 400 with the standard { success:false, message } shape', async () => {
      const bad = [
        {},
        { name: 'x', email: 'not-an-email', password: 'long-enough-1' },
        { name: 'x', email: 'a@b.test', password: 'short' },
        { name: '', email: 'a@b.test', password: 'long-enough-1' },
        { name: 'x'.repeat(500), email: 'a@b.test', password: 'long-enough-1' },
      ];
      for (const body of bad) {
        const r = await request(app).post('/api/auth/register').send(body).expect(400);
        assert.equal(r.body.success, false);
        assert.equal(typeof r.body.message, 'string');
        assert.equal(r.body.stack, undefined);
      }
    });

    test('duplicate email → 409; login failures do not reveal whether the email exists', async () => {
      await request(app).post('/api/auth/register').send({ name: 'Dup', email: tourist.user.email, password: 'long-enough-1' }).expect(409);
      const wrongPw = await request(app).post('/api/auth/login').send({ email: tourist.user.email, password: 'wrong-password' }).expect(401);
      const noUser = await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'wrong-password' }).expect(401);
      assert.equal(wrongPw.body.message, noUser.body.message);
      await request(app).post('/api/auth/login').send({ email: 'x' }).expect(400);
    });

    test('deactivated accounts cannot sign in', async () => {
      const u = await h.createUser('tourist');
      await models.User.updateOne({ _id: u.user._id }, { isActive: false });
      await request(app).post('/api/auth/login').send({ email: u.user.email, password: u.password }).expect(401);
    });

    test('refresh: a refresh token works, an access token is not accepted as one', async () => {
      const ok = await request(app).post('/api/auth/refresh').send({ refreshToken: tourist.refreshToken }).expect(200);
      assert.ok(ok.body.accessToken);
      await request(app).post('/api/auth/refresh').send({ refreshToken: tourist.token }).expect(401);
      await request(app).post('/api/auth/refresh').send({}).expect(400);
    });
  });

  describe('role-based access', () => {
    const adminOnly = [
      ['get', '/api/tourists'], ['get', '/api/devices'], ['get', '/api/incidents'], ['get', '/api/blockchain'],
      ['get', '/api/analytics/overview'], ['get', '/api/sos'], ['get', '/api/risk'], ['get', '/api/geofence-events'],
      ['get', '/api/safety-checks'], ['post', '/api/zones'], ['post', '/api/devices'], ['post', '/api/safety-checks/trigger'],
    ];
    const touristOnly = [['post', '/api/sos'], ['get', '/api/sos/mine'], ['get', '/api/safety-checks/mine'], ['get', '/api/risk/mine'], ['post', '/api/tourists/me/location']];

    test('admin-only routes: 401 without a token, 403 for a tourist, never 200', async () => {
      for (const [m, p] of adminOnly) {
        await request(app)[m](p).send({}).expect(401);
        const r = await request(app)[m](p).set(auth(tourist.token)).send({});
        assert.equal(r.status, 403, `${m.toUpperCase()} ${p} as tourist should be 403, got ${r.status}`);
      }
    });

    test('tourist-only routes are closed to admins', async () => {
      for (const [m, p] of touristOnly) {
        const r = await request(app)[m](p).set(auth(admin.token)).send({});
        assert.equal(r.status, 403, `${m.toUpperCase()} ${p} as admin should be 403, got ${r.status}`);
      }
    });

    test('malformed, expired and wrong-secret tokens are 401', async () => {
      const jwt = require('jsonwebtoken');
      const expired = jwt.sign({ sub: String(admin.user._id), role: 'admin' }, process.env.JWT_SECRET, { expiresIn: -5 });
      const forged = jwt.sign({ sub: String(admin.user._id), role: 'admin' }, 'wrong-secret');
      for (const t of ['garbage', expired, forged, tourist.refreshToken]) {
        await request(app).get('/api/incidents').set(auth(t)).expect(401);
      }
      await request(app).get('/api/incidents').set({ Authorization: 'Basic abc' }).expect(401);
    });

    test('a tourist cannot read another tourist’s device or risk history', async () => {
      const other = await h.createUser('tourist');
      const od = await h.createDevice(other.user);
      await request(app).get(`/api/devices/${od.device.deviceId}`).set(auth(tourist.token)).expect(403);
      await request(app).get(`/api/devices/${od.device.deviceId}/trail`).set(auth(tourist.token)).expect(403);
      await request(app).get(`/api/risk/${other.user._id}/history`).set(auth(tourist.token)).expect(403);
    });
  });

  describe('transport hardening', () => {
    test('security headers are set and the framework banner is hidden', async () => {
      const r = await request(app).get('/api/health').expect(200);
      assert.equal(r.headers['x-powered-by'], undefined);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.ok(r.headers['x-frame-options'] || r.headers['content-security-policy']);
      assert.ok(r.headers['strict-transport-security']);
    });

    test('CORS only allows the configured front-end origin', async () => {
      const ok = await request(app).get('/api/health').set('Origin', env.clientOrigin);
      assert.equal(ok.headers['access-control-allow-origin'], env.clientOrigin);
      const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example');
      assert.equal(evil.headers['access-control-allow-origin'], undefined);
      const pre = await request(app).options('/api/incidents').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
      assert.equal(pre.headers['access-control-allow-origin'], undefined);
    });

    test('malformed JSON, oversized bodies and unknown routes give clean JSON errors', async () => {
      const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ').expect(400);
      assert.equal(bad.body.success, false);
      assert.equal(bad.body.message, 'Invalid JSON body');
      const big = await request(app).post('/api/auth/login').send({ email: 'a@b.test', password: 'x'.repeat(200 * 1024) }).expect(413);
      assert.equal(big.body.success, false);
      const nf = await request(app).get('/api/nope').expect(404);
      assert.equal(nf.body.success, false);
    });

    test('production error handler never leaks stack traces or internals on a 500', () => {
      const original = env.nodeEnv;
      env.nodeEnv = 'production';
      const logs = [];
      const origErr = console.error;
      console.error = (...a) => logs.push(a.join(' '));
      try {
        let status; let body;
        const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
        const boom = new Error('connect ECONNREFUSED mongodb://user:secret@host/db');
        errorHandler(boom, { method: 'POST', path: '/api/x' }, res, () => {});
        assert.equal(status, 500);
        assert.deepEqual(body, { success: false, message: 'Internal server error' });
        assert.ok(!JSON.stringify(body).includes('secret'));
        assert.ok(!logs.join('\n').includes('    at '), 'no stack in production logs');
      } finally {
        env.nodeEnv = original;
        console.error = origErr;
      }
    });

    test('mongoose errors map to safe client errors (bad id, duplicate key)', () => {
      const run = (err) => { let status; let body; errorHandler(err, { method: 'GET', path: '/x' }, { status(s) { status = s; return this; }, json(b) { body = b; } }, () => {}); return { status, body }; };
      assert.equal(run({ name: 'CastError', message: 'Cast to ObjectId failed for value "abc" at path "_id"' }).status, 400);
      assert.equal(run({ code: 11000, message: 'E11000 duplicate key { email: "a@b.test" }' }).body.message, 'Already exists');
      assert.equal(run({ name: 'ValidationError', message: 'User validation failed: email: ...' }).body.message, 'Invalid data');
    });
  });

  describe('input validation on write routes (zod)', () => {
    const polygon = (pts) => ({ type: 'Polygon', coordinates: [pts] });
    const cases = [
      ['POST /api/zones — polygon with 2 points', 'post', '/api/zones', 'admin', { name: 'z', type: 'safe', geometry: polygon([[0, 0], [1, 1]]) }],
      ['POST /api/zones — bad type', 'post', '/api/zones', 'admin', { name: 'z', type: 'lava', geometry: polygon([[0, 0], [0, 1], [1, 1]]) }],
      ['POST /api/zones — latitude out of range', 'post', '/api/zones', 'admin', { name: 'z', type: 'safe', geometry: polygon([[0, 95], [0, 1], [1, 1]]) }],
      ['POST /api/zones — risk level 500', 'post', '/api/zones', 'admin', { name: 'z', type: 'safe', riskLevel: 500, geometry: polygon([[0, 0], [0, 1], [1, 1]]) }],
      ['POST /api/devices — bad tourist id', 'post', '/api/devices', 'admin', { tourist: 'abc' }],
      ['POST /api/devices — unsafe device id', 'post', '/api/devices', 'admin', { tourist: '507f1f77bcf86cd799439011', deviceId: '../../etc' }],
      ['PATCH contacts — bad phone', 'patch', '/api/tourists/me/emergency-contacts', 'tourist', { emergencyContacts: [{ name: 'Mum', phone: 'call me' }] }],
      ['PATCH contacts — 11 contacts', 'patch', '/api/tourists/me/emergency-contacts', 'tourist', { emergencyContacts: Array.from({ length: 11 }, () => ({ name: 'a', phone: '+911234567890' })) }],
      ['PATCH itinerary — missing destination', 'patch', '/api/tourists/me/itinerary', 'tourist', { itinerary: [{ arrivalAt: '2026-01-01' }] }],
      ['POST check respond — bad response', 'post', '/api/safety-checks/507f1f77bcf86cd799439011/respond', 'tourist', { response: 'maybe' }],
      ['POST location — lng 500', 'post', '/api/tourists/me/location', 'tourist', { lat: 1, lng: 500 }],
      ['POST trigger check — bad id', 'post', '/api/safety-checks/trigger', 'admin', { tourist: 'nope' }],
      ['PATCH zone — bad id param', 'patch', '/api/zones/xyz', 'admin', { name: 'ok' }],
      ['DELETE zone — bad id param', 'delete', '/api/zones/xyz', 'admin'],
      ['PATCH geofence resolve — bad id', 'patch', '/api/geofence-events/xyz/resolve', 'admin', {}],
      ['PATCH incident status — bad enum', 'patch', '/api/incidents/507f1f77bcf86cd799439011/status', 'admin', { status: 'nope' }],
      ['GET risk history — bad id', 'get', '/api/risk/xyz/history', 'admin'],
    ];
    for (const [name, method, path, role, body] of cases) {
      test(`${name} → 400`, async () => {
        const token = role === 'admin' ? admin.token : tourist.token;
        const r = await request(app)[method](path).set(auth(token)).send(body || {});
        assert.equal(r.status, 400, `${name}: got ${r.status} ${JSON.stringify(r.body)}`);
        assert.equal(r.body.success, false);
        assert.equal(typeof r.body.message, 'string');
      });
    }

    test('telemetry rejects bad coordinates, wrong types and out-of-range battery', async () => {
      const t = await h.createUser('tourist');
      const d = await h.createDevice(t.user);
      for (const body of [{ lat: 'x', lng: 1 }, { lat: 1 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 0, lng: 0, battery: 500 }, { lat: 0, lng: 0, sosPressed: 'yes' }]) {
        const r = await request(app).post(`/api/devices/${d.device.deviceId}/telemetry`).set(d.headers).send(body).expect(400);
        assert.equal(r.body.success, false);
      }
      await request(app).post(`/api/devices/${d.device.deviceId}/telemetry`).set(d.headers).send({ lat: 1, lng: 1, battery: 55 }).expect(200);
    });

    test('valid writes still pass validation (and unknown fields are dropped)', async () => {
      const r = await request(app).post('/api/zones').set(auth(admin.token)).send({ name: 'OK zone', type: 'safe', riskLevel: 10, evil: '<script>', geometry: polygon([[0, 0], [0, 1], [1, 1], [1, 0]]) }).expect(201);
      assert.equal(r.body.zone.evil, undefined);
      await request(app).patch('/api/tourists/me/emergency-contacts').set(auth(tourist.token)).send({ emergencyContacts: [{ name: 'Mum', phone: '+91 98765 43210' }] }).expect(200);
    });
  });

  describe('rate limiting (switched on for these tests)', () => {
    before(() => { env.rateLimitEnabled = true; });
    after(() => { env.rateLimitEnabled = false; });

    test('login: the 11th FAILED attempt is blocked with 429; successes are not counted', async () => {
      const u = await h.createUser('tourist');
      for (let i = 0; i < 12; i += 1) {
        await request(app).post('/api/auth/login').send({ email: u.user.email, password: u.password }).expect(200); // successes don't count
      }
      const statuses = [];
      for (let i = 0; i < 11; i += 1) {
        statuses.push((await request(app).post('/api/auth/login').send({ email: u.user.email, password: 'wrong-wrong' })).status);
      }
      assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
      assert.equal(statuses[10], 429);
      const blocked = await request(app).post('/api/auth/login').send({ email: u.user.email, password: u.password }).expect(429);
      assert.equal(blocked.body.success, false);
      assert.ok(blocked.headers['ratelimit'] || blocked.headers['ratelimit-policy'] || blocked.headers['retry-after']);
    });

    test('register is limited per address', async () => {
      const statuses = [];
      for (let i = 0; i < 12; i += 1) {
        statuses.push((await request(app).post('/api/auth/register').send({ name: 'n', email: `rl${i}@example.test`, password: 'long-enough-1' })).status);
      }
      assert.ok(statuses.includes(429), `expected a 429 in ${statuses}`);
      assert.equal(statuses.filter((s) => s === 201).length, 10);
    });

    test('telemetry: moderate limit per device (301st request in a minute → 429), before any key check', async () => {
      let last;
      let limitedAt = 0;
      for (let i = 1; i <= 305; i += 1) {
        last = await request(app).post('/api/devices/RATE-TEST/telemetry').send({ lat: 1, lng: 1 });
        if (last.status === 429 && !limitedAt) limitedAt = i;
      }
      assert.equal(limitedAt, 301);
      assert.equal(last.body.success, false);
    });

    test('phone location: one report per 3 seconds per user', async () => {
      // (users were created before the limiter was switched on)
      await request(app).post('/api/tourists/me/location').set(auth(locUser.token)).send({ lat: 1, lng: 1 }).expect(200);
      const second = await request(app).post('/api/tourists/me/location').set(auth(locUser.token)).send({ lat: 1, lng: 1 }).expect(429);
      assert.equal(second.body.success, false);
      // a different user is unaffected
      await request(app).post('/api/tourists/me/location').set(auth(locUser2.token)).send({ lat: 1, lng: 1 }).expect(200);
    });
  });
});
