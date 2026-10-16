import { io } from 'socket.io-client';
import { api, tokens } from '../../api/client.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');

// How long we keep saying "Reconnecting…" before admitting we're offline.
const OFFLINE_AFTER_MS = 20000;

let socket = null;

// ── connection status: 'live' | 'reconnecting' | 'offline' ───────────────────────
let status = 'reconnecting';
let everConnected = false;
let offlineTimer = null;
let gaveUp = false; // the 20 s clock fired: stay "Offline" until we actually reconnect
let refreshing = false;
const statusListeners = new Set();
const reconnectListeners = new Set();

function setStatus(next) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function degrade() {
  setStatus(gaveUp || !navigator.onLine ? 'offline' : 'reconnecting');
  // Start the "give up and say Offline" clock once per outage — NOT on every failed
  // retry, or it would be reset forever and never fire.
  if (!offlineTimer) {
    offlineTimer = setTimeout(() => {
      offlineTimer = null;
      if (status !== 'live') { gaveUp = true; setStatus('offline'); }
    }, OFFLINE_AFTER_MS);
  }
}

// The handshake token can be stale after a long session; one cheap authenticated
// call makes the API client refresh it, and the socket then retries with the
// new token (auth is a function, evaluated on every (re)connect).
function refreshThenRetry() {
  if (refreshing) return;
  refreshing = true;
  api.get('/auth/me').catch(() => {}).finally(() => {
    setTimeout(() => {
      refreshing = false;
      if (socket && !socket.connected) socket.connect();
    }, 1500);
  });
}

export function getStatus() { return status; }
export function subscribeStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
/** Runs `cb` after every RE-connection (not the first connect), so pages can refetch missed data. */
export function onReconnect(cb) {
  reconnectListeners.add(cb);
  return () => reconnectListeners.delete(cb);
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => { clearTimeout(offlineTimer); offlineTimer = null; gaveUp = false; setStatus('offline'); });
  window.addEventListener('online', () => {
    if (status !== 'offline') return;
    // The socket may never have dropped (short blip): go straight back to Live then.
    if (socket?.connected) setStatus('live');
    else { gaveUp = false; setStatus('reconnecting'); socket?.connect(); }
  });
}

export function connectSocket() {
  if (socket) return socket;
  socket = io(SOCKET_URL, { auth: (cb) => cb({ token: tokens.getAccess() }) });

  socket.on('connect', () => {
    clearTimeout(offlineTimer);
    offlineTimer = null;
    gaveUp = false;
    setStatus('live');
    if (everConnected) reconnectListeners.forEach((cb) => { try { cb(); } catch { /* a page's refetch must not break the others */ } });
    everConnected = true;
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return; // we closed it (logout)
    degrade();
    if (reason === 'io server disconnect') socket.connect(); // server-side kick: client won't auto-retry
  });
  socket.on('connect_error', (err) => {
    degrade();
    if (err?.message === 'Unauthorized') refreshThenRetry();
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  everConnected = false;
  clearTimeout(offlineTimer);
  offlineTimer = null;
  gaveUp = false;
  status = 'reconnecting';
  statusListeners.forEach((l) => l());
}

export function getSocket() {
  return socket;
}
