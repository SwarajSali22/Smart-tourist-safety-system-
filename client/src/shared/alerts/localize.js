/**
 * Notifications are stored in English on the server (admins read English). For
 * tourists, known notification kinds are re-rendered from the i18n dictionary in
 * the language they picked; anything unknown falls back to the stored text.
 */
export function localizeNotification(n, i18n, role) {
  const fallback = { title: n.title || '', message: n.message || '' };
  if (role !== 'tourist' || !i18n) return fallback;
  const { t, label } = i18n;
  const p = n.payload || {};

  switch (n.type) {
    case 'geofence_violation':
      if (!p.zoneName) return fallback;
      return { title: t('alert.zone.title'), message: t(p.danger ? 'alert.zone.bodyDanger' : 'alert.zone.body', { zone: p.zoneName }) };
    case 'safety_check_prompt':
      return { title: t('alert.checkin.title'), message: t('alert.checkin.body') };
    case 'risk_escalation':
      return {
        title: t('alert.safety.title'),
        message: p.incidentType === 'no_response' ? t('alert.safety.noresponse') : t('alert.safety.risk'),
      };
    case 'incident_update': {
      const map = {
        in_progress: ['alert.help.title', 'alert.help.body'],
        assigned: ['alert.assigned.title', 'alert.assigned.body'],
        en_route: ['alert.enroute.title', 'alert.enroute.body'],
        resolved: ['alert.resolved.title', 'alert.resolved.body'],
      }[p.status];
      return map ? { title: t(map[0]), message: t(map[1]) } : fallback;
    }
    default:
      return label ? fallback : fallback;
  }
}
