import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react';
import { useAlerts } from './AlertsContext.jsx';
import { useNow } from '../hooks/useNow.js';
import { timeAgo } from '../utils/format.js';

/** Bell + dropdown listing recent live alerts, with sound / desktop-notification controls. */
function AlertBell() {
  const { alerts, unreadCount, markAllRead, clear, muted, toggleMute, desktopPermission, requestDesktop } = useAlerts();
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

  function toggle() {
    setOpen((o) => {
      if (!o) markAllRead();
      return !o;
    });
  }

  return (
    <div className="bell" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn bell__btn"
        onClick={toggle}
        aria-label={`Alerts${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 && <span className="bell__count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="bell__panel" role="region" aria-label="Recent alerts">
          <div className="bell__head">
            <strong>Alerts</strong>
            <div className="bell__tools">
              <button type="button" className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute alert sound' : 'Mute alert sound'} title={muted ? 'Sound off' : 'Sound on'}>
                {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
              </button>
              {desktopPermission === 'default' && (
                <button type="button" className="icon-btn" onClick={requestDesktop} aria-label="Enable desktop notifications" title="Enable desktop notifications">
                  <BellOff size={16} aria-hidden="true" />
                </button>
              )}
              {alerts.length > 0 && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={clear}>Clear</button>
              )}
            </div>
          </div>
          {alerts.length === 0 ? (
            <p className="placeholder-text bell__empty">No alerts yet. New SOS, zone violations and risk escalations will appear here live.</p>
          ) : (
            <ul className="bell__list">
              {alerts.map((a) => (
                <li key={a.id}>
                  <Link to={a.link} onClick={() => setOpen(false)} className={`bell__item bell__item--${a.kind}`}>
                    <strong>{a.title}</strong>
                    <span>{a.message}</span>
                    <small>{timeAgo(a.at, now)}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default AlertBell;
