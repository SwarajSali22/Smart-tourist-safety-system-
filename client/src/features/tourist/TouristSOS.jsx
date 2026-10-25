import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Check, Circle } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { retryFailed, sendOrQueue, useOfflineQueue } from '../../shared/offline/queue.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import { useI18n } from '../../shared/i18n/I18nContext.jsx';
import { useLocationSharing } from '../../shared/location/LocationSharingContext.jsx';
import { useNow } from '../../shared/hooks/useNow.js';
import { vibrate } from '../../shared/utils/haptics.js';
import { formatDateTime } from '../../shared/utils/format.js';

const SOS_BADGE = { active: 'danger', acknowledged: 'warning', resolved: 'success', false_alarm: 'neutral' };
const ARM_WINDOW_MS = 5000;
const STALE_LOCATION_SEC = 90; // an SOS uses the last location the server holds; warn when ours has stopped refreshing

/** One honest line about where the phone's GPS stands, so a refused SOS is never a surprise. Never invents a position. */
function describeLocation(loc, nowMs) {
  const { status, lastSentAt, error, otherDevice } = loc;
  if (status === 'sharing') {
    const age = lastSentAt ? Math.max(0, Math.round((nowMs - lastSentAt) / 1000)) : null;
    if (age !== null && age > STALE_LOCATION_SEC) return { warn: true, text: `Your location was last shared ${Math.round(age / 60)} min ago. Keep this screen open so it refreshes — an SOS uses the last location we have.` };
    return { warn: false, text: age === null ? 'Location: sharing.' : `Location: sharing — last sent ${age < 5 ? 'just now' : `${age} s ago`}.` };
  }
  if (status === 'waiting' || status === 'timeout') return { warn: true, text: 'Location: waiting for a GPS fix from your phone… An SOS needs a location to be sent.' };
  if (status === 'off') return { warn: true, text: 'Location sharing is off. Turn on “Share my location” on the Home page so an SOS can include where you are.' };
  if (status === 'denied') return { warn: true, text: 'Location permission is blocked, so no position can be sent. Allow location for this app in your phone settings.' };
  if (status === 'unavailable') return { warn: true, text: 'Your phone cannot get a GPS position right now. Move to a clearer spot (outdoors helps).' };
  if (status === 'unsupported') return { warn: true, text: 'This browser cannot share a location.' };
  if (status === 'tracker_blocked') return { warn: true, text: `Your phone’s GPS is NOT being recorded: tracker ${otherDevice?.deviceId || ''} is assigned to your account and has never reported. An SOS will be refused until an administrator removes it.` };
  if (status === 'wristband') return { warn: false, text: 'Location: provided by your wristband.' };
  if (status === 'error') return { warn: true, text: `Your location could not be sent to the server${error ? ` (${error})` : ''}. The last position the server has is used for an SOS.` };
  return null;
}

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
  const queue = useOfflineQueue();
  const { hash } = useLocation();
  const scrolledToStatus = useRef(false);
  const loc = useLocationSharing();
  const nowMs = useNow(5000);
  const locLine = describeLocation(loc, nowMs);
  const heldToast = useRef(null);
  const heldSos = queue.find((e) => e.kind === 'sos' && e.status === 'pending');
  const failedSos = queue.find((e) => e.kind === 'sos' && e.status === 'failed');
  const syncedSos = queue.filter((e) => e.kind === 'sos' && e.status === 'synced').length;

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
    api.get('/sos/mine').then((d) => setSosEvent(d.sosEvent)).catch(() => {});
    if (syncedSos > 0 && heldToast.current != null) {
      // The held request has now been confirmed by the server: replace the "not delivered" warning.
      toast.dismiss(heldToast.current);
      heldToast.current = null;
      toast.success('Your SOS has now been delivered to the server.', { title: 'Delivered' });
    }
  }, [syncedSos]); // eslint-disable-line react-hooks/exhaustive-deps

  useOnReconnect(() => {
    api.get('/sos/mine').then((d) => setSosEvent(d.sosEvent)).catch(() => {});
  });

  // Arriving from the banner's "View status" on another page (#sos-status): scroll to the status once it has rendered.
  useEffect(() => {
    if (hash !== '#sos-status' || !sosEvent || scrolledToStatus.current) return;
    scrolledToStatus.current = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => document.getElementById('sos-status')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));
  }, [hash, sosEvent]);

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
      const r = await sendOrQueue({ kind: 'sos', label: 'SOS emergency request', path: '/sos', body: { clientTriggeredAt: new Date().toISOString() }, queueOnGateway: true });
      if (r.status === 'queued') {
        // Never present this as sent: the server has not confirmed it. Retries reuse the same request id, so they cannot create a duplicate.
        setError('');
        heldToast.current = r.uncertain
          ? toast.warning('We could not confirm that your SOS was received. It may have reached the server. Retrying automatically. If you are in danger, call 112.', { title: 'Not confirmed yet', duration: 20000 })
          : toast.warning('Your SOS is saved on this device but has NOT been sent. It will be sent automatically when you are back online.', { title: 'Not delivered yet', duration: 15000 });
      } else {
        setSosEvent(r.data.sosEvent);
        toast.success(t('sos.toast.body'), { title: t('sos.toast.title') });
      }
    } catch (err) {
      // 409 = the server already has an active SOS for this tourist: that is delivery, not failure
      if (err.status === 409) {
        api.get('/sos/mine').then((d) => setSosEvent(d.sosEvent)).catch(() => {});
      } else {
        setError(err.message || t('sos.error'));
      }
    } finally {
      setTriggering(false);
    }
  }

  const acked = Boolean(sosEvent?.acknowledgedAt) || sosEvent?.status === 'acknowledged' || sosEvent?.status === 'resolved';
  const resolved = sosEvent?.status === 'resolved' || sosEvent?.status === 'false_alarm';

  return (
    <div className="app-page">
      <h1 className="page-title">{t('sos.title')}</h1>

      {(heldSos || failedSos) && (
        <div className={`callout ${failedSos && !heldSos ? 'callout--danger' : 'callout--warning'} sos-held reveal`} role="alert">
          {heldSos?.uncertain ? (
            <>
              <strong>Your SOS is NOT confirmed.</strong>
              <p>
                We could not confirm that the server received your SOS. It may have reached the server, so an administrator may already
                know — but do not rely on that. The app is retrying automatically with the same request, so retrying cannot create a duplicate.
              </p>
            </>
          ) : heldSos ? (
            <>
              <strong>Your SOS has NOT been sent yet.</strong>
              <p>There is no connection to the server, so the request is only stored on this device. It will be sent automatically as soon as you are back online. Until the server confirms it, no one has been alerted.</p>
            </>
          ) : failedSos?.uncertain ? (
            <>
              <strong>Your SOS could not be confirmed.</strong>
              <p>
                We could not reach the server after several tries, so we do not know whether your SOS was received. Trying again uses the same
                request, so it cannot create a duplicate.
              </p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => retryFailed(failedSos.id)}>Try again</button>
            </>
          ) : (
            <>
              <strong>Your SOS could not be sent.</strong>
              <p>{`The server did not accept the request${failedSos?.lastError ? ` (${failedSos.lastError})` : ''}. Retry from the sync indicator at the top of the page.`}</p>
            </>
          )}
          <p><strong>If you are in danger, call 112 (India's emergency number) or contact a person nearby directly.</strong></p>
        </div>
      )}

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
            {locLine && <p className={`${locLine.warn ? 'fld__hint--warn' : 'form-hint'} sos-center`} role="status">{locLine.text}</p>}
            <button
              className={`sos-big${armed ? ' sos-big--armed' : ''}`}
              onClick={handleSosClick}
              disabled={triggering || sosEvent === undefined || Boolean(heldSos)}
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
        <Card id="sos-status" title={isOpen ? t('sos.progress') : t('sos.last')} className="mt-4 sos-status-anchor">
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
