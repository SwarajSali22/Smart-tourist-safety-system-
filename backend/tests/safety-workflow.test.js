const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { sweep } = require('../src/jobs/safetyCheckScheduler');
const { describeSignal, rateSeverity } = require('../src/services/safetyCheck/workflow');

const { models, request, app, auth } = h;
const MIN = 60 * 1000;
const T0 = Date.now();           // controlled clock: every sweep is given an explicit "now"
const at = (m) => T0 + m * MIN;

describe('15 / 20 / 25-minute safety workflow (fake clock, isolated DB, no real notifications)', () => {
  let admin;
  before(async () => { await h.connect(); admin = await h.createUser('admin'); });
  after(h.disconnect);

  // A tourist whose phone last reported at T0.
  async function tourist(extra = {}) {
    const t = await h.createUser('tourist');
    const { device } = await h.createDevice(t.user, { type: 'phone', lastLocation: { lat: 40, lng: 40 }, lastSeen: new Date(T0), status: 'active', ...extra });
    return { t, device };
  }
  const checks = (t) => models.SafetyCheck.find({ tourist: t.user._id }).lean();
  const incidents = (t) => models.Incident.find({ tourist: t.user._id }).lean();
  const sos = (t) => models.SOSEvent.countDocuments({ tourist: t.user._id });
  const touristNotes = (t) => models.Notification.countDocuments({ recipient: t.user._id, type: 'safety_check_prompt' });

  test('before 15 minutes of silence nothing happens', async () => {
    const { t } = await tourist();
    await sweep(null, at(14));
    assert.equal((await checks(t)).length, 0);
  });

  test('15 min: marked overdue once, internally (the tourist is not asked yet), repeat sweeps add nothing', async () => {
    const { t } = await tourist();
    await sweep(null, at(16)); await sweep(null, at(16)); await sweep(null, at(17));
    const list = await checks(t);
    assert.equal(list.length, 1);
    assert.equal(list[0].stage, 'overdue');
    assert.equal(await touristNotes(t), 0);
    assert.equal((await incidents(t)).length, 0);
    assert.ok(await models.ActivityLog.findOne({ action: 'safety.overdue', targetId: String(list[0]._id) }));
  });

  test('20 min: one persistent check-in request + one notification; offline delivery is recorded honestly', async () => {
    const { t } = await tourist();
    await sweep(null, at(21)); await sweep(null, at(21)); await sweep(null, at(22));
    const [c] = await checks(t);
    assert.equal(c.stage, 'requested');
    assert.ok(c.requestedAt);
    assert.equal(await touristNotes(t), 1, 'no duplicate request');
    assert.equal(c.delivery.touristConnected, false);
    assert.equal(c.delivery.sms, 'not_configured');
    assert.match(c.delivery.note, /not connected/);
    assert.equal((await incidents(t)).length, 0);
    assert.ok(await models.ActivityLog.findOne({ action: 'safety.check_requested', targetId: String(c._id) }));
  });

  test('a "safe" reply before 25 min cancels the escalation and is audited', async () => {
    const { t } = await tourist();
    await sweep(null, at(21));
    const [c] = await checks(t);
    await request(app).post(`/api/safety-checks/${c._id}/respond`).set(auth(t.token)).set('Idempotency-Key', 'k-safe-1').send({ response: 'safe' }).expect(200);
    await sweep(null, at(27)); await sweep(null, at(30));
    const after1 = await models.SafetyCheck.findById(c._id);
    assert.equal(after1.stage, 'closed');
    assert.equal(after1.closedReason, 'check_in');
    assert.equal((await incidents(t)).length, 0);
    assert.equal(await sos(t), 0);
    assert.ok(await models.ActivityLog.findOne({ action: 'safety.check_in_response', targetId: String(c._id) }));
  });

  test('25 min: ONE automated safety alert (not an SOS), idempotent across repeated sweeps, with context for the admin', async () => {
    const { t } = await tourist();
    await sweep(null, at(21));
    await sweep(null, at(24));
    assert.equal((await incidents(t)).length, 0, 'not before 25 min');
    await sweep(null, at(26)); await sweep(null, at(26)); await sweep(null, at(27)); await sweep(null, at(40));
    const inc = await incidents(t);
    assert.equal(inc.length, 1);
    assert.equal(inc[0].type, 'no_response');
    assert.equal(inc[0].severity, 'medium');
    assert.equal(await sos(t), 0, 'silence is never turned into an SOS');
    const meta = inc[0].timeline[0].metadata;
    assert.equal(meta.kind, 'automated_safety_alert');
    assert.equal(meta.isSos, false);
    assert.equal(meta.lastKnownLocation.lat, 40);
    assert.equal(meta.locationIsStale, true);
    assert.ok(meta.reasons.some((r) => /may be outdated/.test(r)));
    assert.ok(meta.timeline.length >= 3);
    const [c] = await checks(t);
    assert.equal(c.stage, 'escalated');
    assert.equal(String(c.incident), String(inc[0]._id));
    assert.equal(await models.Notification.countDocuments({ recipient: admin.user._id, dedupeKey: `incident:${inc[0]._id}:${admin.user._id}` }), 1);
    assert.ok(await models.ActivityLog.findOne({ action: 'safety.escalated', targetId: String(c._id) }));
  });

  test('after server downtime the request still gets its full grace period before escalating', async () => {
    const { t } = await tourist();
    await sweep(null, at(40));                       // first look is 40 min in: overdue + request now
    assert.equal((await checks(t))[0].stage, 'requested');
    assert.equal((await incidents(t)).length, 0, 'nobody could have seen the request yet');
    await sweep(null, at(46));
    assert.equal((await incidents(t)).length, 1);
  });

  test('a late "safe" reply after the alert is added to the incident timeline; the alert stays open for a human', async () => {
    const { t } = await tourist();
    await sweep(null, at(21)); await sweep(null, at(26));
    const [c] = await checks(t);
    await request(app).post(`/api/safety-checks/${c._id}/respond`).set(auth(t.token)).set('Idempotency-Key', 'k-late-1').send({ response: 'safe' }).expect(200);
    const inc = await models.Incident.findById(c.incident);
    assert.equal(inc.status, 'open');
    assert.ok(inc.timeline.some((e) => /confirmed "safe" after the automated alert/.test(e.action)));
  });

  test('GPS resuming ends the episode: an unrequested overdue marker disappears; an escalated alert gets a note and stays open', async () => {
    const a = await tourist();
    await sweep(null, at(16));
    assert.equal((await checks(a.t)).length, 1);
    await models.Device.updateOne({ _id: a.device._id }, { lastSeen: new Date(at(17)) });
    await sweep(null, at(18));
    assert.equal((await checks(a.t)).length, 0);

    const b = await tourist();
    await sweep(null, at(21)); await sweep(null, at(26));
    const [c] = await checks(b.t);
    await models.Device.updateOne({ _id: b.device._id }, { lastSeen: new Date(at(30)), 'lastLocation.lat': 41 });
    await sweep(null, at(31));
    assert.equal((await models.SafetyCheck.findById(c._id)).stage, 'closed');
    const inc = await models.Incident.findById(c.incident);
    assert.equal(inc.status, 'open');
    assert.ok(inc.timeline.some((e) => /GPS updates resumed/.test(e.action)));
  });

  test('zone rules: restricted → High; stale danger → High (not Critical); fresh danger → Critical; shown with the reason', async () => {
    const restricted = await h.createZone('restricted', 50, 50);
    const r = await tourist({ lastLocation: { lat: 50, lng: 50 } });
    await sweep(null, at(21)); await sweep(null, at(26));
    const ri = (await incidents(r.t))[0];
    assert.equal(ri.severity, 'high');
    assert.deepEqual(ri.timeline[0].metadata.zonesAtLastPosition.map((z) => z.name), [restricted.name]);

    const danger = await h.createZone('danger', 60, 60);
    const d = await tourist({ lastLocation: { lat: 60, lng: 60 } });
    await sweep(null, at(21)); await sweep(null, at(26));
    const di = (await incidents(d.t))[0];
    assert.equal(di.severity, 'high');
    assert.match(di.timeline[0].metadata.reasons.join(' '), /not Critical/);

    const zones = { inside: [{ name: danger.name, type: 'danger' }], near: [] };
    assert.equal(rateSeverity({ zones, fresh: true }).severity, 'critical');
    assert.equal(rateSeverity({ zones: { inside: [], near: [{ name: 'x', type: 'danger' }] }, fresh: true }).severity, 'medium');
  });

  test('not applied to: an active SOS, long-gone devices (>12h), demo devices, or tourists who never reported', async () => {
    const s = await tourist();
    await models.SOSEvent.create({ tourist: s.t.user._id, location: { lat: 1, lng: 1 }, source: 'app', status: 'active', activeKey: String(s.t.user._id) });
    await sweep(null, at(30));
    assert.equal((await checks(s.t)).length, 0);

    const old = await tourist();
    await sweep(null, at(13 * 60));
    assert.equal((await checks(old.t)).length, 0);

    const demo = await tourist({ isDemo: true });
    await sweep(null, at(21));
    assert.equal((await checks(demo.t)).length, 0);

    const never = await h.createUser('tourist');
    await h.createDevice(never.user, { type: 'phone' });
    await sweep(null, at(30));
    assert.equal((await checks(never)).length, 0);
  });

  test('status is never "live" for an old fix, and GPS and check-in times are kept apart', () => {
    const base = { hasLocation: true };
    assert.equal(describeSignal({ ...base, lastSeen: new Date(T0) }, at(1)).status, 'live');
    assert.equal(describeSignal({ ...base, lastSeen: new Date(T0) }, at(5)).status, 'last_known');
    assert.equal(describeSignal({ ...base, lastSeen: new Date(T0) }, at(16)).status, 'overdue');
    assert.equal(describeSignal({ hasLocation: false, lastSeen: null }, at(1)).status, 'unavailable');
    const both = describeSignal({ ...base, lastSeen: new Date(T0), lastCheckInAt: new Date(at(14)) }, at(16));
    assert.equal(both.status, 'last_known', 'a recent check-in is a qualifying signal');
    assert.equal(+both.lastGpsAt, T0);
    assert.equal(+both.lastCheckInAt, at(14));
  });

  test('admin status endpoint: admin only, shows last known position, status and open episode', async () => {
    const { t } = await tourist();
    await sweep(null, at(21));
    const res = await request(app).get('/api/safety-checks/status').set(auth(admin.token)).expect(200);
    const row = res.body.rows.find((r) => String(r.tourist._id) === String(t.user._id));
    assert.ok(row);
    assert.equal(row.lastLocation.lat, 40);
    assert.equal(row.episode.stage, 'requested');
    assert.equal(row.socketConnected, false);
    assert.equal(res.body.thresholds.escalateMinutes, 25);
    await request(app).get('/api/safety-checks/status').set(auth(t.token)).expect(403);
  });
});

