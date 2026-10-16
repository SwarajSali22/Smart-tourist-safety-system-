import { useId } from 'react';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import { useNow } from '../hooks/useNow.js';
import { timeAgo } from '../utils/format.js';
import { useLocationSharing } from './LocationSharingContext.jsx';

const STATUS_BADGE = {
  off: ['neutral', 'Off'],
  waiting: ['info', 'Locating…'],
  sharing: ['success', 'Sharing'],
  denied: ['danger', 'Blocked'],
  unavailable: ['warning', 'No signal'],
  timeout: ['warning', 'Searching…'],
  unsupported: ['neutral', 'Unsupported'],
  wristband: ['info', 'Wristband'],
  error: ['warning', 'Problem'],
};

/** "Share my location" switch + live status, for the tourist Home page. */
function LocationShareCard() {
  const { sharing, setShare, status, error, lastSentAt } = useLocationSharing();
  const now = useNow(5000);
  const switchId = useId();
  const [variant, text] = STATUS_BADGE[status] || STATUS_BADGE.off;

  let detail;
  if (status === 'sharing') detail = `Your phone’s location is shared with the safety team${lastSentAt ? ` — last sent ${timeAgo(lastSentAt, now)}` : ''}.`;
  else if (status === 'wristband') detail = 'Your wristband is your tracker, so your phone’s location isn’t needed.';
  else if (status === 'waiting') detail = 'Waiting for a location fix from your phone…';
  else if (status === 'off') detail = 'Turn this on so admins can see where you are and respond faster in an emergency.';
  else detail = error;

  return (
    <Card title="Share my location">
      <div className="status-row">
        <label htmlFor={switchId} className="switch-label">Share my phone’s location</label>
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
        <Badge variant={variant}>{text}</Badge>
      </p>
      <p className="placeholder-text mt-4" role="status" aria-live="polite">{detail}</p>
    </Card>
  );
}

export default LocationShareCard;
