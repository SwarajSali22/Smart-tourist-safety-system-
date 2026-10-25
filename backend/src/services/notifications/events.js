const { User, Zone } = require('../../models');
const { notifyAdmins, notifyUser } = require('./notify');

const TYPE_LABEL = {
  sos: 'SOS',
  geofence_violation: 'Zone violation',
  no_response: 'Automated safety alert',
  risk_escalation: 'Risk escalation',
  other: 'Incident',
};

async function touristInfo(id) {
  const u = await User.findById(id).select('name isDemo').lean();
  return { name: u?.name || 'A tourist', isDemo: Boolean(u?.isDemo) };
}

/** An incident was created (any source): tell the admins, and warn the tourist if it concerns their safety. */
async function onIncidentCreated(incident) {
  const { name, isDemo } = await touristInfo(incident.tourist);
  const label = TYPE_LABEL[incident.type] || 'Incident';
  const critical = incident.severity === 'critical';
  await notifyAdmins({
    type: incident.type === 'sos' ? 'sos_alert' : incident.type === 'risk_escalation' ? 'risk_escalation' : 'incident_update',
    title: `${isDemo ? '[Simulated] ' : ''}${label}: ${name}`,
    message: incident.type === 'no_response'
      ? `${name} has not been heard from (no location or check-in). Automated alert, ${incident.severity} priority; this is not an SOS. Open it to review the last known position.`
      : `${label} (${incident.severity}) for ${name}. Open the incident to respond.`,
    link: `/admin/incidents/${incident._id}`,
    severity: critical ? 'critical' : 'warning',
    payload: { incident: incident._id, tourist: incident.tourist },
    dedupeKey: `incident:${incident._id}`,
    isDemo,
  });
  if (incident.type === 'risk_escalation' || incident.type === 'no_response') {
    await notifyUser(incident.tourist, {
      type: 'risk_escalation',
      title: 'Your safety level changed',
      message: incident.type === 'no_response'
        ? 'A safety check-in went unanswered. If you are safe, open the app and respond.'
        : 'Your risk level is elevated. Stay alert and consider moving to a safer area.',
      link: '/tourist',
      severity: 'warning',
      payload: { incident: incident._id, tourist: incident.tourist, incidentType: incident.type },
      dedupeKey: `incident-tourist:${incident._id}`,
      isDemo,
    });
  }
}

/** A tourist entered a non-safe zone: tell them (and the admins, unless the danger-zone SOS already covers it). */
async function onGeofenceEnter(event) {
  const zone = await Zone.findById(event.zone).select('name type').lean();
  if (!zone || zone.type === 'safe') return;
  const { name, isDemo } = await touristInfo(event.tourist);
  await notifyUser(event.tourist, {
    type: 'geofence_violation',
    title: `You entered ${zone.name}`,
    message: zone.type === 'danger' ? 'This is a danger zone — move to safety or press SOS.' : 'This is a restricted area. Please check the area rules.',
    link: '/tourist/map',
    severity: zone.type === 'danger' ? 'critical' : 'warning',
    payload: { geofenceEvent: event._id, zone: zone._id, tourist: event.tourist, zoneName: zone.name, danger: zone.type === 'danger' },
    dedupeKey: `geo-tourist:${event._id}`,
    isDemo,
  });
  if (zone.type !== 'danger') {
    await notifyAdmins({
      type: 'geofence_violation',
      title: `${isDemo ? '[Simulated] ' : ''}Zone violation: ${name}`,
      message: `${name} entered the restricted zone “${zone.name}”.`,
      link: `/admin/map?tourist=${event.tourist}`,
      severity: 'warning',
      payload: { geofenceEvent: event._id, zone: zone._id, tourist: event.tourist },
      dedupeKey: `geo:${event._id}`,
      isDemo,
    });
  }
}

/** A safety check-in is waiting for the tourist. */
async function onSafetyCheckCreated(check) {
  const { isDemo } = await touristInfo(check.tourist);
  await notifyUser(check.tourist, {
    type: 'safety_check_prompt',
    title: 'Safety check-in',
    message: check.episodeAt
      ? 'We have not received your location for a while. Please open Check-ins and confirm you are safe, and keep Share my location on.'
      : 'Please open Check-ins and tell us you are safe.',
    link: '/tourist/checks',
    severity: 'warning',
    payload: { safetyCheck: check._id, tourist: check.tourist },
    dedupeKey: `check:${check._id}`,
    isDemo,
  });
}

module.exports = { onIncidentCreated, onGeofenceEnter, onSafetyCheckCreated };
