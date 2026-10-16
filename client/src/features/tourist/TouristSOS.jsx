import { useEffect, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import { useI18n } from '../../shared/i18n/I18nContext.jsx';
import { vibrate } from '../../shared/utils/haptics.js';
import { formatDateTime } from '../../shared/utils/format.js';

const SOS_BADGE = { active: 'danger', acknowledged: 'warning', resolved: 'success', false_alarm: 'neutral' };
const ARM_WINDOW_MS = 5000;

function Step({ done, current, title, time, t }) {
  return (
    <li className={`stepper__item${done ? ' stepper__item--done' : ''}${current ? ' stepper__item--current' : ''}`} aria-current={current ? 'step' : undefined}>
      <span className="stepper__dot" aria-hidden="true">{done ? <Check size={14} /> : <Circle size={10} />}</span>
      <span>
        <strong>{title}</strong>
        <small className="form-hint block">{time ? formatDateTime(time) : done ? '' : t('sos.step.waiting')}</small>
      </span>
      <span className="sr-only">{done ? t('sos.step.done') : current ? t('sos.step.current') : t('sos.step.pending')}</span>
    </li>
  );
}

function TouristSOS() {
  const { t, label } = useI18n();
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

  useOnReconnect(() => {
    api.get('/sos/mine').then((d) => setSosEvent(d.sosEvent)).catch(() => {});
  });

  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), ARM_WINDOW_MS);
    return () => clearTimeout(id);
  }, [armed]);

  const isOpen = sosEvent && sosEvent.status !== 'resolved' && sosEvent.status !== 'false_alarm';

  async function handleSosClick() {
    if (!armed) {
      setArmed(true);
      vibrate(80); // short tick: armed
      return;
    }
    setArmed(false);
    setError('');
    setTriggering(true);
    vibrate([250, 100, 250]); // longer pattern: sending
    try {
      const data = await api.post('/sos', {});
      setSosEvent(data.sosEvent);
      toast.success(t('sos.toast.body'), { title: t('sos.toast.title') });
    } catch (err) {
      setError(err.message || t('sos.error'));
    } finally {
      setTriggering(false);
    }
  }

  const acked = Boolean(sosEvent?.acknowledgedAt) || sosEvent?.status === 'acknowledged' || sosEvent?.status === 'resolved';
  const resolved = sosEvent?.status === 'resolved' || sosEvent?.status === 'false_alarm';

  return (
    <div className="app-page">
      <h1 className="page-title">{t('sos.title')}</h1>

      <Card>
        {error && <p className="form-error" role="alert">{error}</p>}

        {isOpen ? (
          <>
            <div className="status-row" style={{ marginBottom: '12px' }}>
              <span>{t('sos.status')}</span>
              <Badge variant={SOS_BADGE[sosEvent.status]}>{label(sosEvent.status)}</Badge>
            </div>
            <p className="sos-hint sos-center" role="status" aria-live="polite">
              {sosEvent.status === 'active' ? t('sos.msg.active') : t('sos.msg.acknowledged')}
            </p>
            <div className="sos-stage">
              <button className="sos-big sos-big--done" disabled>
                <span className="sos-big__label sos-big__label--sm">{t('sos.already')}</span>
              </button>
            </div>
          </>
        ) : (
          <div className="sos-stage">
            <p className="sos-hint sos-center" aria-live="polite">
              {armed ? t('sos.hintArmed') : t('sos.hint')}
            </p>
            <button
              className={`sos-big${armed ? ' sos-big--armed' : ''}`}
              onClick={handleSosClick}
              disabled={triggering || sosEvent === undefined}
              aria-label={armed ? t('sos.buttonArmed') : t('sos.button')}
            >
              <span className={`sos-big__label${armed || triggering ? ' sos-big__label--sm' : ''}`}>
                {triggering ? t('sos.sending') : armed ? t('sos.buttonArmed') : t('sos.button')}
              </span>
            </button>
            {armed && (
              <button className="btn btn--ghost sos-cancel" onClick={() => setArmed(false)}>{t('sos.cancel')}</button>
            )}
          </div>
        )}
      </Card>

      {sosEvent && (
        <Card title={isOpen ? t('sos.progress') : t('sos.last')} className="mt-4">
          <ol className="stepper">
            <Step t={t} done title={t('sos.step.sent')} time={sosEvent.createdAt} />
            <Step t={t} done={acked} current={!acked && !resolved} title={t('sos.step.ack')} time={sosEvent.acknowledgedAt} />
            <Step t={t} done={resolved} current={acked && !resolved} title={t('sos.step.resolved')} time={sosEvent.resolvedAt} />
          </ol>
          {sosEvent.resolutionNote && <p className="form-hint mt-4">{t('sos.note', { note: sosEvent.resolutionNote })}</p>}
        </Card>
      )}
    </div>
  );
}

export default TouristSOS;
