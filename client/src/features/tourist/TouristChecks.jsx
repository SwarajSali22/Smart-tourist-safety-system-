import { useEffect, useState } from 'react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import { formatDateTime, label } from '../../shared/utils/format.js';

const RESPONSE_BADGE = { safe: 'success', unsafe: 'danger', no_response: 'neutral' };

function TouristChecks() {
  const toast = useToast();
  const now = useNow(1000);
  const [check, setCheck] = useState(undefined); // undefined = loading
  const [config, setConfig] = useState(null);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/safety-checks/mine')
      .then((data) => { setCheck(data.safetyCheck); setConfig(data.config); })
      .catch(() => setCheck(null));
  }, []);

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    const onPrompt = (c) => setCheck(c);
    const onResponse = ({ safetyCheck }) => setCheck(safetyCheck);
    socket.on('safetycheck:prompt', onPrompt);
    socket.on('safetycheck:response', onResponse);
    return () => {
      socket.off('safetycheck:prompt', onPrompt);
      socket.off('safetycheck:response', onResponse);
    };
  }, []);

  useOnReconnect(() => {
    api.get('/safety-checks/mine').then((d) => { setCheck(d.safetyCheck); setConfig(d.config); }).catch(() => {});
  });

  const isPending = check && !check.respondedAt;
  let remaining = null;
  if (isPending && config) {
    const left = new Date(check.scheduledAt).getTime() + config.responseWindowMinutes * 60000 - now;
    remaining = left > 0 ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : null;
  }

  async function handleRespond(response) {
    setError('');
    setResponding(true);
    try {
      const data = await api.post(`/safety-checks/${check._id}/respond`, { response });
      setCheck(data.safetyCheck);
      if (response === 'safe') toast.success('Thanks — glad you’re safe.');
      else toast.warning('An admin has been alerted that you need help.', { title: 'Help requested' });
    } catch (err) {
      setError(err.message || 'Failed to respond');
    } finally {
      setResponding(false);
    }
  }

  return (
    <div className="app-page">
      <h1 className="page-title">Safety check-ins</h1>

      <Card>
        {error && <p className="form-error" role="alert">{error}</p>}

        {check === undefined ? (
          <p className="placeholder-text">Loading…</p>
        ) : check === null ? (
          <p className="placeholder-text">No safety checks yet — one will be prompted periodically while your device is active.</p>
        ) : isPending ? (
          <>
            <p className="sos-hint"><strong>Are you safe?</strong></p>
            <p className="form-hint">
              {remaining
                ? <>Please answer within <strong>{remaining}</strong>. If you don’t, we’ll treat it as an emergency.</>
                : 'The response window has passed. Answer now so we know you’re OK.'}
            </p>
            <div className="contact-actions">
              <button className="btn btn--primary" disabled={responding} onClick={() => handleRespond('safe')}>
                I’m safe
              </button>
              <button className="btn btn--danger" disabled={responding} onClick={() => handleRespond('unsafe')}>
                I need help
              </button>
            </div>
            <p className="form-hint mt-4">Choosing “I need help” alerts an admin right away.</p>
          </>
        ) : (
          <>
            <div className="status-row">
              <span>Last check-in</span>
              <Badge variant={RESPONSE_BADGE[check.response]}>{label(check.response)}</Badge>
            </div>
            <p className="form-hint mt-4">
              Asked {formatDateTime(check.scheduledAt)}
              {config ? ` · next one about ${config.intervalMinutes} minutes later while your device is active.` : '.'}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

export default TouristChecks;
