const env = require('../../config/env');

/**
 * Place search + reverse geocoding for the admin Help Centers form, backed by an
 * OpenStreetMap Nominatim-compatible API (GEOCODE_BASE_URL). Requests are made
 * server-side so the required User-Agent is sent, calls are serialised to the
 * provider's 1 request/second limit, and repeat lookups are served from a small cache.
 */

const TIMEOUT_MS = 8000;
const MIN_GAP_MS = 1100;
const CACHE_MAX = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;

// category → words used to steer the search, and the OSM tags that count as a match
const CATEGORY = {
  hospital: { keyword: 'hospital', match: (t) => t.amenity === 'hospital' || t.amenity === 'clinic' || t.healthcare === 'hospital' },
  police: { keyword: 'police station', match: (t) => t.amenity === 'police' },
  pharmacy: { keyword: 'pharmacy', match: (t) => t.amenity === 'pharmacy' || t.healthcare === 'pharmacy' },
  fire: { keyword: 'fire station', match: (t) => t.amenity === 'fire_station' },
  embassy: { keyword: 'embassy', match: (t) => t.amenity === 'embassy' || t.office === 'diplomatic' || t.diplomatic === 'embassy' },
  emergency: { keyword: 'emergency', match: (t) => Boolean(t.emergency) || t.amenity === 'ambulance_station' },
};

const isConfigured = () => Boolean(env.geocode.userAgent);

class GeocodeError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const cache = new Map();
const cacheGet = (k) => {
  const hit = cache.get(k);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(k);
    return undefined;
  }
  return hit.value;
};
const cacheSet = (k, value) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, { at: Date.now(), value });
};

let chain = Promise.resolve();
let lastCall = 0;
/** Runs provider calls one at a time, at least MIN_GAP_MS apart. */
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function call(path, params) {
  if (!isConfigured()) throw new GeocodeError('Place search is not configured on this server (set GEOCODE_USER_AGENT).', 503);
  const url = new URL(env.geocode.baseUrl + path);
  for (const [k, v] of Object.entries({ format: 'jsonv2', addressdetails: 1, extratags: 1, ...params })) url.searchParams.set(k, v);
  if (env.geocode.email) url.searchParams.set('email', env.geocode.email);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': env.geocode.userAgent, Accept: 'application/json', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new GeocodeError(err.name === 'TimeoutError' || err.name === 'AbortError' ? 'The place-search provider timed out' : 'The place-search provider is unreachable');
  }
  if (res.status === 429) throw new GeocodeError('The place-search provider is rate limiting requests — try again shortly', 503);
  if (!res.ok) throw new GeocodeError(`The place-search provider returned an error (HTTP ${res.status})`);
  try {
    return await res.json();
  } catch {
    throw new GeocodeError('The place-search provider returned an unreadable response');
  }
}

const tagsOf = (r) => ({ ...(r.extratags || {}), [r.category || r.class]: r.type });

/** The category an OSM result looks like, or null. */
function suggestType(r) {
  const t = tagsOf(r);
  return Object.keys(CATEGORY).find((k) => CATEGORY[k].match(t)) || null;
}

function shape(r, wantType) {
  const phone = r.extratags?.phone || r.extratags?.['contact:phone'] || null;
  return {
    placeId: String(r.place_id),
    name: r.name || String(r.display_name || '').split(',')[0].trim(),
    address: r.display_name || '',
    lat: Number(r.lat),
    lng: Number(r.lon),
    phone: phone ? String(phone).split(';')[0].trim() : null,
    suggestedType: suggestType(r),
    matchesType: wantType && CATEGORY[wantType] ? CATEGORY[wantType].match(tagsOf(r)) : null,
  };
}

async function searchPlaces(q, type) {
  const cat = CATEGORY[type];
  const key = `s:${type || ''}:${q.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const query = cat && !q.toLowerCase().includes(cat.keyword.split(' ')[0]) ? `${q} ${cat.keyword}` : q;
  const raw = await throttled(() => call('/search', { q: query, limit: 8 }));
  let results = (Array.isArray(raw) ? raw : []).map((r) => shape(r, type)).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  if (cat) {
    // Prefer genuine places of the chosen category; only fall back to other hits when there are none.
    const matching = results.filter((r) => r.matchesType);
    if (matching.length) results = matching;
  }
  cacheSet(key, results);
  return results;
}

async function reverse(lat, lng) {
  const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const raw = await throttled(() => call('/reverse', { lat, lon: lng, zoom: 18 }));
  // Keep the coordinates the admin typed, never the provider's snapped ones.
  const value = raw && !raw.error ? { ...shape(raw), lat, lng } : null;
  cacheSet(key, value);
  return value;
}

module.exports = { searchPlaces, reverse, isConfigured, GeocodeError };
