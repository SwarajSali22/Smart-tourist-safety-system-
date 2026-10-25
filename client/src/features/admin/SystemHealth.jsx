import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useSocketStatus } from '../../shared/socket/useSocketStatus.js';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { formatDateTime, label } from '../../shared/utils/format.js';

const VARIANT = { healthy: 'success', degraded: 'warning', unavailable: 'danger', unknown: 'neutral' };
const NAMES = {
  api: 'Backend API', database: 'Database', realtime: 'Real-time (Socket.IO)', sms: 'SMS alerts', devices: 'Device locations', scheduler: 'Background scheduler',
};
const BROWSER = { live: ['healthy', 'Connected'], reconnecting: ['degraded', 'Reconnecting…'], offline: ['unavailable', 'Offline'] };

/** Admin-only diagnostics: GET /api/health/details (real checks, cached server-side for 10 s). */
function SystemHealth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const socketStatus = useSocketStatus();

  const load = useCallback(() => {
    setLoading(true);
    return api.get('/health/details')
      .then((d) => { setData(d); setError(''); })
      .catch((e) => setError(e.message || 'Could not load system health'))
      .finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (error && !data) return <div className="app-page"><h1 className="page-title">System health</h1><ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <div className="app-page"><h1 className="page-title">System health</h1><SkeletonRows rows={6} /></div>;

  const [bStatus, bText] = BROWSER[socketStatus] || BROWSER.offline;
  return (
    <div className="app-page">
      <h1 className="page-title">System health</h1>
      <p className="page-subtitle">
        <Badge variant={VARIANT[data.overall]}>{label(data.overall)}</Badge>{' '}
        · last checked {formatDateTime(data.checkedAt)}{' '}
        <button type="button" className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>{loading ? 'Checking…' : 'Check now'}</button>
        {error && <span className="form-hint"> · refresh failed: {error}</span>}
      </p>

      <Card title="Components">
        <ul className="activity">
          {Object.entries(data.components).map(([key, c]) => (
            <li key={key}>
              <div className="status-row">
                <strong>{NAMES[key] || key}</strong>
                <Badge variant={VARIANT[c.status]}>{label(c.status)}</Badge>
              </div>
              <p className="form-hint">{c.message}</p>
              {key === 'database' && c.latencyMs != null && <p className="form-hint">Ping {c.latencyMs} ms</p>}
              {key === 'realtime' && c.connectedClients != null && <p className="form-hint">{c.connectedClients} connected client(s)</p>}
              {key === 'scheduler' && c.lastRunAt && <p className="form-hint">Last sweep {formatDateTime(c.lastRunAt)} ({c.lastDurationMs} ms) · {c.runs} run(s), {c.failures} failed</p>}
              {key === 'sms' && c.last24h && <p className="form-hint">Last 24 h: {c.last24h.acceptedByProvider} accepted by provider, {c.last24h.failed} failed. {c.note}.</p>}
            </li>
          ))}
          <li>
            <div className="status-row">
              <strong>This browser’s live connection</strong>
              <Badge variant={VARIANT[bStatus]}>{bText}</Badge>
            </div>
          </li>
        </ul>
      </Card>

      <Card title="Recent problems" className="mt-4">
        {data.recentFailures.length === 0 ? (
          <EmptyState title="No recent problems">Nothing is degraded or failing right now.</EmptyState>
        ) : (
          <ul className="activity">
            {data.recentFailures.map((f, i) => (
              <li key={i}><strong>{NAMES[f.component] || f.component}</strong> <span className="form-hint">{f.at ? formatDateTime(f.at) : 'now'}</span><p className="activity__note">{f.message}</p></li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default SystemHealth;
