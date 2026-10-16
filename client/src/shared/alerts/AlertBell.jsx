import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react';
import { useAlerts } from './AlertsContext.jsx';
import { localizeNotification } from './localize.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { useNow } from '../hooks/useNow.js';
import { timeAgo } from '../utils/format.js';

/** Bell + dropdown of the latest persistent notifications (unread count, mark read / all, deep links). */
function AlertBell() {
  const { role, notifications, unreadCount, loaded, loadError, reloadNotifications, markRead, markAllRead, muted, toggleMute, desktopPermission, requestDesktop } = useAlerts();
  const i18n = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const now = useNow(30000);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openItem(n) {
    markRead(n._id);
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  const recent = notifications.slice(0, 8);

  return (
    <div className="bell" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn bell__btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${i18n.t('notif.title')}${unreadCount ? `, ${unreadCount} ${i18n.t('notif.unread').toLowerCase()}` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 && <span className="bell__count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="bell__panel" role="region" aria-label={i18n.t('notif.title')}>
          <div className="bell__head">
            <strong>{i18n.t('notif.title')}{unreadCount > 0 ? ` (${unreadCount})` : ''}</strong>
            <div className="bell__tools">
              <button type="button" className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute alert sound' : 'Mute alert sound'} title={muted ? 'Sound off' : 'Sound on'}>
                {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
              </button>
              {desktopPermission === 'default' && (
                <button type="button" className="icon-btn" onClick={requestDesktop} aria-label="Enable desktop notifications" title="Enable desktop notifications">
                  <BellOff size={16} aria-hidden="true" />
                </button>
              )}
              {unreadCount > 0 && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={markAllRead}>{i18n.t('notif.markAll')}</button>
              )}
            </div>
          </div>

          {loadError && !loaded ? (
            <div className="bell__empty">
              <p className="placeholder-text">{loadError}</p>
              <button type="button" className="btn btn--ghost btn--sm mt-4" onClick={reloadNotifications}>Try again</button>
            </div>
          ) : !loaded ? (
            <p className="placeholder-text bell__empty">…</p>
          ) : recent.length === 0 ? (
            <p className="placeholder-text bell__empty">{i18n.t('notif.empty')}</p>
          ) : (
            <ul className="bell__list">
              {recent.map((n) => {
                const shown = localizeNotification(n, i18n, role);
                return (
                  <li key={n._id}>
                    <button type="button" onClick={() => openItem(n)} className={`bell__item bell__item--${n.severity}${n.read ? ' bell__item--read' : ''}`}>
                      <strong>{!n.read && <span className="bell__dot" aria-label="unread" />}{shown.title}</strong>
                      <span>{shown.message}</span>
                      <small>{n.isDemo ? 'Simulated · ' : ''}{timeAgo(n.createdAt, now)}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="bell__foot">
            <Link to={`/${role}/notifications`} onClick={() => setOpen(false)}>{i18n.t('notif.all')} →</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default AlertBell;
