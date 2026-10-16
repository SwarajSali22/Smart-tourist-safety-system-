import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../socket/socket.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useOnReconnect } from '../socket/useSocketStatus.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { localizeNotification } from './localize.js';

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
const TOAST_VARIANT = { critical: 'danger', warning: 'warning', info: 'info' };

/**
 * Live alert layer shared by both roles (mounted once by AppShell).
 *
 *  - Notifications are PERSISTENT: they are stored server-side (GET /api/notifications),
 *    pushed live as `notification:new`, and keep their read state. The bell, the unread
 *    count and the notifications page all read from here.
 *  - The red SOS banner tracks open SOS (admin: all, tourist: their own).
 *  - Tourists also get an immediate "you entered a zone" banner from `geofence:violation`.
 */
export function AlertsProvider({ children }) {
  const { user } = useAuth();
  const role = user?.role;
  const toast = useToast();
  const i18n = useI18n();
  const i18nRef = useRef(i18n);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [activeSos, setActiveSos] = useState([]);
  const [zoneNotice, setZoneNotice] = useState(null);
  const [muted, setMuted] = useState(readMuted);
  const [desktopPermission, setDesktopPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  const mutedRef = useRef(muted);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { i18nRef.current = i18n; });

  const loadNotifications = useCallback(() => {
    if (!role) return Promise.resolve();
    return api.get('/notifications?limit=40')
      .then((d) => { setNotifications(d.notifications || []); setUnreadCount(d.unreadCount || 0); setLoadError(''); })
      .catch((e) => setLoadError(e.message || 'Could not load notifications'))
      .finally(() => setLoaded(true));
  }, [role]);

  const loadSos = useCallback(() => {
    if (role === 'admin') return api.get('/sos').then((d) => setActiveSos((d.events || []).filter(isOpen))).catch(() => {});
    if (role === 'tourist') return api.get('/sos/mine').then((d) => setActiveSos(isOpen(d.sosEvent) ? [d.sosEvent] : [])).catch(() => {});
    return Promise.resolve();
  }, [role]);

  useEffect(() => { loadNotifications(); loadSos(); }, [loadNotifications, loadSos]);
  useOnReconnect(() => { loadNotifications(); loadSos(); }); // catch up on anything missed while offline

  useEffect(() => {
    if (!role) return undefined;
    const socket = connectSocket(tokens.getAccess());
    const upsertSos = (e) => setActiveSos((list) => {
      const rest = list.filter((x) => x._id !== e._id);
      return isOpen(e) ? [e, ...rest] : rest;
    });

    function onNotification(n) {
      let isNew = false;
      setNotifications((list) => {
        if (list.some((x) => x._id === n._id)) return list;
        isNew = true;
        return [n, ...list].slice(0, 100);
      });
      if (!isNew) return;
      setUnreadCount((c) => c + 1);
      const shown = localizeNotification(n, i18nRef.current, role);
      toast[TOAST_VARIANT[n.severity] || 'info'](shown.message, { title: shown.title });
      if (n.severity === 'critical') {
        if (!mutedRef.current) beep();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification(shown.title, { body: shown.message }); } catch { /* ignore */ }
        }
      }
    }
    const onSos = (p) => upsertSos(p.sosEvent || p);
    const onSosUpdated = (e) => upsertSos(e);
    const onViolation = (p) => {
      if (role !== 'tourist') return;
      setZoneNotice({ name: p.zone?.name || '—', danger: p.zone?.type === 'danger' });
    };

    socket.on('notification:new', onNotification);
    socket.on('sos:triggered', onSos);
    socket.on('sos:updated', onSosUpdated);
    socket.on('geofence:violation', onViolation);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('sos:triggered', onSos);
      socket.off('sos:updated', onSosUpdated);
      socket.off('geofence:violation', onViolation);
    };
  }, [role, toast]);

  // Mark one notification read (optimistic; restored with an error toast if the server refuses).
  const markRead = useCallback(async (id) => {
    const target = notifications.find((n) => n._id === id);
    if (!target || target.read) return;
    setNotifications((list) => list.map((n) => (n._id === id ? { ...n, read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.patch(`/notifications/${id}/read`, {});
    } catch (err) {
      setNotifications((list) => list.map((n) => (n._id === id ? { ...n, read: false } : n)));
      setUnreadCount((c) => c + 1);
      toast.error(`Couldn’t mark as read: ${err.message || 'request failed'}`);
    }
  }, [notifications, toast]);

  const markAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    const prevList = notifications;
    const prevCount = unreadCount;
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api.post('/notifications/read-all', {});
    } catch (err) {
      setNotifications(prevList);
      setUnreadCount(prevCount);
      toast.error(`Couldn’t mark all as read: ${err.message || 'request failed'}`);
    }
  }, [notifications, unreadCount, toast]);

  const value = useMemo(
    () => ({
      role,
      notifications,
      unreadCount,
      loaded,
      loadError,
      reloadNotifications: loadNotifications,
      markRead,
      markAllRead,
      activeSos,
      zoneNotice,
      dismissZoneNotice: () => setZoneNotice(null),
      muted,
      desktopPermission,
      toggleMute: () => setMuted((m) => {
        try { localStorage.setItem('alertsMuted', m ? '0' : '1'); } catch { /* ignore */ }
        return !m;
      }),
      requestDesktop: async () => {
        if (typeof Notification === 'undefined') return;
        setDesktopPermission(await Notification.requestPermission());
      },
    }),
    [role, notifications, unreadCount, loaded, loadError, loadNotifications, markRead, markAllRead, activeSos, zoneNotice, muted, desktopPermission]
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts() {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error('useAlerts must be used inside <AlertsProvider>');
  return ctx;
}
