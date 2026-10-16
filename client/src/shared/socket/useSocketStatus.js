import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getStatus, onReconnect, subscribeStatus } from './socket.js';

/** 'live' | 'reconnecting' | 'offline' */
export function useSocketStatus() {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

/**
 * Calls `cb` every time the socket RE-connects (not on the first connect), so a
 * page can refetch whatever it missed while disconnected. Always uses the latest `cb`.
 */
export function useOnReconnect(cb) {
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; });
  useEffect(() => onReconnect(() => ref.current()), []);
}
