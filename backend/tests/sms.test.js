const { test, before, after, beforeEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { models, env } = h;
const { triggerSos } = require('../src/services/sos/triggerSos');
const { notifyEmergencyContacts, isConfigured } = require('../src/services/notifications/sms');

// Every request goes to this mock — nothing here can reach Twilio or send a real SMS.
describe('SOS SMS alerts (mocked Twilio)', () => {
  const realFetch = global.fetch;
  const realErr = console.error;
  const CONTACTS = [
    { name: 'Mum', phone: '+91 98765-43210' },
    { name: 'Dad', phone: '+44 (20) 7946 0958' },
  ];
  let calls; let respond; let tourist; let device; let n = 0;
  const jsonRes = (status, body) => ({ ok: status < 400, status, json: async () => body });

  before(async () => {
    await h.connect();
    tourist = await h.createUser('tourist', { name: 'Sam Sms' });
    device = await h.createDevice(tourist.user);
    console.error = () => {};
  });
  after(async () => {
    global.fetch = realFetch;
    console.error = realErr;
    Object.assign(env.twilio, { accountSid: '', authToken: '', from: '' });
    await h.disconnect();
  });

  beforeEach(async () => {
    calls = [];
    respond = async () => jsonRes(201, { sid: `SM${++n}` });
    global.fetch = async (url, opts) => {
      calls.push({ url, opts, params: new URLSearchParams(String(opts.body)) });
      return respond(url, opts);
    };
    Object.assign(env.twilio, { accountSid: 'ACtest', authToken: 'secret-token', from: '+15550001234' });
    await models.Notification.deleteMany({ channel: 'sms' });
    await models.SOSEvent.deleteMany({});
    await models.Incident.deleteMany({});
    await models.TouristProfile.updateOne({ user: tourist.user._id }, { emergencyContacts: CONTACTS });
  });

  const sos = (location = { lat: 12.5, lng: 77.25 }) =>
    triggerSos({ tourist: tourist.user._id, device: device.device._id, location, source: 'app' });
  const rows = () => models.Notification.find({ channel: 'sms' }).sort({ 'payload.contact': 1 }).lean();
  // triggerSos fires its own background send; wait until it has finished with every contact.
  const settled = (count) => h.eventually(async () => {
    const r = await rows();
    return r.length === count && r.every((x) => x.delivered || x.error) ? r : null;
  }, { message: 'sms attempts to settle' });

  test('sends to every contact with a Google Maps link built from the real coordinates', async () => {
    const { incident } = await sos();
    const stored = await settled(2);
    assert.equal(calls.length, 2);
    const body = calls[0].params.get('Body');
    assert.match(body, /Sam Sms/);
    assert.ok(body.includes('https://www.google.com/maps?q=12.5,77.25'));
    assert.ok(body.includes(String(incident._id).slice(-8)));
    assert.deepEqual(calls.map((c) => c.params.get('To')).sort(), ['+442079460958', '+919876543210']);
    assert.equal(calls[0].params.get('From'), '+15550001234');
    assert.match(calls[0].opts.headers.Authorization, /^Basic /);
    assert.ok(stored.every((r) => r.delivered === true && r.payload.providerSid));
  });

  test('duplicate triggers never text the same contact twice', async () => {
    const { sosEvent, incident } = await sos();
    await settled(2);
    const again = await notifyEmergencyContacts({ touristId: tourist.user._id, sosEvent, incident });
    assert.equal(again.sent, 0);
    assert.equal(again.skipped, 2);
    assert.equal(calls.length, 2);
  });

  test('invalid credentials are recorded as failed with a safe message; the SOS is still recorded', async () => {
    respond = async () => jsonRes(401, { message: 'Authenticate', code: 20003 });
    const { sosEvent, incident } = await sos();
    assert.ok(await models.SOSEvent.findById(sosEvent._id));
    assert.ok(await models.Incident.findById(incident._id));
    for (const r of await settled(2)) {
      assert.equal(r.delivered, false);
      assert.equal(r.error, 'SMS provider rejected the credentials');
      assert.ok(!JSON.stringify(r).includes('secret-token'));
    }
  });

  test('timeouts and network errors are recorded as failures, never thrown', async () => {
    respond = async () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; };
    await sos();
    assert.ok((await settled(2)).every((r) => r.error === 'SMS provider timed out'));

    respond = async () => { throw new TypeError('fetch failed'); };
    await models.Notification.deleteMany({ channel: 'sms' });
    const { sosEvent } = await models.SOSEvent.findOne().then((s) => ({ sosEvent: s }));
    const summary = await notifyEmergencyContacts({ touristId: tourist.user._id, sosEvent });
    assert.equal(summary.failed, 2);
    assert.equal((await rows())[0].error, 'SMS provider unreachable');
  });

  test('an invalid phone number fails locally without calling the provider', async () => {
    await models.TouristProfile.updateOne({ user: tourist.user._id }, { emergencyContacts: [{ name: 'Bad', phone: '12345' }] });
    await sos();
    const [row] = await settled(1);
    assert.equal(calls.length, 0);
    assert.equal(row.error, 'Invalid destination phone number');
  });

  test('without credentials nothing is sent and nothing is recorded as sent', async () => {
    Object.assign(env.twilio, { accountSid: '', authToken: '', from: '' });
    assert.equal(isConfigured(), false);
    const { sosEvent } = await sos();
    const summary = await notifyEmergencyContacts({ touristId: tourist.user._id, sosEvent });
    assert.deepEqual(summary, { sent: 0, failed: 0, skipped: 0 });
    assert.equal(calls.length, 0);
    assert.equal((await rows()).length, 0);
  });

  test('simulated (demo) tourists never trigger SMS', async () => {
    const demo = await h.createUser('tourist', { isDemo: true });
    await models.TouristProfile.updateOne({ user: demo.user._id }, { emergencyContacts: [{ name: 'X', phone: '+919876543210' }] });
    const dd = await h.createDevice(demo.user, { isDemo: true });
    const { sosEvent } = await triggerSos({ tourist: demo.user._id, device: dd.device._id, location: { lat: 1, lng: 2 }, source: 'app' });
    const summary = await notifyEmergencyContacts({ touristId: demo.user._id, sosEvent });
    assert.equal(summary.sent, 0);
    assert.equal(calls.length, 0);
  });
});
