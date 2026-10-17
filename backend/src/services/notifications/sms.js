const { Notification, TouristProfile, User } = require('../../models');
const env = require('../../config/env');

/**
 * SMS to a tourist's emergency contacts via Twilio's REST API (no SDK
 * dependency). Disabled until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
 * TWILIO_FROM are set — SOS still works without it. Twilio trial accounts
 * can only text numbers verified in the Twilio console.
 *
 * One Notification row per (SOS, phone number): `dedupeKey` + the unique index
 * claim the send before it happens, so a replay or double trigger never texts
 * the same contact twice. The row is then updated with the real outcome.
 */

const TIMEOUT_MS = 8000;
const E164 = /^\+[1-9]\d{6,14}$/;

const isConfigured = () => Boolean(env.twilio.accountSid && env.twilio.authToken && env.twilio.from);

const normalizePhone = (raw) => String(raw || '').replace(/[\s().-]/g, '');

/** Twilio error → short, secret-free reason. Never includes credentials. */
function describeFailure(status, body) {
  if (status === 401 || status === 403) return 'SMS provider rejected the credentials';
  if (status === 429) return 'SMS provider rate limit reached';
  if (status === 400 && body?.code === 21211) return 'Invalid destination phone number';
  if (status === 400 && body?.code === 21608) return 'Destination number not verified (trial account)';
  return `${body?.message || 'SMS provider error'} (HTTP ${status})`;
}

/** Sends one SMS. Resolves { sid }; rejects with a safe Error message. */
async function sendSms(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.twilio.accountSid}/Messages.json`;
  const auth = Buffer.from(`${env.twilio.accountSid}:${env.twilio.authToken}`).toString('base64');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: env.twilio.from, Body: body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new Error('SMS provider timed out');
    throw new Error('SMS provider unreachable');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) throw new Error(describeFailure(res.status, json));
  return { sid: json?.sid || null };
}

function buildMessage({ name, lat, lng, sosEvent, incident }) {
  const when = new Date(sosEvent.createdAt || Date.now()).toISOString();
  const ref = incident?._id ? ` Incident ref: ${String(incident._id).slice(-8)}.` : '';
  return (
    `SOS ALERT: ${name || 'A tourist'} has triggered an emergency alert at ${when}.${ref} ` +
    `Last known location: https://www.google.com/maps?q=${lat},${lng}`
  );
}

/**
 * Called from the SOS pipeline; never throws. Resolves a summary
 * { sent, failed, skipped } so callers/tests can await the outcome.
 */
async function notifyEmergencyContacts({ touristId, sosEvent, incident = null }) {
  const summary = { sent: 0, failed: 0, skipped: 0 };
  try {
    if (!isConfigured()) return summary;
    const [profile, user] = await Promise.all([
      TouristProfile.findOne({ user: touristId }).lean(),
      User.findById(touristId).select('name isDemo').lean(),
    ]);
    if (user?.isDemo) return summary; // simulated tourists never trigger real texts
    const { lat, lng } = sosEvent.location || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return summary;
    const body = buildMessage({ name: user?.name, lat, lng, sosEvent, incident });

    const seen = new Set();
    for (const contact of profile?.emergencyContacts || []) {
      const to = normalizePhone(contact.phone);
      if (seen.has(to)) {
        summary.skipped += 1; // same number listed twice
        continue;
      }
      seen.add(to);
      const record = {
        recipient: touristId,
        channel: 'sms',
        type: 'sos_alert',
        severity: 'critical',
        payload: { contact: contact.name, to, sosEvent: sosEvent._id },
        dedupeKey: `sms:${sosEvent._id}:${to}`,
      };
      let row;
      try {
        row = await Notification.create({ ...record, delivered: false });
      } catch (err) {
        if (err.code === 11000) {
          summary.skipped += 1; // already handled for this SOS
          continue;
        }
        console.error('[sms] could not record attempt:', err.message);
        continue;
      }
      try {
        if (!E164.test(to)) throw new Error('Invalid destination phone number');
        const { sid } = await sendSms(to, body);
        await Notification.updateOne({ _id: row._id }, { delivered: true, deliveredAt: new Date(), 'payload.providerSid': sid });
        summary.sent += 1;
      } catch (err) {
        await Notification.updateOne({ _id: row._id }, { delivered: false, error: err.message }).catch(() => {});
        summary.failed += 1;
        console.error('[sms] delivery failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[sms] notifyEmergencyContacts failed:', err.message);
  }
  return summary;
}

module.exports = { notifyEmergencyContacts, isConfigured, sendSms };
