import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../socket/socket.js';
import { useToast } from '../components/ui/Toast.jsx';
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

/**
 * Admin-wide live alert layer: listens for SOS, geofence violations, missed or
 * "unsafe" safety checks and risk escalations on every admin page; raises a
 * toast, an optional sound/desktop notification, and keeps a bell list + the
 * set of currently active SOS events for the persistent banner.
 */
export function AlertsProvider({ children }) {
  const toast = useToast();
  const [alerts, setAlerts] = useState([]);
  const [activeSos, setActiveSos] = useState([]);
  const [muted, setMuted] = useState(readMuted);
  const [desktopPermission, setDesktopPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  const mutedRef = useRef(muted);
  const riskSeen = useRef(new Map());

  useEffect(() => { mutedRef.current = muted; }, [muted]);

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
    api.get('/sos')
      .then((d) => setActiveSos((d.events || []).filter((e) => e.status === 'active' || e.status === 'acknowledged')))
      .catch(() => {});

    const socket = connectSocket(tokens.getAccess());
    const isOpen = (e) => e.status === 'active' || e.status === 'acknowledged';
    const upsert = (e) => setActiveSos((list) => {
      const rest = list.filter((x) => x._id !== e._id);
      return isOpen(e) ? [e, ...rest] : rest;
    });

    function onSos({ sosEvent }) {
      upsert(sosEvent);
      push('sos', 'SOS triggered', `${sosEvent.tourist?.name || 'A tourist'} needs help.`, { variant: 'danger', loud: true });
    }
    function onSosUpdated(sosEvent) { upsert(sosEvent); }
    function onViolation(p) {
      push('geofence', 'Zone violation', `${p.tourist?.name || 'A tourist'} entered ${p.zone?.name || 'a restricted zone'}.`, { link: '/admin/zones', loud: p.zone?.type === 'danger' });
    }
    function onMissed() {
      push('checkin', 'Missed check-in', 'A tourist did not answer a safety check in time.', { variant: 'warning', loud: true });
    }
    function onCheckResponse({ safetyCheck }) {
      if (safetyCheck?.response === 'unsafe') {
        push('checkin', 'Tourist reported unsafe', 'A tourist answered “I need help” on a safety check.', { variant: 'danger', loud: true });
      }
    }
    function onRisk(r) {
      const id = r.tourist?._id || r.tourist;
      const prev = riskSeen.current.get(id) ?? 0;
      const rank = RISK_RANK[r.level];
      riskSeen.current.set(id, rank);
      if (rank >= RISK_RANK.high && rank > prev) {
        push('risk', `Risk ${r.level}`, `${r.tourist?.name || 'A tourist'} reached ${r.level} risk (score ${r.score}).`, {
          link: '/admin', variant: r.level === 'critical' ? 'danger' : 'warning', loud: r.level === 'critical',
        });
      }
    }

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
  }, [push]);

  const value = useMemo(
    () => ({
      alerts,
      activeSos,
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
    [alerts, activeSos, muted, desktopPermission]
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error('useAlerts must be used inside <AlertsProvider>');
  return ctx;
}
