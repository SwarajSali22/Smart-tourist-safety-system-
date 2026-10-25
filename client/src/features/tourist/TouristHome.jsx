import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useI18n } from '../../shared/i18n/I18nContext.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import LocationShareCard from '../../shared/location/LocationShareCard.jsx';
import { label as englishLabel, RISK_VARIANT } from '../../shared/utils/format.js';

const SOS_BADGE = { active: 'danger', acknowledged: 'warning', resolved: 'success', false_alarm: 'neutral' };
const CHECK_BADGE = { safe: 'success', unsafe: 'danger', no_response: 'neutral' };
const DEVICE_BADGE = { active: 'success', inactive: 'neutral', lost: 'warning', emergency: 'danger' };

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function TouristHome() {
  const { user } = useAuth();
  const { t, label, tOr, timeAgo } = useI18n();
  const now = useNow(1000);
  const [sosEvent, setSosEvent] = useState(undefined); // undefined = loading
  const [check, setCheck] = useState(undefined);
  const [checkConfig, setCheckConfig] = useState(null);
  const [device, setDevice] = useState(undefined); // undefined = loading, null = none linked
  const [risk, setRisk] = useState(undefined); // undefined = loading, null = none yet

  useEffect(() => {
    api.get('/sos/mine').then((data) => setSosEvent(data.sosEvent)).catch(() => setSosEvent(null));
    api.get('/safety-checks/mine').then((data) => { setCheck(data.safetyCheck); setCheckConfig(data.config); }).catch(() => setCheck(null));
    api.get('/tourists/me').then((data) => setDevice(data.profile?.device || null)).catch(() => setDevice(null));
    api.get('/risk/mine').then((data) => setRisk(data.riskAssessment)).catch(() => setRisk(null));
  }, []);

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    const onSos = (payload) => setSosEvent(payload.sosEvent || payload);
    const onCheckPrompt = (c) => setCheck(c);
    const onCheckResponse = ({ safetyCheck }) => setCheck(safetyCheck);
    const onRisk = (r) => setRisk(r);
    // The server pushes the tourist's own device whenever it records a position, so this card follows the phone's
    // first report (which creates the phone device) instead of staying on "not linked" from when the page opened.
    const onLocation = (d) => setDevice(d);
    socket.on('location:update', onLocation);
    socket.on('sos:triggered', onSos);
    socket.on('sos:updated', onSos);
    socket.on('safetycheck:prompt', onCheckPrompt);
    socket.on('safetycheck:response', onCheckResponse);
    socket.on('risk:updated', onRisk);
    return () => {
      socket.off('location:update', onLocation);
      socket.off('sos:triggered', onSos);
      socket.off('sos:updated', onSos);
      socket.off('safetycheck:prompt', onCheckPrompt);
      socket.off('safetycheck:response', onCheckResponse);
      socket.off('risk:updated', onRisk);
    };
  }, []);

  useOnReconnect(() => {
    api.get('/sos/mine').then((d) => setSosEvent(d.sosEvent)).catch(() => {});
    api.get('/safety-checks/mine').then((d) => { setCheck(d.safetyCheck); setCheckConfig(d.config); }).catch(() => {});
    api.get('/tourists/me').then((d) => setDevice(d.profile?.device || null)).catch(() => {});
    api.get('/risk/mine').then((d) => setRisk(d.riskAssessment)).catch(() => {});
  });

  const isOpen = sosEvent && sosEvent.status !== 'resolved' && sosEvent.status !== 'false_alarm';
  const isCheckPending = check && !check.respondedAt;

  // Countdown to the response deadline (pending) or approximate next check-in.
  let checkLine = null;
  if (isCheckPending && checkConfig) {
    const left = new Date(check.scheduledAt).getTime() + checkConfig.responseWindowMinutes * 60000 - now;
    checkLine = left > 0 ? t('home.check.deadline', { time: mmss(left) }) : t('home.check.late');
  } else if (check && checkConfig) {
    const next = new Date(check.scheduledAt).getTime() + checkConfig.intervalMinutes * 60000;
    checkLine = t('home.check.next', { time: new Date(next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  }

  const factors = risk?.factors
    ? Object.entries(risk.factors).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];
  const factorNames = factors.map(([k]) => tOr(`factor.${k}`, k)).join(', ');
  const ruleName = risk?.ruleName ? tOr(`rule.${risk.ruleName}`, englishLabel(risk.ruleName)) : '';
  const sourceName = device?.type === 'phone' ? t('home.device.phone') : device?.isSimulated ? t('home.device.simulator') : t('home.device.wristband');

  return (
    <div className="app-page">
      <h1 className="page-title">{t('home.title', { name: user?.name })}</h1>

      {isOpen && (
        <div className="callout callout--danger" role="status">
          <strong>{t('shell.sos.active')}</strong>{' '}
          {sosEvent.status === 'active' ? t('shell.sos.alerted') : t('shell.sos.responding')}{' '}
          <Link to="/tourist/sos">{t('shell.sos.view')}</Link>
        </div>
      )}

      <div className="tourist-status-grid">
        <Card title={t('home.safety.title')}>
          {risk === undefined ? (
            <SkeletonRows rows={2} />
          ) : risk === null ? (
            <>
              <div className="status-row"><span>{t('home.safety.current')}</span><Badge variant="neutral">{t('home.safety.notAssessed')}</Badge></div>
              <p className="placeholder-text mt-4">{t('home.safety.pending')}</p>
            </>
          ) : (
            <>
              <div className="status-row">
                <span>{t('home.safety.current')}</span>
                <Badge variant={RISK_VARIANT[risk.level]}>{risk.ruleTriggered ? label(risk.level) : `${label(risk.level)} · ${risk.score}/100`}</Badge>
              </div>
              <div className={`meter meter--${risk.level} mt-4`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={risk.ruleTriggered ? 100 : risk.score} aria-label={`${t('home.safety.current')}: ${label(risk.level)}`}>
                <span style={{ width: `${risk.ruleTriggered ? 100 : risk.score}%` }} />
              </div>
              <p className="placeholder-text mt-4">{t(`home.risk.${risk.level}`)}</p>
              {risk.ruleTriggered && (
                <p className="form-hint mt-4">{t('home.risk.auto', { rule: ruleName, when: timeAgo(risk.evaluatedAt, now) })}</p>
              )}
              {!risk.ruleTriggered && factors.length > 0 && (
                <p className="form-hint mt-4">{t('home.risk.factors', { factors: factorNames, when: timeAgo(risk.evaluatedAt, now) })}</p>
              )}
            </>
          )}
        </Card>

        <Card title={t('home.device.title')}>
          <div className="status-row">
            <span>{device ? sourceName : t('home.device.none')}</span>
            {device === undefined ? <Badge variant="neutral">{t('common.loading')}</Badge> : device ? (
              <Badge variant={DEVICE_BADGE[device.status] || 'neutral'}>{label(device.status)}</Badge>
            ) : (
              <Badge variant="neutral">{t('home.device.notLinked')}</Badge>
            )}
          </div>
          <p className="placeholder-text mt-4">
            {device
              ? t('home.device.lastSeen', { id: device.deviceId, when: device.lastSeen ? timeAgo(device.lastSeen, now) : t('time.never') })
              : device === null ? t('home.device.askPhone') : ''}
          </p>
        </Card>

        <Card title={t('home.check.title')}>
          {check === undefined ? (
            <SkeletonRows rows={2} />
          ) : isCheckPending ? (
            <>
              <p className="sos-hint"><strong>{t('home.check.waiting')}</strong></p>
              <p className="form-hint" aria-live="off">{checkLine}</p>
            </>
          ) : check ? (
            <>
              <div className="status-row"><span>{t('home.check.last')}</span><Badge variant={CHECK_BADGE[check.response]}>{label(check.response)}</Badge></div>
              {checkLine && <p className="form-hint mt-4">{checkLine}</p>}
            </>
          ) : (
            <p className="placeholder-text">{t('home.check.none')}</p>
          )}
          <Link className={`btn ${isCheckPending ? 'btn--primary' : 'btn--ghost'} btn--sm mt-4`} to="/tourist/checks">
            {isCheckPending ? t('home.check.answer') : t('home.check.open')}
          </Link>
        </Card>
      </div>

      <div className="tourist-sections">
        <LocationShareCard />

        <Card title={t('home.map.title')}>
          <p className="placeholder-text">{t('home.map.text')}</p>
          <Link className="btn btn--ghost btn--sm mt-4" to="/tourist/map">{t('home.map.open')}</Link>
        </Card>

        <Card title={t('home.sos.title')}>
          {isOpen ? (
            <div className="status-row" style={{ marginBottom: '12px' }}>
              <span>{t('home.sos.yours')}</span>
              <Badge variant={SOS_BADGE[sosEvent.status]}>{label(sosEvent.status)}</Badge>
            </div>
          ) : (
            <p className="sos-hint">{t('home.sos.hint')}</p>
          )}
          <Link className={`btn ${isOpen ? 'btn--ghost' : 'btn--danger'} btn--full`} to="/tourist/sos">
            {isOpen ? t('home.sos.viewStatus') : t('home.sos.open')}
          </Link>
        </Card>
      </div>
    </div>
  );
}

export default TouristHome;
