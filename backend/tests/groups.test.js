const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const inv = require('../src/services/groups/invitations');

const { models, request, app, auth } = h;
let n = 0;
const body = (extra = {}) => ({ name: 'New Tourist', email: `joiner${++n}@example.com`, password: 'Passw0rd!long', ...extra });

describe('guide invitations', () => {
  let admin; let tourist; let group; let link;
  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    tourist = await h.createUser('tourist');
    const g = await request(app).post('/api/groups').set(auth(admin.token)).send({ name: 'Goa Heritage Walk' }).expect(201);
    group = g.body.group;
  });
  after(h.disconnect);

  const make = (opts = {}) => request(app).post(`/api/groups/${group._id}/invitations`).set(auth(admin.token)).send(opts).expect(201);
  // Tests read the raw token from the DB-independent path: create via the service so the token is known.
  async function tokenFor(opts = {}) {
    const token = inv.newToken();
    const doc = await models.GroupInvitation.create({
      group: group._id, createdBy: admin.user._id, tokenHash: inv.hash(token),
      expiresAt: new Date(Date.now() + (opts.ms ?? 86400000)), maxUses: opts.maxUses ?? 2, usedCount: 0, revokedAt: opts.revoked ? new Date() : null,
    });
    return { token, doc };
  }

  test('only staff manage groups and invitations', async () => {
    await request(app).post('/api/groups').set(auth(tourist.token)).send({ name: 'x' }).expect(403);
    await request(app).get('/api/groups').expect(401);
    await request(app).post(`/api/groups/${group._id}/invitations`).set(auth(tourist.token)).send({}).expect(403);
  });

  test('no link, QR text or message is produced without a verified permanent HTTPS address', async () => {
    const r = await make();
    assert.equal(r.body.link, null);
    assert.match(r.body.linkUnavailableReason, /PUBLIC_APP_URL/);
    assert.equal(r.body.message, null);
    for (const bad of ['http://example.org', 'https://localhost:5173', 'https://abc.trycloudflare.com', 'https://x.lhr.life', '']) {
      h.env.publicAppUrl = bad;
      assert.equal(inv.publicBase().ok, false, bad);
    }
    h.env.publicAppUrl = 'https://sts.example.org/';
    const ok = await make({ expiresInDays: 3, maxUses: 5 });
    assert.match(ok.body.link, /^https:\/\/sts\.example\.org\/register\?invite=[\w-]{20,}$/);
    assert.match(ok.body.message, /Goa Heritage Walk/);
    link = ok.body.link;
    h.env.publicAppUrl = '';
    const stored = await models.GroupInvitation.findById(ok.body.invitation._id);
    assert.ok(!link.includes(stored.tokenHash), 'only a hash is stored');
    assert.equal(stored.maxUses, 5);
  });

  test('registering with a valid invitation joins ONLY that group as a tourist', async () => {
    const { token } = await tokenFor();
    const pre = await request(app).get(`/api/invitations/${token}`).expect(200);
    assert.deepEqual(pre.body.group, { name: 'Goa Heritage Walk' });
    const res = await request(app).post('/api/auth/register').send(body({ invite: token, role: 'admin' })).expect(201);
    assert.equal(res.body.user.role, 'tourist', 'an invitation never grants a role');
    const profile = await models.TouristProfile.findOne({ user: res.body.user.id || res.body.user._id });
    assert.equal(String(profile.group), String(group._id));
    assert.ok(await models.ActivityLog.findOne({ action: 'group.join' }));
  });

  test('seat limit, revocation, expiry and garbage tokens all fail without creating an account', async () => {
    const full = await tokenFor({ maxUses: 1 });
    await request(app).post('/api/auth/register').send(body({ invite: full.token })).expect(201);
    const before = await models.User.countDocuments();
    await request(app).post('/api/auth/register').send(body({ invite: full.token })).expect(400);
    const revoked = await tokenFor({ revoked: true });
    const expired = await tokenFor({ ms: -1000 });
    for (const t of [revoked.token, expired.token, 'x'.repeat(30)]) {
      await request(app).get(`/api/invitations/${t}`).expect(404);
      await request(app).post('/api/auth/register').send(body({ invite: t })).expect(400);
    }
    assert.equal(await models.User.countDocuments(), before);
  });

  test('revoking via the API stops the link; a taken email gives the seat back', async () => {
    const a = await tokenFor();
    await request(app).delete(`/api/groups/invitations/${a.doc._id}`).set(auth(admin.token)).expect(200);
    await request(app).post('/api/auth/register').send(body({ invite: a.token })).expect(400);
    await request(app).delete(`/api/groups/invitations/${a.doc._id}`).set(auth(admin.token)).expect(404);

    const b = await tokenFor({ maxUses: 1 });
    await request(app).post('/api/auth/register').send(body({ invite: b.token, email: tourist.user.email })).expect(409);
    assert.equal((await models.GroupInvitation.findById(b.doc._id)).usedCount, 0);
    await request(app).post('/api/auth/register').send(body({ invite: b.token })).expect(201);
  });

  test('registration without an invitation still works and has no group; groups list shows members', async () => {
    const r = await request(app).post('/api/auth/register').send(body()).expect(201);
    const profile = await models.TouristProfile.findOne({ user: r.body.user.id || r.body.user._id });
    assert.equal(profile.group, null);
    const list = await request(app).get('/api/groups').set(auth(admin.token)).expect(200);
    const g = list.body.groups.find((x) => x._id === String(group._id));
    assert.ok(g.members >= 2);
    assert.ok(g.invitations.length >= 3);
  });
  test('demo mode: a temporary https tunnel gets a flagged link (no QR); localhost, http and plain tunnels in normal mode never do', async () => {
    h.env.publicAppUrl = 'https://abc-def.trycloudflare.com';
    assert.equal(inv.publicBase().ok, false, 'blocked by default');
    h.env.inviteDemo = true;
    const r = await make();
    assert.match(r.body.link, /^https:\/\/abc-def\.trycloudflare\.com\/register\?invite=/);
    assert.equal(r.body.demo, true);
    assert.equal(r.body.qrAllowed, true, 'a QR may encode the same verified https demo link');
    for (const bad of ['https://localhost:5173', 'http://x.trycloudflare.com', 'https://127.0.0.1']) {
      h.env.publicAppUrl = bad;
      assert.equal(inv.publicBase().ok, false, bad);
    }
    h.env.inviteDemo = false; h.env.publicAppUrl = '';
  });
  test('existing tourist joins through /join (group comes from the token only); signed-in states are handled', async () => {
    const { token } = await tokenFor({ maxUses: 5 });
    const solo = await h.createUser('tourist', { name: 'Existing Eve' });
    await request(app).post(`/api/invitations/${token}/join`).expect(401);
    await request(app).post(`/api/invitations/${token}/join`).set(auth(admin.token)).expect(403);
    await request(app).post(`/api/invitations/${'z'.repeat(30)}/join`).set(auth(solo.token)).expect(400);
    const j = await request(app).post(`/api/invitations/${token}/join`).set(auth(solo.token)).send({ group: 'ffffffffffffffffffffffff' }).expect(200);
    assert.equal(j.body.status, 'joined');
    assert.equal(j.body.group.name, 'Goa Heritage Walk');
    const again = await request(app).post(`/api/invitations/${token}/join`).set(auth(solo.token)).expect(200);
    assert.equal(again.body.status, 'already_member');
    assert.equal((await models.GroupInvitation.findOne({ tokenHash: inv.hash(token) })).usedCount, 1, 'a repeat does not use another seat');
    const other = (await request(app).post('/api/groups').set(auth(admin.token)).send({ name: 'Other group' }).expect(201)).body.group;
    const t2 = inv.newToken();
    await models.GroupInvitation.create({ group: other._id, createdBy: admin.user._id, tokenHash: inv.hash(t2), expiresAt: new Date(Date.now() + 86400000), maxUses: 2 });
    await request(app).post(`/api/invitations/${t2}/join`).set(auth(solo.token)).expect(409);
    assert.equal((await models.GroupInvitation.findOne({ tokenHash: inv.hash(t2) })).usedCount, 0);
    const me = await request(app).get('/api/tourists/me').set(auth(solo.token)).expect(200);
    assert.equal(me.body.profile.group.name, 'Goa Heritage Walk');
  });

  test('a new tourist keeps the group after logging in again; admin sees them with real, honest location data', async () => {
    const { token } = await tokenFor({ maxUses: 5 });
    const email = `member${++n}@example.com`;
    const reg = await request(app).post('/api/auth/register').send(body({ invite: token, email, name: 'Nina Member', phone: '+919812345678' })).expect(201);
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!long', portal: 'tourist' }).expect(200);
    const me = await request(app).get('/api/tourists/me').set(auth(login.body.accessToken)).expect(200);
    assert.equal(String(me.body.profile.group._id), String(group._id));
    assert.ok(me.body.profile.joinedGroupAt);

    let list = await request(app).get(`/api/groups/${group._id}/members`).set(auth(admin.token)).expect(200);
    let m = list.body.members.find((x) => x.name === 'Nina Member');
    assert.ok(m);
    assert.equal(m.status, 'unavailable', 'no GPS yet -> no invented location');
    assert.equal(m.lastLocation, null);
    assert.match(m.email, /^m\*\*\*@example\.com$/);
    assert.equal(m.phone, '••••678');
    assert.equal(JSON.stringify(m).includes('passwordHash'), false);

    const uid = reg.body.user.id || reg.body.user._id;
    await models.Device.create({ deviceId: `PH-${uid}`, tourist: uid, type: 'phone', status: 'active', lastLocation: { lat: 10, lng: 20 }, lastSeen: new Date(Date.now() - 30 * 60000) });
    list = await request(app).get(`/api/groups/${group._id}/members`).set(auth(admin.token)).expect(200);
    m = list.body.members.find((x) => x.name === 'Nina Member');
    assert.equal(m.status, 'overdue', '30 minutes old is never "live"');
    assert.deepEqual(m.lastLocation, { lat: 10, lng: 20 });
    await models.Device.updateOne({ tourist: uid }, { lastSeen: new Date() });
    m = (await request(app).get(`/api/groups/${group._id}/members`).set(auth(admin.token))).body.members.find((x) => x.name === 'Nina Member');
    assert.equal(m.status, 'live');
  });

  test('groups are separate; tourists cannot read members; revoking a link keeps the members', async () => {
    const gB = (await request(app).post('/api/groups').set(auth(admin.token)).send({ name: 'Group B' }).expect(201)).body.group;
    const lb = await request(app).get(`/api/groups/${gB._id}/members`).set(auth(admin.token)).expect(200);
    assert.deepEqual(lb.body.members, [], 'empty group: no members from group A leak in');
    await request(app).get(`/api/groups/${group._id}/members`).set(auth(tourist.token)).expect(403);
    await request(app).get(`/api/groups/${group._id}/members`).expect(401);
    const before = (await request(app).get(`/api/groups/${group._id}/members`).set(auth(admin.token))).body.members.length;
    const { token, doc } = await tokenFor();
    await request(app).delete(`/api/groups/invitations/${doc._id}`).set(auth(admin.token)).expect(200);
    await request(app).post('/api/auth/register').send(body({ invite: token })).expect(400);
    const after = (await request(app).get(`/api/groups/${group._id}/members`).set(auth(admin.token))).body.members.length;
    assert.equal(after, before);
    const list = await request(app).get('/api/groups').set(auth(admin.token)).expect(200);
    assert.equal(list.body.groups.find((g) => g._id === String(group._id)).invitations.find((i) => i._id === String(doc._id)).status, 'revoked');
  });
});
