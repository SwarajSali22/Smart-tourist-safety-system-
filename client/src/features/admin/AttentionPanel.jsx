import { Link } from 'react-router-dom';
import { MapPin, ShieldCheck, Siren, TriangleAlert } from 'lucide-react';
import Badge from '../../shared/components/ui/Badge.jsx';
import { label, timeAgo } from '../../shared/utils/format.js';

const SOS_BADGE = { active: 'danger', acknowledged: 'warning' };

const isOpenSos = (e) => e.status === 'active' || e.status === 'acknowledged';
const isOpenIncident = (i) => ['open', 'in_progress', 'assigned', 'en_route'].includes(i.status);

/**
 * Top-of-dashboard "needs attention" list: active SOS events first, then any other
 * open critical incidents (the incident created by an SOS isn't listed twice).
 * Shows an "all clear" strip when there is nothing to act on.
 */
function AttentionPanel({ sosEvents, incidents, now }) {
  const activeSos = sosEvents.filter(isOpenSos);
  const sosIncidentIds = new Set(activeSos.map((e) => String(e.incident?._id || e.incident || '')));
  const criticalIncidents = incidents.filter((i) => i.severity === 'critical' && isOpenIncident(i) && !sosIncidentIds.has(String(i._id)));

  if (activeSos.length === 0 && criticalIncidents.length === 0) {
    return (
      <section className="attention attention--clear" aria-label="Needs attention">
        <ShieldCheck size={20} aria-hidden="true" />
        <span><strong>All clear.</strong> No active SOS and no open critical incidents.</span>
      </section>
    );
  }

  return (
    <section className="attention" aria-label="Needs attention">
      <h2 className="attention__title">
        <Siren size={18} aria-hidden="true" />
        Needs attention
        <span className="attention__count">{activeSos.length + criticalIncidents.length}</span>
      </h2>
      <ul className="attention__list">
        {activeSos.map((e) => (
          <li key={`s${e._id}`} className="attention__item">
            <span className="attention__icon attention__icon--sos"><Siren size={18} aria-hidden="true" /></span>
            <span className="attention__main">
              <strong>{e.tourist?.name || 'Unknown tourist'}</strong>
              <small>SOS · {label(e.source)} · {timeAgo(e.createdAt, now)}</small>
            </span>
            <Badge variant={SOS_BADGE[e.status]}>{label(e.status)}</Badge>
            <span className="attention__actions">
              {e.tourist?._id && (
                <Link className="btn btn--ghost btn--sm" to={`/admin/map?tourist=${e.tourist._id}`}><MapPin size={14} aria-hidden="true" /> Map</Link>
              )}
              <Link className="btn btn--danger btn--sm" to={e.incident ? `/admin/incidents/${e.incident._id || e.incident}` : '/admin/incidents'}>Respond</Link>
            </span>
          </li>
        ))}
        {criticalIncidents.map((i) => (
          <li key={`i${i._id}`} className="attention__item">
            <span className="attention__icon"><TriangleAlert size={18} aria-hidden="true" /></span>
            <span className="attention__main">
              <strong>{i.tourist?.name || 'Unknown tourist'}</strong>
              <small>{label(i.type)} · critical · {timeAgo(i.createdAt, now)}</small>
            </span>
            <Badge variant={i.status === 'open' ? 'danger' : 'warning'}>{label(i.status)}</Badge>
            <span className="attention__actions">
              {i.tourist?._id && (
                <Link className="btn btn--ghost btn--sm" to={`/admin/map?tourist=${i.tourist._id}`}><MapPin size={14} aria-hidden="true" /> Map</Link>
              )}
              <Link className="btn btn--primary btn--sm" to={`/admin/incidents/${i._id}`}>Open</Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default AttentionPanel;
