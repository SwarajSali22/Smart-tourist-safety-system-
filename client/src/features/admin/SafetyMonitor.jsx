import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import { formatDateTime } from '../../shared/utils/format.js';

// Server-computed status (backend services/safetyCheck/workflow.js). "Live" is only a fix from the last 2 minutes.
const STATUS = {
  live: { text: 'Live', variant: 'success' },
  last_known: { text: 'Last known', variant: 'warning' },
  overdue: { text: 'Overdue', variant: 'danger' },
  unavailable: { text: 'Location unavailable', variant: 'neutral' },
};
const STAGE = { overdue: 'Overdue (not yet asked)', requested: 'Check-in requested', escalated: 'Safety alert raised' };
const ORDER = { overdue: 0, last_known: 1, unavailable: 2, live: 3 };

const ago = (min) => (min == null ? '—' : min < 1 ? 'just now' : `${min} min ago`);

/**
 * Per-tourist silence-clock view: last GPS and last check-in are separate, an old position is never "Live", and
 * the app being connected (socket) is shown apart from how fresh the position is. Refreshes every minute.
 */
function SafetyMonitor() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api.get('/safety-checks/status')
    .then((d) => { setData(d); setError(''); })
    .catch((e) => setError(e.message || 'Could not load the safety monitor')), []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    const socket = connectSocket(tokens.getAccess());
    const events = ['safety:overdue', 'safetycheck:prompt', 'safetycheck:missed', 'safetycheck:response', 'safetycheck:recovered'];
    events.forEach((e) => socket.on(e, load));
    return () => { clearInterval(timer); events.forEach((e) => socket.off(e, load)); };
  }, [load]);
  useOnReconnect(load);

  const rows = [...(data?.rows || [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const t = data?.thresholds;

  return (
    <Card title="Check-in monitor" className="mt-4">
      <p className="form-hint">
        {t ? `No GPS update or check-in for ${t.overdueMinutes} min = overdue; ${t.requestMinutes} min = the tourist is asked to confirm they are safe; ${t.escalateMinutes} min = an automated safety alert for you to review. ` : ''}
        This is not an SOS, and a phone with the app closed cannot report, so a gap is a reason to check, not proof of danger.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {data && rows.length === 0 && <p className="placeholder-text">No tourists are being tracked yet.</p>}
      {rows.length > 0 && (
        <div className="table-wrap mt-4">
          <table className="table">
            <thead>
              <tr><th>Tourist</th><th>Status</th><th>Last GPS</th><th>Last check-in</th><th>Workflow</th><th>App</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = STATUS[r.status];
                return (
                  <tr key={r.tourist._id}>
                    <td data-label="Tourist"><Link to={`/admin/tourists/${r.tourist._id}`}>{r.tourist.name}</Link></td>
                    <td data-label="Status"><Badge variant={s.variant}>{s.text}</Badge></td>
                    <td data-label="Last GPS">
                      {r.lastGpsAt ? <>{ago(r.gpsAgeMin)}<small className="form-hint block">{formatDateTime(r.lastGpsAt)}{r.lastLocation ? ` · ${r.lastLocation.lat.toFixed(4)}, ${r.lastLocation.lng.toFixed(4)}` : ''}{r.status !== 'live' && r.lastGpsAt ? ' (last known)' : ''}</small></> : 'Never'}
                    </td>
                    <td data-label="Last check-in">{r.lastCheckInAt ? formatDateTime(r.lastCheckInAt) : 'None'}</td>
                    <td data-label="Workflow">
                      {r.episode ? (
                        <>
                          {STAGE[r.episode.stage]}
                          {r.episode.incident && <> · <Link to={`/admin/incidents/${r.episode.incident}`}>open alert</Link></>}
                          {r.episode.delivery?.note && <small className="form-hint block">{r.episode.delivery.note}</small>}
                        </>
                      ) : '—'}
                    </td>
                    <td data-label="App">{r.socketConnected ? 'Connected' : 'Not connected'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default SafetyMonitor;
