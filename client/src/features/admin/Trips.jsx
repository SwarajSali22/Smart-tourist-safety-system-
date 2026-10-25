import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useNow } from '../../shared/hooks/useNow.js';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import DataTable from '../../shared/components/ui/DataTable.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { formatDateTime, label, timeAgo } from '../../shared/utils/format.js';

const STATUS_VARIANT = { planned: 'info', active: 'success', completed: 'neutral', cancelled: 'neutral' };
const SOURCE = { simulated: ['info', 'Simulated device'], phone: ['neutral', 'Phone GPS'], wristband: ['neutral', 'Wristband'], none: ['neutral', 'No device'] };
const FILTERS = [['active', 'Active trips'], ['overdue', 'Needs attention'], ['all', 'All trips']];

/** Admin view of tourists' trips: who is out on a trip, which stops/check-ins are overdue. Read-only. */
function Trips() {
  const now = useNow(30000);
  const [filter, setFilter] = useState('active');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const qs = filter === 'active' ? '?active=1' : filter === 'overdue' ? '?overdue=1' : '';
    return api.get(`/trips${qs}`).then((d) => { setRows(d.trips || []); setError(''); }).catch((e) => setError(e.message || 'Could not load trips'));
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRows(null); load(); }, [load]);
  useOnReconnect(load);
  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    socket.on('trip:alert', load);
    return () => socket.off('trip:alert', load);
  }, [load]);

  const columns = useMemo(() => [
    { key: 'tourist', header: 'Tourist', render: (t) => (t.tourist?._id ? <Link to={`/admin/tourists/${t.tourist._id}`}>{t.tourist.name}</Link> : '—') },
    { key: 'trip', header: 'Trip', render: (t) => <span><strong>{t.name}</strong><small className="form-hint block">{t.destination}</small></span> },
    { key: 'status', header: 'Status', render: (t) => <Badge variant={STATUS_VARIANT[t.status]}>{label(t.status)}</Badge> },
    { key: 'progress', header: 'Stops reached', render: (t) => `${t.stops.filter((s) => s.status === 'arrived').length}/${t.stops.length}` },
    { key: 'window', header: 'Window', render: (t) => <span>{formatDateTime(t.startAt)}<small className="form-hint block">to {formatDateTime(t.endAt)}</small></span> },
    { key: 'attention', header: 'Attention', render: (t) => {
      const open = t.alerts.filter((a) => !a.acknowledged);
      const next = t.checkInEveryMin && t.nextCheckInDue && t.status === 'active' ? new Date(t.nextCheckInDue) : null;
      return (
        <span className="badge-row">
          {t.overdueStops > 0 && t.status === 'active' && <span className="badge badge--overdue">{t.overdueStops} stop(s) overdue</span>}
          {open.map((a, i) => <span key={i} className="badge badge--escalated" title={a.message}>{label(a.kind)}</span>)}
          {!open.length && !(t.overdueStops > 0 && t.status === 'active') && <span className="form-hint">{next ? `Check-in ${next < now ? 'was due' : 'due'} ${timeAgo(next, now)}` : 'None'}</span>}
        </span>
      );
    } },
    { key: 'source', header: 'Location data', render: (t) => <Badge variant={SOURCE[t.trackingSource]?.[0] || 'neutral'}>{SOURCE[t.trackingSource]?.[1] || '—'}</Badge> },
  ], [now]);

  return (
    <div className="app-page page-stack">
      <div>
        <h1 className="page-title">Trips</h1>
        <p className="page-subtitle">Tourists’ planned itineraries. Missed stops and check-ins appear here as warnings — they never raise an SOS on their own.</p>
      </div>
      <Card>
        <div className="segmented" role="tablist" aria-label="Trip filter">
          {FILTERS.map(([v, t]) => <button key={v} type="button" role="tab" aria-selected={filter === v} className={`segmented__btn${filter === v ? ' is-active' : ''}`} onClick={() => setFilter(v)}>{t}</button>)}
        </div>
        {error && !rows ? <ErrorState message={error} onRetry={load} /> : !rows ? <SkeletonRows rows={5} /> : (
          <DataTable
            columns={columns} rows={rows} rowKey={(t) => t._id} caption="Trips"
            emptyIcon={CalendarClock} emptyTitle={filter === 'overdue' ? 'Nothing needs attention' : 'No trips here'}
            emptyText={filter === 'overdue' ? 'No active trip has an overdue stop or an unanswered warning.' : 'Trips appear once tourists plan them.'}
          />
        )}
      </Card>
    </div>
  );
}

export default Trips;
