import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useNow } from '../../shared/hooks/useNow.js';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import LocationShareCard from '../../shared/location/LocationShareCard.jsx';
import { FACTOR_LABELS, label, RISK_VARIANT, timeAgo } from '../../shared/utils/format.js';

const SOS_BADGE = { active: 'danger', acknowledged: 'warning', resolved: 'success', false_alarm: 'neutral' };
const CHECK_BADGE = { safe: 'success', unsafe: 'danger', no_response: 'neutral' };
const DEVICE_BADGE = { active: 'success', inactive: 'neutral', lost: 'warning', emergency: 'danger' };

const RISK_MESSAGE = {
  low: 'Everything looks normal. Enjoy your trip.',
  medium: 'Some caution advised. Stay on well-used routes.',
  high: 'Elevated risk. Stay alert and consider moving to a safer area.',
  critical: 'Critical risk. If you need help, press SOS now.',
};

function TouristHome() {
  const { user } = useAuth();
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
    socket.on('sos:triggered', onSos);
    socket.on('sos:updated', onSos);
    socket.on('safetycheck:prompt', onCheckPrompt);
    socket.on('safetycheck:response', onCheckResponse);
    socket.on('risk:updated', onRisk);
    return () => {
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
    checkLine = left > 0
      ? `Please answer within ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`
      : 'Response window has passed — answer now to avoid an alert.';
  } else if (check && checkConfig) {
    const next = new Date(check.scheduledAt).getTime() + checkConfig.intervalMinutes * 60000;
    checkLine = `Next check-in around ${new Date(next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (while your device is active)`;
  }

  const factors = risk?.factors
    ? Object.entries(risk.factors).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];

  return (
    <div className="app-page">
      <h1 className="page-title">Hello, {user?.name}</h1>

      {isOpen && (
        <div className="callout callout--danger" role="status">
          <strong>Your SOS is {label(sosEvent.status).toLowerCase()}.</strong>{' '}
          {sosEvent.status === 'active' ? 'Help has been alerted.' : 'An admin is responding.'}{' '}
          <Link to="/tourist/sos">View status</Link>
        </div>
      )}

      <div className="tourist-status-grid">
        <Card title="Safety status">
          {risk === undefined ? (
            <SkeletonRows rows={2} />
          ) : risk === null ? (
            <>
              <div className="status-row"><span>Current risk level</span><Badge variant="neutral">Not assessed yet</Badge></div>
              <p className="placeholder-text mt-4">Your risk level appears once your device starts reporting its location.</p>
            </>
          ) : (
            <>
              <div className="status-row">
                <span>Current risk level</span>
                <Badge variant={RISK_VARIANT[risk.level]}>{risk.ruleTriggered ? label(risk.level) : `${label(risk.level)} · ${risk.score}/100`}</Badge>
              </div>
              <div className={`meter meter--${risk.level} mt-4`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={risk.ruleTriggered ? 100 : risk.score} aria-label={risk.ruleTriggered ? 'Risk raised automatically' : `Risk score ${risk.score} of 100`}>
                <span style={{ width: `${risk.ruleTriggered ? 100 : risk.score}%` }} />
              </div>
              <p className="placeholder-text mt-4">{RISK_MESSAGE[risk.level]}</p>
              {risk.ruleTriggered && (
                <p className="form-hint mt-4">Raised automatically: {label(risk.ruleName)}. Updated {timeAgo(risk.evaluatedAt, now)}.</p>
              )}
              {!risk.ruleTriggered && factors.length > 0 && (
                <p className="form-hint mt-4">
                  Main factors: {factors.map(([k]) => FACTOR_LABELS[k] || k).join(', ')}. Updated {timeAgo(risk.evaluatedAt, now)}.
                </p>
              )}
            </>
          )}
        </Card>

        <Card title="Device">
          <div className="status-row">
            <span>Wristband</span>
            {device === undefined ? <Badge variant="neutral">Loading…</Badge> : device ? (
              <Badge variant={DEVICE_BADGE[device.status] || 'neutral'}>{label(device.status)}</Badge>
            ) : (
              <Badge variant="neutral">Not linked</Badge>
            )}
          </div>
          <p className="placeholder-text mt-4">
            {device
              ? `${device.deviceId} — last seen ${device.lastSeen ? timeAgo(device.lastSeen, now) : 'never'}`
              : device === null ? 'Ask an admin to register a tracking device for you.' : ''}
          </p>
        </Card>

        <Card title="Next safety check">
          {check === undefined ? (
            <SkeletonRows rows={2} />
          ) : isCheckPending ? (
            <>
              <p className="sos-hint"><strong>A check-in is waiting for your response.</strong></p>
              <p className="form-hint" aria-live="off">{checkLine}</p>
            </>
          ) : check ? (
            <>
              <div className="status-row"><span>Last check-in</span><Badge variant={CHECK_BADGE[check.response]}>{label(check.response)}</Badge></div>
              {checkLine && <p className="form-hint mt-4">{checkLine}</p>}
            </>
          ) : (
            <p className="placeholder-text">No check-ins yet — the first one is sent once your device is active.</p>
          )}
          <Link className={`btn ${isCheckPending ? 'btn--primary' : 'btn--ghost'} btn--sm mt-4`} to="/tourist/checks">
            {isCheckPending ? 'Answer now' : 'Open check-ins'}
          </Link>
        </Card>
      </div>

      <div className="tourist-sections">
        <LocationShareCard />

        <Card title="Live map">
          <p className="placeholder-text">See your location and nearby safe, restricted and danger zones.</p>
          <Link className="btn btn--ghost btn--sm mt-4" to="/tourist/map">Open map</Link>
        </Card>

        <Card title="SOS">
          {isOpen ? (
            <div className="status-row" style={{ marginBottom: '12px' }}>
              <span>Your SOS is</span>
              <Badge variant={SOS_BADGE[sosEvent.status]}>{label(sosEvent.status)}</Badge>
            </div>
          ) : (
            <p className="sos-hint">Press in an emergency to alert an admin and your emergency contacts immediately.</p>
          )}
          <Link className={`btn ${isOpen ? 'btn--ghost' : 'btn--danger'} btn--full`} to="/tourist/sos">
            {isOpen ? 'View SOS status' : 'Open SOS'}
          </Link>
        </Card>
      </div>
    </div>
  );
}

export default TouristHome;
