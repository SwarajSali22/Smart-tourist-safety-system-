const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: connectClient } = require('socket.io-client');
const h = require('./helpers');

const { request, app, models, eventually } = h;
const { initSocket } = require('../src/sockets');
const { setIo } = require('../src/services/realtime');
const { createNotification } = require('../src/services/notifications/notify');
const jwt = require('jsonwebtoken');

describe('socket authentication + per-room authorization', () => {
  let server; let io; let url; let admin; let t1; let t2; let dev1;
  const clients = [];

  const connect = (token) => new Promise((resolve, reject) => {
    const c = connectClient(url, { auth: { token }, reconnection: false, transports: ['websocket'] });
    clients.push(c);
    c.on('connect', () => resolve(c));
    c.on('connect_error', (e) => reject(e));
  });
  const collect = (client, event) => { const got = []; client.on(event, (p) => got.push(p)); return got; };
  const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

  before(async () => {
    await h.connect();
    server = http.createServer(app);
    io = initSocket(server);
    app.set('io', io);
    setIo(io);
    await new Promise((r) => server.listen(0, r));
    url = `http://localhost:${server.address().port}`;
    admin = await h.createUser('admin');
    t1 = await h.createUser('tourist');
    t2 = await h.createUser('tourist');
    dev1 = await h.createDevice(t1.user);
  });
  after(async () => {
    clients.forEach((c) => c.close());
    io.close();
    server.close();
    await h.disconnect();
  });

  test('connections without a token, or with a bad / expired / wrong-secret token, are rejected', async () => {
    await assert.rejects(connect(undefined), /Unauthorized/);
    await assert.rejects(connect('garbage'), /Unauthorized/);
    const expired = jwt.sign({ sub: String(t1.user._id), role: 'tourist' }, process.env.JWT_SECRET, { expiresIn: -10 });
    await assert.rejects(connect(expired), /Unauthorized/);
    const forged = jwt.sign({ sub: String(admin.user._id), role: 'admin' }, 'not-the-real-secret');
    await assert.rejects(connect(forged), /Unauthorized/);
    // a refresh token is signed with a different secret and must not work as an access token
    await assert.rejects(connect(t1.refreshToken), /Unauthorized/);
  });

  test('a valid token connects', async () => {
    const c = await connect(t1.token);
    assert.equal(c.connected, true);
  });

  test('persistent notifications reach only their recipient’s personal room', async () => {
    const [a, c1, c2] = await Promise.all([connect(admin.token), connect(t1.token), connect(t2.token)]);
    const gotA = collect(a, 'notification:new'); const got1 = collect(c1, 'notification:new'); const got2 = collect(c2, 'notification:new');
    await createNotification({ recipient: t1.user._id, type: 'general', title: 'for t1', message: 'x' });
    await eventually(() => got1.length === 1, { message: 'delivery to t1' });
    await settle();
    assert.equal(got1[0].title, 'for t1');
    assert.equal(got2.length, 0, 'another tourist must not receive it');
    assert.equal(gotA.length, 0, 'an admin must not receive a tourist’s notification');
  });

  test('a tourist cannot join the admin room (or any room) by asking', async () => {
    const [a, c2] = await Promise.all([connect(admin.token), connect(t2.token)]);
    const gotAdminEvents = collect(c2, 'sos:triggered'); const gotAdmin = collect(a, 'sos:triggered');
    // try every plausible client-driven join
    c2.emit('join', 'admin'); c2.emit('join-room', 'admin'); c2.emit('subscribe', 'admin'); c2.emit('admin', 'join');
    await settle(300);
    io.to('admin').emit('sos:triggered', { sosEvent: { _id: 'secret' } });
    await eventually(() => gotAdmin.length === 1, { message: 'admin receives admin-room event' });
    await settle();
    assert.equal(gotAdminEvents.length, 0, 'tourist must not receive admin-room events');
    const rooms = [...io.sockets.sockets.values()].find((s) => String(s.data.user.id) === String(t2.user._id)).rooms;
    assert.ok(!rooms.has('admin'));
    assert.ok(rooms.has(`user:${t2.user._id}`) && rooms.has(`tourist:${t2.user._id}`));
  });

  test('device location updates reach the owning tourist and admins — not other tourists', async () => {
    const [a, c1, c2] = await Promise.all([connect(admin.token), connect(t1.token), connect(t2.token)]);
    const gotA = collect(a, 'location:update'); const got1 = collect(c1, 'location:update'); const got2 = collect(c2, 'location:update');
    await request(app).post(`/api/devices/${dev1.device.deviceId}/telemetry`).set(dev1.headers).send({ lat: 5, lng: 5 }).expect(200);
    await eventually(() => gotA.length >= 1 && got1.length >= 1, { message: 'location fan-out' });
    await settle();
    assert.equal(got2.length, 0, 'tourist 2 must never see tourist 1’s position');
    assert.equal(gotA[0].deviceId, dev1.device.deviceId);
    assert.equal(gotA[0].apiKeyHash, undefined, 'the device key hash must never be sent over the socket');
  });

  test('admin-only events (zone enter/exit log) are not delivered to tourists', async () => {
    const z = await h.createZone('restricted', 40, 40);
    const [a, c1] = await Promise.all([connect(admin.token), connect(t1.token)]);
    const gotA = collect(a, 'geofence:event'); const got1 = collect(c1, 'geofence:event');
    await request(app).post(`/api/devices/${dev1.device.deviceId}/telemetry`).set(dev1.headers).send({ lat: 40, lng: 40 }).expect(200);
    await eventually(() => gotA.length >= 1, { message: 'admin geofence event' });
    await settle();
    assert.equal(got1.length, 0);
    assert.ok(z);
  });

  test('responders get their own room, not the admin room', async () => {
    const resp = await h.createUser('responder');
    const c = await connect(resp.token);
    const rooms = [...io.sockets.sockets.values()].find((s) => s.id === c.id).rooms;
    assert.ok(rooms.has('responder') && !rooms.has('admin'));
    assert.equal(await models.User.countDocuments({ role: 'responder' }), 1);
  });
});
