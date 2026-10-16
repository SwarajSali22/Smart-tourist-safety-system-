import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../socket/socket.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useOnReconnect } from '../socket/useSocketStatus.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { RISK_RANK } from '../utils/format.js';

const AlertsContext = createContext(null);

function readMuted() {
  try { return localStorage.getItem('alertsMuted') === '1'; } catch { return false; }
}

// Two-tone beep via WebAudio — no asset to ship. Browsers may block audio until
// the user has interacted with the page once; failure is silently ignored.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.18);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* audio unavailable */ }
}

const isOpen = (e) => e && (e.status === 'active' || e.status === 'acknowledged');

/**
 * Live alert layer shared by both roles (mounted once by AppShell).
 *  - admin:   SOS, zone violations, missed / "unsafe" check-ins, risk escalations
 *             on every page, plus the set of active SOS for the red banner.
 *  - tourist: own zone alerts, check-in prompts, SOS progress, rising risk, plus
 *             their own open SOS (banner) and the "you entered a zone" notice.
 * Each event raises a toast and a bell entry; urgent ones may beep / notify.
 */
export function AlertsProvider({ children }) {
  const { user } = useAuth();
  const role = user?.role;
  const toast = useToast();
  const [alerts, setAlerts] = useState([]);
  const [activeSos, setActiveSos] = useState([]);
  const [zoneNotice, setZoneNotice] = useState(null);
  const [muted, setMuted] = useState(readMuted);
  const [desktopPermission, setDesktopPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  const mutedRef = useRef(muted);
  const i18n = useI18n();
  const i18nRef = useRef(i18n); // tourist toasts use the language chosen right now
  useEffect(() => { i18nRef.current = i18n; });
  const riskSeen = useRef(new Map());

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Re-sync the open-SOS set (banner) after a reconnect.
  useOnReconnect(() => {
    if (role === 'admin') api.get('/sos').then((d) => setActiveSos((d.events || []).filter(isOpen))).catch(() => {});
    else if (role === 'tourist') api.get('/sos/mine').then((d) => setActiveSos(isOpen(d.sosEvent) ? [d.sosEvent] : [])).catch(() => {});
  });

  const push = useCallback(
    (kind, title, message, { link = '/admin/incidents', variant = 'warning', loud = false } = {}) => {
      setAlerts((as) => [{ id: `${Date.now()}-${Math.random()}`, kind, title, message, at: Date.now(), read: false, link }, ...as].slice(0, 50));
      toast[variant](message, { title });
      if (loud && !mutedRef.current) beep();
      if (loud && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(title, { body: message }); } catch { /* ignore */ }
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!role) return undefined;
    const socket = connectSocket(tokens.getAccess());
    const upsertSos = (e) => setActiveSos((list) => {
      const rest = list.filter((x) => x._id !== e._id);
      return isOpen(e) ? [e, ...rest] : rest;
    });

    if (role === 'admin') {
      api.get('/sos')
        .then((d) => setActiveSos((d.events || []).filter(isOpen)))
        .catch(() => {});

      const onSos = ({ sosEvent }) => {
        upsertSos(sosEvent);
        push('sos', 'SOS triggered', `${sosEvent.tourist?.name || 'A tourist'} needs help.`, { variant: 'danger', loud: true });
      };
      const onSosUpdated = (sosEvent) => upsertSos(sosEvent);
      const onViolation = (p) => push('geofence', 'Zone violation', `${p.tourist?.name || 'A tourist'} entered ${p.zone?.name || 'a restricted zone'}.`, { link: '/admin/zones', loud: p.zone?.type === 'danger' });
      const onMissed = () => push('checkin', 'Missed check-in', 'A tourist did not answer a safety check in time.', { variant: 'warning', loud: true });
      const onCheckResponse = ({ safetyCheck }) => {
        if (safetyCheck?.response === 'unsafe') {
          push('checkin', 'Tourist reported unsafe', 'A tourist answered “I need help” on a safety check.', { variant: 'danger', loud: true });
        }
      };
      const onRisk = (r) => {
        const id = r.tourist?._id || r.tourist;
        const prev = riskSeen.current.get(id) ?? 0;
        const rank = RISK_RANK[r.level];
        riskSeen.current.set(id, rank);
        if (rank >= RISK_RANK.high && rank > prev) {
          push('risk', `Risk ${r.level}`, `${r.tourist?.name || 'A tourist'} reached ${r.level} risk (score ${r.score}).`, {
            link: '/admin', variant: r.level === 'critical' ? 'danger' : 'warning', loud: r.level === 'critical',
          });
        }
      };

      socket.on('sos:triggered', onSos);
      socket.on('sos:updated', onSosUpdated);
      socket.on('geofence:violation', onViolation);
      socket.on('safetycheck:missed', onMissed);
      socket.on('safetycheck:response', onCheckResponse);
      socket.on('risk:updated', onRisk);
      return () => {
        socket.off('sos:triggered', onSos);
        socket.off('sos:updated', onSosUpdated);
        socket.off('geofence:violation', onViolation);
        socket.off('safetycheck:missed', onMissed);
        socket.off('safetycheck:response', onCheckResponse);
        socket.off('risk:updated', onRisk);
      };
    }

    // ── tourist ──
    api.get('/sos/mine')
      .then((d) => setActiveSos(isOpen(d.sosEvent) ? [d.sosEvent] : []))
      .catch(() => {});

    const onSos = (p) => { const e = p.sosEvent || p; upsertSos(e); };
    const onSosUpdated = (e) => {
      upsertSos(e);
      const { t } = i18nRef.current;
      if (e?.status === 'acknowledged') push('sos', t('alert.help.title'), t('alert.help.body'), { link: '/tourist/sos', variant: 'success' });
      if (e?.status === 'resolved') push('sos', t('alert.resolved.title'), t('alert.resolved.body'), { link: '/tourist/sos', variant: 'success' });
    };
    const onViolation = (p) => {
      const { t } = i18nRef.current;
      const name = p.zone?.name || '—';
      const danger = p.zone?.type === 'danger';
      setZoneNotice({ name, danger });
      push('geofence', t('alert.zone.title'), t(danger ? 'alert.zone.bodyDanger' : 'alert.zone.body', { zone: name }), {
        link: '/tourist/map', variant: danger ? 'danger' : 'warning', loud: danger,
      });
    };
    const onPrompt = () => {
      const { t } = i18nRef.current;
      push('checkin', t('alert.checkin.title'), t('alert.checkin.body'), { link: '/tourist/checks', variant: 'info', loud: true });
    };
    const onRisk = (r) => {
      const rank = RISK_RANK[r.level];
      const prev = riskSeen.current.get('me') ?? 0;
      riskSeen.current.set('me', rank);
      if (rank >= RISK_RANK.high && rank > prev) {
        const { t, label } = i18nRef.current;
        push('risk', t('alert.risk.title'), t('alert.risk.body', { level: label(r.level) }), { link: '/tourist', variant: 'warning' });
      }
    };

    socket.on('sos:triggered', onSos);
    socket.on('sos:updated', onSosUpdated);
    socket.on('geofence:violation', onViolation);
    socket.on('safetycheck:prompt', onPrompt);
    socket.on('risk:updated', onRisk);
    return () => {
      socket.off('sos:triggered', onSos);
      socket.off('sos:updated', onSosUpdated);
      socket.off('geofence:violation', onViolation);
      socket.off('safetycheck:prompt', onPrompt);
      socket.off('risk:updated', onRisk);
    };
  }, [role, push]);

  const value = useMemo(
    () => ({
      role,
      alerts,
      activeSos,
      zoneNotice,
      dismissZoneNotice: () => setZoneNotice(null),
      unreadCount: alerts.filter((a) => !a.read).length,
      muted,
      desktopPermission,
      markAllRead: () => setAlerts((as) => as.map((a) => ({ ...a, read: true }))),
      clear: () => setAlerts([]),
      toggleMute: () => setMuted((m) => {
        try { localStorage.setItem('alertsMuted', m ? '0' : '1'); } catch { /* ignore */ }
        return !m;
      }),
      requestDesktop: async () => {
        if (typeof Notification === 'undefined') return;
        setDesktopPermission(await Notification.requestPermission());
      },
    }),
    [role, alerts, activeSos, zoneNotice, muted, desktopPermission]
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error('useAlerts must be used inside <AlertsProvider>');
  return ctx;
}
