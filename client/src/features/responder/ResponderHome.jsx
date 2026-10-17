import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { useNow } from '../../shared/hooks/useNow.js';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { label, timeAgo } from '../../shared/utils/format.js';

const SEVERITY_BADGE = { low: 'neutral', medium: 'info', high: 'warning', critical: 'danger' };
const STATUS_BADGE = { open: 'danger', in_progress: 'warning', assigned: 'info', en_route: 'info', resolved: 'success', closed: 'neutral' };

/** A responder's home: only the incidents assigned to them (the server enforces the scope). */
function ResponderHome() {
  const { user } = useAuth();
  const now = useNow(30000);
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get(`/incidents?${showAll ? '' : 'active=1&'}limit=50&sort=severity&order=desc`)
    .then((d) => { setData(d); setError(''); })
    .catch((e) => setError(e.message || 'Could not load your assignments')), [showAll]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setData(null); load(); }, [load]);
  useOnReconnect(load);
  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    socket.on('incident:updated', load);
    return () => socket.off('incident:updated', load);
  }, [load]);

  const list = data?.incidents || [];

  return (
    <div className="app-page">
      <h1 className="page-title">My assignments</h1>
      <p className="page-subtitle">Hello {user?.name}. These are the incidents an admin assigned to you. Mark them En route and Resolved as you work.</p>

      <Card>
        <div className="table-toolbar">
          <div className="filter-row">
            <button type="button" className={`btn btn--sm ${!showAll ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setShowAll(false)} aria-pressed={!showAll}>Active</button>
            <button type="button" className={`btn btn--sm ${showAll ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setShowAll(true)} aria-pressed={showAll}>All (incl. finished)</button>
          </div>
        </div>
        {error && !data ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data ? (
          <SkeletonRows rows={4} />
        ) : list.length === 0 ? (
          <EmptyState icon={ClipboardList} title={showAll ? 'No assignments yet' : 'Nothing assigned to you right now'}>
            When an admin assigns you an incident you will get a notification and it will appear here.
          </EmptyState>
        ) : (
          <ul className="assign-list">
            {list.map((i) => (
              <li key={i._id} className="assign">
                <div className="assign__main">
                  <strong>{label(i.type)}: {i.tourist?.name || 'Unknown tourist'}</strong>
                  <span className="badge-row">
                    <Badge variant={SEVERITY_BADGE[i.severity]}>{label(i.severity)}</Badge>
                    <Badge variant={STATUS_BADGE[i.status]}>{label(i.status)}</Badge>
                    {i.overdue && <span className="badge badge--overdue">Overdue</span>}
                    {i.tourist?.isDemo && <Badge variant="info">Simulated</Badge>}
                  </span>
                  <small className="form-hint">Assigned {timeAgo(i.assignedAt || i.createdAt, now)}</small>
                </div>
                <Link className="btn btn--primary btn--sm" to={`/responder/incidents/${i._id}`}>Open</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default ResponderHome;
