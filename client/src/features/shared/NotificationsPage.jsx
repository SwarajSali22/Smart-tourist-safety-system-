import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useAlerts } from '../../shared/alerts/AlertsContext.jsx';
import { localizeNotification } from '../../shared/alerts/localize.js';
import { useI18n } from '../../shared/i18n/I18nContext.jsx';
import { useNow } from '../../shared/hooks/useNow.js';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { formatDateTime, timeAgo } from '../../shared/utils/format.js';

const SEVERITY_BADGE = { critical: 'danger', warning: 'warning', info: 'neutral' };

/** Full notification list for either role (persistent: unread state survives reloads). */
function NotificationsPage() {
  const { role, notifications, unreadCount, loaded, loadError, reloadNotifications, markRead, markAllRead } = useAlerts();
  const i18n = useI18n();
  const navigate = useNavigate();
  const now = useNow(30000);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const shownList = onlyUnread ? notifications.filter((n) => !n.read) : notifications;

  return (
    <div className="app-page">
      <h1 className="page-title">{i18n.t('notif.title')}</h1>
      <p className="page-subtitle">{unreadCount > 0 ? `${unreadCount} ${i18n.t('notif.unread').toLowerCase()}` : '—'}</p>

      <Card>
        <div className="table-toolbar">
          <div className="filter-row">
            <button type="button" className={`btn btn--sm ${!onlyUnread ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setOnlyUnread(false)} aria-pressed={!onlyUnread}>{i18n.t('notif.all')}</button>
            <button type="button" className={`btn btn--sm ${onlyUnread ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setOnlyUnread(true)} aria-pressed={onlyUnread}>{i18n.t('notif.unread')}{unreadCount ? ` (${unreadCount})` : ''}</button>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck size={14} aria-hidden="true" /> {i18n.t('notif.markAll')}
          </button>
        </div>

        {!loaded ? (
          <SkeletonRows rows={5} />
        ) : loadError && notifications.length === 0 ? (
          <ErrorState message={loadError} onRetry={reloadNotifications} />
        ) : shownList.length === 0 ? (
          <EmptyState icon={Bell} title={i18n.t('notif.empty')} />
        ) : (
          <ul className="notif-list">
            {shownList.map((n) => {
              const shown = localizeNotification(n, i18n, role);
              return (
                <li key={n._id} className={`notif${n.read ? ' notif--read' : ''}`}>
                  <div className="notif__main">
                    <strong>{!n.read && <span className="bell__dot" aria-label="unread" />}{shown.title}</strong>
                    <p>{shown.message}</p>
                    <small className="form-hint" title={formatDateTime(n.createdAt)}>
                      {n.isDemo && <Badge variant="info">Simulated</Badge>} {timeAgo(n.createdAt, now)}
                    </small>
                  </div>
                  <div className="notif__side">
                    <Badge variant={SEVERITY_BADGE[n.severity]}>{n.severity}</Badge>
                    {n.link && <button type="button" className="btn btn--primary btn--sm" onClick={() => { markRead(n._id); navigate(n.link); }}>{i18n.t('notif.open')}</button>}
                    {!n.read && <button type="button" className="btn btn--ghost btn--sm" onClick={() => markRead(n._id)}>✓</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default NotificationsPage;
