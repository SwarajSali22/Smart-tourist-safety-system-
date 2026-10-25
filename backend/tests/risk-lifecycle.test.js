const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { evaluateRisk } = require('../src/services/riskAssessment/evaluateRisk');
const { autoResolveClearedRisk } = require('../src/services/riskAssessment/escalateRisk');
const { sweepRisk } = require('../src/services/riskAssessment/sweepRisk');

const { request, app, models, auth } = h;
const MIN = 60 * 1000;
const ev = (t) => evaluateRisk(t.user._id, null, { force: true });
const riskIncidents = (t) => models.Incident.find({ tourist: t.user._id, type: 'risk_escalation' }).sort({ createdAt: 1 });

describe('risk alerts: current data, one alert per condition, honest resolution', () => {
  let admin; let danger;
  before(async () => {
    await h.connect();
    admin = await h.createUser('admin');
    danger = await h.createZone('danger', 10, 10);
  });
  after(h.disconnect);

  const inZone = (t, seenMinAgo) => h.createDevice(t.user, { lastLocation: { lat: 10, lng: 10 }, lastSeen: new Date(Date.now() - seenMinAgo * MIN), currentZones: [danger._id] });

  test('an old position inside a danger zone is not treated as "in danger now"', async () => {
    const t = await h.createUser('tourist');
    await inZone(t, 120);
    const { riskAssessment } = await ev(t);
    assert.equal(riskAssessment.ruleTriggered, false);
    assert.equal(riskAssessment.locationStale, true);
    assert.ok(riskAssessment.locationAgeMin >= 119);
    assert.notEqual(riskAssessment.level, 'critical');
    assert.match(riskAssessment.explanation.find((e) => e.key === 'zoneRiskScore').detail, /old/);
    assert.equal((await riskIncidents(t)).length, 0);
  });

  test('a fresh position inside a danger zone still raises ONE alert, however many ticks arrive', async () => {
    const t = await h.createUser('tourist');
    await inZone(t, 0);
    for (let i = 0; i < 5; i += 1) await ev(t);
    const list = await riskIncidents(t);
    assert.equal(list.length, 1);
    assert.equal(list[0].severity, 'critical');
    assert.equal(list[0].timeline.length, 1, 'repeat readings do not spam the timeline');
  });

  test('an assigned alert is reused instead of duplicated', async () => {
    const t = await h.createUser('tourist');
    const r = await h.createUser('responder');
    await inZone(t, 0);
    await ev(t);
    const [inc] = await riskIncidents(t);
    await request(app).patch(`/api/incidents/${inc._id}/status`).set(auth(admin.token)).send({ status: 'in_progress' }).expect(200);
    await request(app).patch(`/api/incidents/${inc._id}/status`).set(auth(admin.token)).send({ status: 'assigned', assignee: String(r.user._id) }).expect(200);
    await ev(t); await ev(t);
    assert.equal((await riskIncidents(t)).length, 1);
  });

  test('a resolved alert does not come back while the same condition persists, but a genuinely new one can', async () => {
    const t = await h.createUser('tourist');
    const d = await inZone(t, 0);
    await ev(t);
    const [first] = await riskIncidents(t);
    await request(app).patch(`/api/incidents/${first._id}/resolve`).set(auth(admin.token)).send({ resolution: 'checked' }).expect(200);
    await ev(t); await ev(t);
    assert.equal((await riskIncidents(t)).length, 1, 'same standing condition: no new alert');
    assert.equal((await models.Incident.findById(first._id)).status, 'resolved');

    // the tourist leaves (risk drops), then enters again → a real new escalation
    await models.Device.updateOne({ _id: d.device._id }, { currentZones: [], lastLocation: { lat: 50, lng: 50 }, lastSeen: new Date() });
    const low = await ev(t);
    assert.equal(low.riskAssessment.level, 'low');
    await models.Device.updateOne({ _id: d.device._id }, { currentZones: [danger._id], lastLocation: { lat: 10, lng: 10 }, lastSeen: new Date() });
    await ev(t);
    const all = await riskIncidents(t);
    assert.equal(all.length, 2);
    assert.equal(all[1].status, 'open');
  });

  test('an acknowledged alert stays acknowledged across further readings', async () => {
    const t = await h.createUser('tourist');
    await inZone(t, 0);
    await ev(t);
    const [inc] = await riskIncidents(t);
    await request(app).patch(`/api/incidents/${inc._id}/acknowledge`).set(auth(admin.token)).send({}).expect(200);
    await ev(t); await ev(t);
    const list = await riskIncidents(t);
    assert.equal(list.length, 1);
    assert.equal(list[0].status, 'in_progress');
  });

  test('an alert clears itself once fresh data shows the risk has passed — with an audit trail and history kept', async () => {
    const t = await h.createUser('tourist');
    const d = await inZone(t, 0);
    await ev(t);
    const [inc] = await riskIncidents(t);
    await request(app).patch(`/api/incidents/${inc._id}/acknowledge`).set(auth(admin.token)).send({}).expect(200);

    // stale or high data never clears it
    assert.equal(await autoResolveClearedRisk(t.user._id), 0);

    await models.Device.updateOne({ _id: d.device._id }, { currentZones: [], lastLocation: { lat: 50, lng: 50 }, lastSeen: new Date() });
    // the earlier high reading is still inside the clear window → not yet
    await ev(t);
    assert.equal((await models.Incident.findById(inc._id)).status, 'in_progress');
    // age the high reading beyond the window, then re-evaluate on fresh data
    await models.RiskAssessment.updateMany({ tourist: t.user._id, level: { $in: ['high', 'critical'] } }, { evaluatedAt: new Date(Date.now() - 40 * MIN) });
    await ev(t);
    const done = await models.Incident.findById(inc._id);
    assert.equal(done.status, 'resolved');
    assert.ok(done.resolvedAt);
    assert.equal(done.createdAt.toISOString(), inc.createdAt.toISOString());
    assert.match(done.timeline.at(-1).metadata.note, /resolved automatically/);
    assert.ok(await models.AuditProof.findOne({ eventType: 'incident_resolved', eventRef: inc._id }));
    assert.ok(await models.RiskAssessment.countDocuments({ tourist: t.user._id }) >= 3, 'risk history is kept');
  });

  test('missing or stale location data never auto-resolves an alert', async () => {
    const t = await h.createUser('tourist');
    const d = await inZone(t, 0);
    await ev(t);
    const [inc] = await riskIncidents(t);
    await models.RiskAssessment.updateMany({ tourist: t.user._id }, { evaluatedAt: new Date(Date.now() - 40 * MIN) });
    await models.Device.updateOne({ _id: d.device._id }, { currentZones: [], lastSeen: new Date(Date.now() - 3 * 60 * MIN) });
    await ev(t); // stale low assessment
    assert.equal((await models.Incident.findById(inc._id)).status, 'open');
  });

  test('the sweep re-scores an old high score, and the API flags outdated scores', async () => {
    const t = await h.createUser('tourist');
    const d = await inZone(t, 0);
    await ev(t);
    // the device stops reporting two hours ago; the stored critical score is just as old
    await models.Device.updateOne({ _id: d.device._id }, { lastSeen: new Date(Date.now() - 120 * MIN) });
    await models.RiskAssessment.updateMany({ tourist: t.user._id }, { evaluatedAt: new Date(Date.now() - 120 * MIN) });
    const before = await request(app).get('/api/risk').set(auth(admin.token)).expect(200);
    const row = before.body.assessments.find((a) => String(a.tourist._id) === String(t.user._id));
    assert.equal(row.outdated, true);
    assert.ok(row.ageMin >= 119);

    await sweepRisk(null);
    const after1 = await request(app).get('/api/risk').set(auth(admin.token)).expect(200);
    const row2 = after1.body.assessments.find((a) => String(a.tourist._id) === String(t.user._id));
    assert.equal(row2.outdated, false);
    assert.equal(row2.locationStale, true);
    assert.notEqual(row2.level, 'critical', 'a stale fix no longer proves a danger-zone presence');
  });
});
