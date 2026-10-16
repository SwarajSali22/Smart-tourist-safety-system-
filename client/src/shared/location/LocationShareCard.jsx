import { useId } from 'react';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import { useNow } from '../hooks/useNow.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { useLocationSharing } from './LocationSharingContext.jsx';

const BADGE_VARIANT = {
  off: 'neutral', waiting: 'info', sharing: 'success', denied: 'danger', unavailable: 'warning',
  timeout: 'warning', unsupported: 'neutral', wristband: 'info', error: 'warning',
};

/** "Share my location" switch + live status, for the tourist Home page. */
function LocationShareCard() {
  const { t, timeAgo } = useI18n();
  const { sharing, setShare, status, lastSentAt } = useLocationSharing();
  const now = useNow(5000);
  const switchId = useId();

  let detail;
  if (status === 'sharing') detail = lastSentAt ? t('loc.detail.sharingWhen', { when: timeAgo(lastSentAt, now) }) : t('loc.detail.sharing');
  else if (status === 'wristband') detail = t('loc.detail.wristband');
  else if (status === 'waiting') detail = t('loc.detail.waiting');
  else if (status === 'off') detail = t('loc.detail.off');
  else if (status === 'error') detail = t('loc.detail.error');
  else detail = t(`geo.${status}`); // denied | unavailable | timeout | unsupported

  return (
    <Card title={t('loc.title')}>
      <div className="status-row">
        <label htmlFor={switchId} className="switch-label">{t('loc.switch')}</label>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={sharing}
          className={`switch${sharing ? ' switch--on' : ''}`}
          onClick={() => setShare(!sharing)}
        >
          <span className="switch__thumb" />
        </button>
      </div>
      <p className="mt-4">
        <Badge variant={BADGE_VARIANT[status] || 'neutral'}>{t(`loc.badge.${status}`)}</Badge>
      </p>
      <p className="placeholder-text mt-4" role="status" aria-live="polite">{detail}</p>
    </Card>
  );
}

export default LocationShareCard;
