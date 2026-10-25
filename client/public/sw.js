/* Service worker for the Smart Tourist Safety System.
 *
 * Deliberately tiny, and it only ever touches the app's own static files:
 *   1. Page loads (navigations): network first. If the network is down, or the response is a gateway
 *      error (502/503/504), show /offline.html.
 *   2. Built files under /assets/ (JS, CSS, images; file names contain a content hash): cache first.
 *   3. EVERYTHING ELSE is left alone — this worker never calls respondWith for it:
 *        - API calls, Socket.IO, login/refresh, Copilot (other origin, or not under /assets/)
 *        - every non-GET request (SOS, check-ins, incident actions are POST/PATCH)
 *        - map tiles, fonts, other origins
 *      so nothing sensitive is cached, nothing is replayed, and no request is ever duplicated.
 *
 * No Background Sync, no push, no request queue. The app's own offline queue (localStorage) is the only
 * offline mechanism for SOS, and it is unaffected by this file.
 */
const VERSION = 'v2';                       // bump when this file's logic changes; old caches are deleted on activate
const SHELL_CACHE = `sts-shell-${VERSION}`; // just the offline page
const ASSET_CACHE = `sts-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const MAX_ASSETS = 80;                      // old builds' files are trimmed oldest-first
const GATEWAY_ERRORS = [502, 503, 504];     // "bad gateway / unavailable / timeout" from whatever sits in front of the app

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((n) => n.startsWith('sts-') && n !== SHELL_CACHE && n !== ASSET_CACHE)
        .map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Only cache complete, same-origin successes (never errors, redirects or opaque responses).
  if (response.status === 200 && response.type === 'basic') {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    if (keys.length > MAX_ASSETS) await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((k) => cache.delete(k)));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;                       // never touch mutations
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;            // never touch the API / other sites

  if (request.mode === 'navigate') {
    // Page loads only. A network failure, or a gateway error from a proxy/tunnel in front of the app
    // (502/503/504, whose body is raw text such as "no tunnel"), shows the offline page instead.
    event.respondWith(
      fetch(request)
        .then((response) => (GATEWAY_ERRORS.includes(response.status)
          ? caches.match(OFFLINE_URL).then((offline) => offline || response)
          : response))
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  }
});
