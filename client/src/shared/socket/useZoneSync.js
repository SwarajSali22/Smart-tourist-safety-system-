import { useEffect } from 'react';
import { connectSocket } from './socket.js';
import { tokens } from '../../api/client.js';

/**
 * Keeps a `zones` state array in sync with zone:created/updated/deleted
 * socket events. Calling connectSocket() here (idempotent — returns the
 * existing connection if AuthContext already made one) instead of relying
 * on getSocket() sidesteps a mount-order race: a page's own effects can
 * fire before AuthProvider's connect-on-login effect in the same commit.
 */
export function useZoneSync(setZones) {
  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());

    function onCreated(zone) {
      setZones((zs) => [zone, ...zs]);
    }
    function onUpdated(zone) {
      setZones((zs) => zs.map((z) => (z._id === zone._id ? zone : z)));
    }
    function onDeleted({ _id }) {
      setZones((zs) => zs.filter((z) => z._id !== _id));
    }

    socket.on('zone:created', onCreated);
    socket.on('zone:updated', onUpdated);
    socket.on('zone:deleted', onDeleted);
    return () => {
      socket.off('zone:created', onCreated);
      socket.off('zone:updated', onUpdated);
      socket.off('zone:deleted', onDeleted);
    };
  }, [setZones]);
}
