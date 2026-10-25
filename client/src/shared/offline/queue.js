import { useSyncExternalStore } from 'react';
import { api, tokens } from '../../api/client.js';

/**
 * Local queue for eligible events (SOS, check-in answers, trip arrivals/check-ins) when the
 * network is unreachable.
 *
 *  - An event is queued ONLY when the request could not reach the server. If the server answered
 *    (even with an error) the result is final and shown to the user as such.
 *  - Every event carries a unique id that is sent as `Idempotency-Key`, so a retry that raced with
 *    a request that actually got through is answered by the server instead of being applied twice.
 *  - Statuses: pending (held on this device, NOT delivered) → synced (server confirmed) or failed.
 *  - A 404/409 on replay means the server's state has already moved on (e.g. the check-in was
 *    answered elsewhere, an SOS is already active): the server wins, nothing is overwritten.
 */
const KEY = 'sts.offlineQueue.v1';
const MAX_ATTEMPTS = 8;
const KEEP_SYNCED_MS = 60 * 60 * 1000;

let items = read();
const listeners = new Set();
let flushing = false;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function commit(next) {
  items = next;
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage unavailable: keep in memory */ }
  listeners.forEach((l) => l());
}
const update = (id, patch) => commit(items.map((e) => (e.id === id ? { ...e, ...patch } : e)));

function newId() {
  const rnd = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9]/g, '');
  return `evt_${rnd}`.slice(0, 60);
}

/** Id of the signed-in user (from the access token). Queued events belong to one user and are never replayed under another. */
function currentUserId() {
  try { return JSON.parse(atob(tokens.getAccess().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null; } catch { return null; }
}
const mine = (e) => e.user === currentUserId();

const isNetworkError = (err) => !err?.status; // ApiError always has a status; fetch failures don't

/**
 * Sends a request now, or queues it if the network is unreachable.
 * @returns {{ status: 'delivered', data } | { status: 'queued', eventId }}  (server rejections throw)
 */
export async function sendOrQueue({ kind, label, method = 'POST', path, body = {} }) {
  const id = newId();
  const clientAt = new Date().toISOString();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return enqueue({ id, kind, label, method, path, body, clientAt });
  }
  try {
    const data = await api[method.toLowerCase()](path, body, { headers: { 'Idempotency-Key': id } });
    return { status: 'delivered', data };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return enqueue({ id, kind, label, method, path, body, clientAt });
  }
}

function enqueue(entry) {
  commit([...items, { ...entry, user: currentUserId(), status: 'pending', attempts: 0, lastError: null }]);
  return { status: 'queued', eventId: entry.id };
}

async function sendOne(entry) {
  try {
    await api[entry.method.toLowerCase()](entry.path, entry.body, { headers: { 'Idempotency-Key': entry.id } });
    update(entry.id, { status: 'synced', syncedAt: new Date().toISOString(), note: null });
  } catch (err) {
    if (isNetworkError(err)) {
      const attempts = entry.attempts + 1;
      update(entry.id, { attempts, lastError: 'No connection', status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' });
      return false; // still offline: stop this round
    }
    if (err.status === 404 || err.status === 409) {
      update(entry.id, { status: 'synced', syncedAt: new Date().toISOString(), note: 'The server already had newer information, so this was not applied.' });
    } else if (err.status >= 500) {
      const attempts = entry.attempts + 1;
      update(entry.id, { attempts, lastError: err.message, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' });
    } else {
      update(entry.id, { status: 'failed', lastError: err.message });
    }
  }
  return true;
}

/** Tries every pending event in the order it happened. Safe to call repeatedly. */
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    commit(items.filter((e) => e.status !== 'synced' || Date.now() - new Date(e.syncedAt).getTime() < KEEP_SYNCED_MS));
    for (const entry of items.filter((e) => e.status === 'pending' && mine(e))) {
      const cont = await sendOne(entry);
      if (!cont) break;
    }
  } finally {
    flushing = false;
  }
}

export function retryFailed(id) { update(id, { status: 'pending', attempts: 0, lastError: null }); flushQueue(); }
export function discard(id) { commit(items.filter((e) => e.id !== id)); }

const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
// Stable snapshot of just the signed-in user's events (re-computed only when the queue or the user changes).
let cachedFor = null; let cachedUser = null; let cachedView = [];
const snapshot = () => {
  const uid = currentUserId();
  if (cachedFor !== items || cachedUser !== uid) { cachedFor = items; cachedUser = uid; cachedView = items.filter((e) => e.user === uid); }
  return cachedView;
};
export const useOfflineQueue = () => useSyncExternalStore(subscribe, snapshot);

let started = false;
/** Wires connectivity events; called once from the app shell. */
export function startOfflineSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', flushQueue);
  setInterval(() => { if (items.some((e) => e.status === 'pending' && mine(e))) flushQueue(); }, 15000);
  flushQueue();
}
