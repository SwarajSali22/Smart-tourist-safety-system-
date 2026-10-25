const env = require('../../config/env');

/**
 * Thin client for the Google Gemini API (Google AI Studio free tier), using plain HTTPS — no SDK.
 * The API key is sent in the `x-goog-api-key` header (never in the URL, so it cannot end up in logs)
 * and exists only on the server. This module never retries a failed request on a different PROVIDER and never
 * enables billing: when the free quota is used up the caller gets a clear "quota" error.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 45000;

class ProviderError extends Error {
  constructor(status, message, apiStatus = null) {
    super(message);
    this.status = status;       // HTTP status (0 = network/timeout)
    this.apiStatus = apiStatus; // e.g. RESOURCE_EXHAUSTED, PERMISSION_DENIED
  }
}

/** POST models/{model}:generateContent. Returns the parsed JSON body or throws ProviderError. */
async function generateContent(model, body) {
  let res;
  try {
    res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.copilot.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw new ProviderError(0, timeout ? 'The AI service timed out' : 'The AI service is unreachable', timeout ? 'TIMEOUT' : 'UNREACHABLE');
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const e = json?.error || {};
    throw new ProviderError(res.status, String(e.message || `HTTP ${res.status}`).slice(0, 300), e.status || null);
  }
  return json;
}

module.exports = { generateContent, ProviderError };
