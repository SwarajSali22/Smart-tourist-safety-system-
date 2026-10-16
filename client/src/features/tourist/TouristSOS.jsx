import { useEffect, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import { formatDateTime, label } from '../../shared/utils/format.js';

const SOS_BADGE = { active: 'danger', acknowledged: 'warning', resolved: 'success', false_alarm: 'neutral' };
const ARM_WINDOW_MS = 5000;

function Step({ done, current, title, time }) {
  return (
    <li className={`stepper__item${done ? ' stepper__item--done' : ''}${current ? ' stepper__item--current' : ''}`} aria-current={current ? 'step' : undefined}>
      <span className="stepper__dot" aria-hidden="true">{done ? <Check size={14} /> : <Circle size={10} />}</span>
      <span>
        <strong>{title}</strong>
        <small className="form-hint block">{time ? formatDateTime(time) : done ? '' : 'Waiting…'}</small>
      </span>
      <span className="sr-only">{done ? ' — done' : current ? ' — in progress' : ' — pending'}</span>
    </li>
  );
}

function TouristSOS() {
  const toast = useToast();
  const [sosEvent, setSosEvent] = useState(undefined); // undefined = loading
  const [armed, setArmed] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/sos/mine').then((data) => setSosEvent(data.sosEvent)).catch(() => setSosEvent(null));
  }, []);

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    function onSos(payload) {
      setSosEvent(payload.sosEvent || payload);
    }
    socket.on('sos:triggered', onSos);
    socket.on('sos:updated', onSos);
    return () => {
      socket.off('sos:triggered', onSos);
      socket.off('sos:updated', onSos);
    };
  }, []);

  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), ARM_WINDOW_MS);
    return () => clearTimeout(id);
  }, [armed]);

  const isOpen = sosEvent && sosEvent.status !== 'resolved' && sosEvent.status !== 'false_alarm';

  async function handleSosClick() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setError('');
    setTriggering(true);
    try {
      const data = await api.post('/sos', {});
      setSosEvent(data.sosEvent);
      toast.success('SOS sent. An admin has been alerted.', { title: 'Help requested' });
    } catch (err) {
      setError(err.message || 'Failed to trigger SOS');
    } finally {
      setTriggering(false);
    }
  }

  const acked = Boolean(sosEvent?.acknowledgedAt) || sosEvent?.status === 'acknowledged' || sosEvent?.status === 'resolved';
  const resolved = sosEvent?.status === 'resolved' || sosEvent?.status === 'false_alarm';

  return (
    <div className="app-page">
      <h1 className="page-title">Emergency SOS</h1>

      <Card>
        {error && <p className="form-error" role="alert">{error}</p>}

        {isOpen ? (
          <>
            <div className="status-row" style={{ marginBottom: '12px' }}>
              <span>Status</span>
              <Badge variant={SOS_BADGE[sosEvent.status]}>{label(sosEvent.status)}</Badge>
            </div>
            <p className="sos-hint" role="status" aria-live="polite">
              {sosEvent.status === 'active'
                ? 'Help has been alerted. An admin will acknowledge shortly — stay where you are if it is safe.'
                : 'An admin has acknowledged your SOS and is responding.'}
            </p>
            <button className="btn btn--danger btn--full btn--sos" disabled>SOS already active</button>
          </>
        ) : (
          <>
            <p className="sos-hint" aria-live="polite">
              {armed ? 'Tap again to confirm — this alerts an admin immediately.' : 'Press in an emergency. You will be asked to confirm.'}
            </p>
            <button
              className={`btn btn--danger btn--full btn--sos${armed ? ' btn--armed' : ''}`}
              onClick={handleSosClick}
              disabled={triggering || sosEvent === undefined}
            >
              {triggering ? 'Sending…' : armed ? 'Tap again to confirm SOS' : 'Trigger SOS'}
            </button>
            {armed && (
              <button className="btn btn--ghost btn--full mt-4" onClick={() => setArmed(false)}>Cancel</button>
            )}
          </>
        )}
      </Card>

      {sosEvent && (
        <Card title={isOpen ? 'Progress' : 'Your last SOS'} className="mt-4">
          <ol className="stepper">
            <Step done title="SOS sent" time={sosEvent.createdAt} />
            <Step done={acked} current={!acked && !resolved} title="Acknowledged by an admin" time={sosEvent.acknowledgedAt} />
            <Step done={resolved} current={acked && !resolved} title="Resolved" time={sosEvent.resolvedAt} />
          </ol>
          {sosEvent.resolutionNote && <p className="form-hint mt-4">Note from admin: {sosEvent.resolutionNote}</p>}
        </Card>
      )}
    </div>
  );
}

export default TouristSOS;