describe('approaching-zone warning (distance to the boundary, GPS accuracy, no spam)', () => {
  const { warnApproachingZone } = require('../src/services/geofencing/approachWarning');
  let admin; let zone;
  before(async () => { await h.connect(); admin = await h.createUser('admin'); zone = await h.createZone('restricted', 20, 20); });
  after(h.disconnect);

  const near = { lat: 20, lng: 20.0118 };   // ≈190 m outside the east edge
  const far = { lat: 20, lng: 20.05 };      // ≈ 4 km away
  const notes = (u) => models.Notification.find({ recipient: u.user._id, 'payload.approach': true }).lean();

  test('warns tourist and admin once, with the zone name and a distance', async () => {
    const t = await h.createUser('tourist');
    const first = await warnApproachingZone({ touristId: t.user._id, ...near, accuracy: 15, now: T0 });
    assert.equal(first.length, 1);
    assert.ok(first[0].distanceM > 100 && first[0].distanceM < 300, `distance ${first[0].distanceM}`);
    const again = await warnApproachingZone({ touristId: t.user._id, ...near, accuracy: 15, now: T0 + MIN });
    assert.equal(again.length, 0, 'cooldown: no repeated warning');
    const [n] = await notes(t);
    assert.match(n.title, new RegExp(zone.name));
    assert.equal((await notes(t)).length, 1);
    assert.equal(await models.Notification.countDocuments({ recipient: admin.user._id, 'payload.approach': true, 'payload.tourist': t.user._id }), 1);
    const later = await warnApproachingZone({ touristId: t.user._id, ...near, accuracy: 15, now: T0 + 40 * MIN });
    assert.equal(later.length, 1, 'a new warning is allowed after the cooldown');
  });

  test('no warning for inaccurate/unknown GPS, for faraway tourists, or when already inside', async () => {
    const t = await h.createUser('tourist');
    assert.equal((await warnApproachingZone({ touristId: t.user._id, ...near, accuracy: 400, now: T0 })).length, 0);
    assert.equal((await warnApproachingZone({ touristId: t.user._id, ...near, now: T0 })).length, 0);
    assert.equal((await warnApproachingZone({ touristId: t.user._id, ...far, accuracy: 10, now: T0 })).length, 0);
    assert.equal((await warnApproachingZone({ touristId: t.user._id, lat: 20, lng: 20, accuracy: 10, now: T0 })).length, 0);
    assert.equal((await notes(t)).length, 0);
  });
});
