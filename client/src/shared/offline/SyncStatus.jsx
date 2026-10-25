import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { discard, flushQueue, retryFailed, startOfflineSync, useOfflineQueue } from './queue.js';
import { formatDateTime } from '../utils/format.js';

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

const STATE_TEXT = {
  pending: 'Waiting to send — not delivered yet',
  failed: 'Could not be sent',
  synced: 'Delivered',
};
// Sent to the network but never answered by the server (e.g. a gateway error): it may or may not have been received.
const UNCONFIRMED_TEXT = 'Not confirmed — it may have reached the server. Retrying automatically with the same request';

/**
 * Top-bar indicator for the offline queue. Hidden when online with nothing queued. It never
 * describes a held event as sent: "pending" means it is only stored on this device.
 */
function SyncStatus() {
  const online = useOnline();
  const items = useOfflineQueue();
  const [open, setOpen] = useState(false);
  useEffect(() => { startOfflineSync(); }, []);

  const pending = items.filter((e) => e.status === 'pending').length;
  const failed = items.filter((e) => e.status === 'failed').length;
  const recent = items.filter((e) => e.status === 'synced').length;
  if (online && !items.length) return null;

  const tone = failed ? 'danger' : pending || !online ? 'warning' : 'success';
  const text = !online ? `Offline${pending ? ` · ${pending} waiting` : ''}` : failed ? `${failed} not sent` : pending ? `${pending} waiting to send` : 'All synced';

  return (
    <div className="sync">
      <button type="button" className={`sync__btn sync__btn--${tone}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        {online ? <RefreshCw size={14} aria-hidden="true" /> : <CloudOff size={14} aria-hidden="true" />}
        <span>{text}</span>
      </button>
      {open && (
        <div className="sync__panel reveal" role="dialog" aria-label="Pending synchronisation">
          <p className="form-hint">
            {online ? 'Connected.' : 'No connection.'} Items below are stored only on this device until the server confirms them.
            {!online && ' An emergency request cannot reach anyone while this device is offline — contact local emergency services directly if you can.'}
          </p>
          {items.length === 0 ? <p className="placeholder-text">Nothing queued.</p> : (
            <ul className="sync__list">
              {items.map((e) => (
                <li key={e.id}>
                  <strong>{e.label}</strong>
                  <small className="form-hint block">{e.status === 'pending' && e.uncertain ? UNCONFIRMED_TEXT : STATE_TEXT[e.status]} · {formatDateTime(e.clientAt)}{e.attempts ? ` · ${e.attempts} attempt${e.attempts === 1 ? '' : 's'}` : ''}</small>
                  {e.note && <small className="form-hint block">{e.note}</small>}
                  {e.lastError && e.status !== 'synced' && <small className="form-error block">{e.lastError}</small>}
                  <span className="sync__actions">
                    {e.status === 'failed' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => retryFailed(e.id)}>Retry</button>}
                    {e.status !== 'pending' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => discard(e.id)}>Dismiss</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="sync__foot">
            <button type="button" className="btn btn--ghost btn--sm" disabled={!online || !pending} onClick={flushQueue}>Sync now</button>
            {recent > 0 && <small className="form-hint">{recent} delivered recently</small>}
          </div>
        </div>
      )}
    </div>
  );
}

export default SyncStatus;
