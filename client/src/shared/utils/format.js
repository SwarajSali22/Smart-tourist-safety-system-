const LABELS = {
  // incident lifecycle (stored: open = New, in_progress = Acknowledged)
  open: 'New',
  in_progress: 'Acknowledged',
  assigned: 'Assigned',
  en_route: 'En route',
  closed: 'Closed',
  no_response: 'No response',
  risk_escalation: 'Risk escalation',
  geofence_violation: 'Geofence violation',
  false_alarm: 'False alarm',
  auto_no_response: 'Auto: missed check-in',
  auto_geofence: 'Auto: danger zone',
  auto_risk_critical: 'Auto: critical risk',
  button: 'Wristband button',
  app: 'App',
  sos: 'SOS',
  sos_triggered: 'SOS triggered',
  sos_resolved: 'SOS resolved',
  incident_opened: 'Incident opened',
  incident_resolved: 'Incident resolved',
  admin_action: 'Admin action',
};

/** Turns API enum values (`no_response`) into readable text ("No response"). */
export function label(value) {
  if (value == null || value === '') return '—';
  if (LABELS[value]) return LABELS[value];
  const spaced = String(value).replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatDateTime(date) {
  if (!date || Number.isNaN(new Date(date).getTime())) return '—';
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "just now", "3 min ago", "2 h ago", "4 d ago". `now` lets callers re-render on a tick. */
export function timeAgo(date, now = Date.now()) {
  if (!date) return 'never';
  if (Number.isNaN(new Date(date).getTime())) return 'unknown';
  const secs = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export const RISK_VARIANT = { low: 'success', medium: 'info', high: 'warning', critical: 'danger' };
export const RISK_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

/** Plain-language names for the risk-score factors the backend returns. */
export const FACTOR_LABELS = {
  safetyCheckScore: 'Safety check-ins',
  zoneRiskScore: 'Current zone',
  violationScore: 'Recent zone violations',
  incidentScore: 'Open incidents',
  movementScore: 'Movement pattern',
  connectivityScore: 'Device connectivity',
};

/** Where a tourist's position comes from: their phone's GPS or the wristband/simulator. */
export { sourceOf as sourceLabel } from './freshness.js';

/** A device with no telemetry for this long is shown as possibly offline. */
export const STALE_MS = 5 * 60 * 1000;
