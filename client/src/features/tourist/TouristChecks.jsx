import { useEffect, useState } from 'react';
import { sendOrQueue } from '../../shared/offline/queue.js';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import { useI18n } from '../../shared/i18n/I18nContext.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import { formatDateTime } from '../../shared/utils/format.js';

const RESPONSE_BADGE = { safe: 'success', unsafe: 'danger', no_response: 'neutral' };

function TouristChecks() {
  const { t, label } = useI18n();
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
      const r = await sendOrQueue({ kind: 'check_response', label: `Check-in answer: ${response}`, path: `/safety-checks/${check._id}/respond`, body: { response } });
      if (r.status === 'queued') {
        // Not delivered: only stored on this device until the connection returns.
        toast.warning('No connection — your answer is saved on this device and has not been sent yet. It will be sent automatically.', { title: 'Waiting to send' });
      } else {
        setCheck(r.data.safetyCheck);
        if (response === 'safe') toast.success(t('checks.toast.safe'));
        else toast.warning(t('checks.toast.help'), { title: t('checks.toast.helpTitle') });
      }
    } catch (err) {
      setError(err.message || t('checks.error'));
    } finally {
      setResponding(false);
    }
  }

  return (
    <div className="app-page">
      <h1 className="page-title">{t('checks.title')}</h1>

      <Card>
        {error && <p className="form-error" role="alert">{error}</p>}

        {check === undefined ? (
          <p className="placeholder-text">{t('common.loading')}</p>
        ) : check === null ? (
          <p className="placeholder-text">{t('checks.none')}</p>
        ) : isPending ? (
          <>
            <p className="sos-hint"><strong>{t('checks.areYouSafe')}</strong></p>
            {check.episodeAt && (
              <p className="form-hint">We haven’t received your location for a while. Confirm below, and keep “Share my location” on with the app open. If you are in danger, press SOS or call 112.</p>
            )}
            <p className="form-hint">
              {remaining ? t('checks.answerWithin', { time: remaining }) : t('checks.late')}
            </p>
            <div className="contact-actions">
              <button className="btn btn--primary" disabled={responding} onClick={() => handleRespond('safe')}>
                {t('checks.safe')}
              </button>
              <button className="btn btn--danger" disabled={responding} onClick={() => handleRespond('unsafe')}>
                {t('checks.help')}
              </button>
            </div>
            <p className="form-hint mt-4">{t('checks.helpHint')}</p>
          </>
        ) : (
          <>
            <div className="status-row">
              <span>{t('checks.last')}</span>
              <Badge variant={RESPONSE_BADGE[check.response]}>{label(check.response)}</Badge>
            </div>
            <p className="form-hint mt-4">
              {t('checks.asked', { when: formatDateTime(check.scheduledAt) })}
              {config ? t('checks.next', { n: config.intervalMinutes }) : ''}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

export default TouristChecks;
