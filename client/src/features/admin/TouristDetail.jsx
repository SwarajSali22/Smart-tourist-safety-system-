import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin } from 'lucide-react';
import { api } from '../../api/client.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { RISK_VARIANT, formatDateTime, label, timeAgo } from '../../shared/utils/format.js';
import { SEVERITY_BADGE, STATUS_BADGE } from './Incidents.jsx';

function Empty({ children }) {
  return <p className="muted">{children}</p>;
}

/** Admin-only full picture of one tourist: risk, device, incidents, zone events, check-ins, contacts. */
function TouristDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get(`/tourists/${id}`)
    .then((d) => { setData(d); setError(''); })
    .catch((e) => setError(e.status === 404 ? 'This tourist does not exist.' : e.message)), [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useOnReconnect(load);

  const back = <Link to="/admin/tourists" className="btn btn--ghost btn--sm"><ArrowLeft size={16} /> Tourists</Link>;
  if (error) return <div>{back}<ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <div>{back}<SkeletonRows rows={6} /></div>;

  const { tourist: t, profile, device, risk, riskHistory, incidents, geofenceEvents, safetyChecks, sos } = data;

  return (
    <div className="app-page page-stack">
      {back}
      <h1 className="page-title">{t.name}</h1>
      <div className="badge-row">
        <Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
        {risk && <Badge variant={RISK_VARIANT[risk.level]}>{label(risk.level)} risk · {risk.score}</Badge>}
        {data.activeIncidents > 0 && <Badge variant="danger">{data.activeIncidents} active incident(s)</Badge>}
        <Link className="btn btn--ghost btn--sm" to={`/admin/map?tourist=${t._id}`}><MapPin size={16} /> View on map</Link>
      </div>

      <Card title="Profile">
        <p>{t.email}{t.phone ? ` · ${t.phone}` : ''}</p>
        {profile && <p className="muted">{[profile.nationality, profile.language].filter(Boolean).join(' · ') || '—'}</p>}
        <h4>Emergency contacts</h4>
        {profile?.emergencyContacts?.length
          ? <ul>{profile.emergencyContacts.map((c, i) => <li key={i}>{c.name} — {c.phone}{c.relationship ? ` (${c.relationship})` : ''}</li>)}</ul>
          : <Empty>No emergency contacts on file.</Empty>}
      </Card>

      <Card title="Device">
        {device
          ? <p>{device.deviceId} · last seen {device.lastSeen ? timeAgo(device.lastSeen) : 'never'}</p>
          : <Empty>No device assigned.</Empty>}
      </Card>

      <Card title="Risk history">
        {riskHistory?.length
          ? <ul>{riskHistory.map((r, i) => <li key={i}>{formatDateTime(r.evaluatedAt)} — <Badge variant={RISK_VARIANT[r.level]}>{label(r.level)}</Badge> {r.score}{r.ruleName ? ` (${r.ruleName})` : ''}</li>)}</ul>
          : <Empty>No risk assessments yet.</Empty>}
      </Card>

      <Card title="Incidents">
        {incidents?.length
          ? <ul>{incidents.map((i) => (
            <li key={i._id}><Link to={`/admin/incidents/${i._id}`}>{label(i.type)}</Link>{' '}
              <Badge variant={SEVERITY_BADGE[i.severity]}>{label(i.severity)}</Badge>{' '}
              <Badge variant={STATUS_BADGE[i.status]}>{label(i.status)}</Badge> · {formatDateTime(i.createdAt)}</li>
          ))}</ul>
          : <Empty>No incidents.</Empty>}
        {sos?.length > 0 && <p className="muted">{sos.length} recent SOS event(s), latest {formatDateTime(sos[0].createdAt)}.</p>}
      </Card>

      <Card title="Zone events">
        {geofenceEvents?.length
          ? <ul>{geofenceEvents.map((g) => <li key={g._id}>{formatDateTime(g.createdAt)} — {label(g.eventType || g.type || 'event')} {g.zone?.name || ''}</li>)}</ul>
          : <Empty>No zone activity.</Empty>}
      </Card>

      <Card title={`Safety check-ins${data.checkInRate != null ? ` · ${data.checkInRate}% answered` : ''}`}>
        {safetyChecks?.length
          ? <ul>{safetyChecks.map((c) => <li key={c._id}>{formatDateTime(c.scheduledAt)} — {c.respondedAt ? label(c.response || 'answered') : 'No response'}{c.escalated ? ' (escalated)' : ''}</li>)}</ul>
          : <Empty>No check-ins yet.</Empty>}
      </Card>
    </div>
  );
}

export default TouristDetail;
