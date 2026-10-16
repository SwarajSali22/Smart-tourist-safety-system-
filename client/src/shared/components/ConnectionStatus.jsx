import { useSocketStatus } from '../socket/useSocketStatus.js';

const COPY = {
  live: { text: 'Live', hint: 'Real-time updates are connected' },
  reconnecting: { text: 'Reconnecting…', hint: 'Connection lost — trying to reconnect' },
  offline: { text: 'Offline', hint: 'No connection — live updates are paused' },
};

/** Topbar pill: green Live / amber Reconnecting… / red Offline (Socket.IO state). */
function ConnectionStatus() {
  const status = useSocketStatus();
  const { text, hint } = COPY[status];
  return (
    <span className={`conn conn--${status}`} role="status" aria-live="polite" title={hint}>
      <span className="conn__dot" aria-hidden="true" />
      <span className="conn__text">{text}</span>
    </span>
  );
}

export default ConnectionStatus;
