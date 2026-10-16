const { Notification, TouristProfile, User } = require('../../models');
const env = require('../../config/env');

/**
 * SMS to a tourist's emergency contacts via Twilio's REST API (no SDK
 * dependency). Disabled until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
 * TWILIO_FROM are set — SOS still works without it. Twilio trial accounts
 * can only text numbers verified in the Twilio console.
 */

const isConfigured = () => Boolean(env.twilio.accountSid && env.twilio.authToken && env.twilio.from);

async function sendSms(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.twilio.accountSid}/Messages.json`;
  const auth = Buffer.from(`${env.twilio.accountSid}:${env.twilio.authToken}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: env.twilio.from, Body: body }),
  });
  if (!res.ok) {
    let msg = `Twilio ${res.status}`;
    try {
      msg = (await res.json()).message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

/** Fire-and-forget from the SOS pipeline; never throws. */
async function notifyEmergencyContacts({ touristId, sosEvent }) {
  try {
    if (!isConfigured()) return;
    const [profile, user] = await Promise.all([
      TouristProfile.findOne({ user: touristId }).lean(),
      User.findById(touristId).select('name').lean(),
    ]);
    const contacts = profile?.emergencyContacts || [];
    const { lat, lng } = sosEvent.location;
    const body =
      `SOS ALERT: ${user?.name || 'A tourist'} has triggered an emergency alert. ` +
      `Last known location: https://maps.google.com/?q=${lat},${lng}`;

    for (const contact of contacts) {
      const to = String(contact.phone).replace(/[\s()-]/g, '');
      const record = {
        recipient: touristId,
        channel: 'sms',
        type: 'sos_alert',
        payload: { contact: contact.name, to, sosEvent: sosEvent._id },
      };
      try {
        await sendSms(to, body);
        await Notification.create({ ...record, delivered: true, deliveredAt: new Date() });
      } catch (err) {
        await Notification.create({ ...record, delivered: false, error: err.message });
        console.error('[sms] failed for', contact.name, err.message);
      }
    }
  } catch (err) {
    console.error('[sms] notifyEmergencyContacts failed:', err.message);
  }
}

module.exports = { notifyEmergencyContacts, isConfigured };
