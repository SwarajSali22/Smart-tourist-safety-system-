/**
 * API client.
 * - Injects Authorization header from localStorage when a token is present.
 * - On 401, attempts one silent token refresh then retries.
 * - Throws an ApiError (with .status) so callers can react to HTTP codes.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── Token storage (localStorage so tokens survive a page refresh) ─────────────
export const tokens = {
  getAccess:     () => localStorage.getItem('accessToken'),
  getRefresh:    () => localStorage.getItem('refreshToken'),
  set(access, refresh) {
    localStorage.setItem('accessToken', access);
    if (refresh) localStorage.setItem('refreshToken', refresh);
  },
  clear() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  },
};

// ── Core fetch wrapper ────────────────────────────────────────────────────────
let _refreshing = null; // deduplicate concurrent refresh calls

// These endpoints are unauthenticated by design — a 401 from them is
// always about the submitted credentials, never an expired session (even
// if a stale token happens to still be sitting in storage when they're
// called).
const AUTH_ENDPOINTS = ['/auth/login', '/auth/register'];

async function _fetch(path, options = {}, retry = true) {
  const accessToken = tokens.getAccess();
  const headers = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  // Silent token refresh on 401 — only meaningful for a request that
  // actually carried a token to begin with, and wasn't hitting a public
  // auth endpoint whose own 401 means "wrong credentials", not "expired
  // session". Let those fall through to the generic error handling below
  // so the real message shows.
  if (res.status === 401 && retry && accessToken && !AUTH_ENDPOINTS.includes(path)) {
    const refreshToken = tokens.getRefresh();
    if (refreshToken) {
      if (!_refreshing) {
        _refreshing = _doRefresh(refreshToken).finally(() => { _refreshing = null; });
      }
      const ok = await _refreshing;
      if (ok) return _fetch(path, options, false); // one retry
    }
    // Refresh failed or no refresh token — clear and let caller handle
    tokens.clear();
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.message || message;
    } catch { /* ignore */ }
    throw new ApiError(res.status, message);
  }

  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

async function _doRefresh(refreshToken) {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    tokens.set(data.accessToken, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ── Public helpers ────────────────────────────────────────────────────────────
export const api = {
  get:    (path, opts)         => _fetch(path, { method: 'GET', ...opts }),
  post:   (path, body, opts)   => _fetch(path, { method: 'POST',   body: JSON.stringify(body), ...opts }),
  put:    (path, body, opts)   => _fetch(path, { method: 'PUT',    body: JSON.stringify(body), ...opts }),
  patch:  (path, body, opts)   => _fetch(path, { method: 'PATCH',  body: JSON.stringify(body), ...opts }),
  delete: (path, opts)         => _fetch(path, { method: 'DELETE', ...opts }),
};

// Legacy Phase 1 export kept so HealthStatus.jsx continues to work
export const API_BASE_URL_EXPORT = API_BASE_URL;
export async function apiGet(path) { return api.get(path); }
export { API_BASE_URL };
