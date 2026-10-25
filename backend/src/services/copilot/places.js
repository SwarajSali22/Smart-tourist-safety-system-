const env = require('../../config/env');
const { haversineKm } = require('../geo/haversine');

/**
 * Real-world place discovery for the Copilot, from OpenStreetMap data:
 *   - nearby facilities (hospitals, police, pharmacies ...) via the Overpass API,
 *   - walking / driving routes via OSRM-compatible routing servers.
 * Neither needs an API key. Both are shared public services, so we: send an identifying User-Agent,
 * try a short list of mirrors, cap radius/results, time out quickly, and cache answers for a few minutes.
 * Anything that cannot be verified is reported as unavailable — never guessed.
 */

const TIMEOUT_MS = 12000;        // routing / single lookups
const MIRROR_TIMEOUT_MS = 9000;  // one Overpass mirror
const OVERPASS_DEADLINE_MS = 26000; // all mirrors together — a person in trouble should not wait longer
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 300;
const MAX_RADIUS_M = 25000;

/** category → OSM tag filters. These are what "hospital", "police" ... mean in OpenStreetMap. */
const CATEGORIES = {
  hospital: { filters: ['amenity=hospital', 'healthcare=hospital'], label: 'Hospital' },
  clinic: { filters: ['amenity=clinic', 'amenity=doctors', 'healthcare=clinic'], label: 'Clinic / doctor' },
  police: { filters: ['amenity=police'], label: 'Police station' },
  pharmacy: { filters: ['amenity=pharmacy', 'healthcare=pharmacy'], label: 'Pharmacy' },
  fire_station: { filters: ['amenity=fire_station'], label: 'Fire station' },
  emergency: { filters: ['emergency=ambulance_station', 'amenity=ambulance_station'], label: 'Ambulance station' },
};

let fetchImpl = (...args) => fetch(...args); // swapped out in tests
const setFetch = (fn) => { fetchImpl = fn || ((...args) => fetch(...args)); };

class PlacesError extends Error {}

const cache = new Map();
const cacheGet = (k) => {
  const hit = cache.get(k);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(k); return undefined; }
  return hit;
};
const cacheSet = (k, value) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, { at: Date.now(), value });
};
const clearCache = () => cache.clear();

const userAgent = () => env.geocode.userAgent || 'STS-SmartTouristSafety/1.0 (student project)';
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function buildQuery(lat, lng, radiusM, categories, limit) {
  const parts = [];
  for (const c of categories) {
    for (const f of CATEGORIES[c].filters) {
      const [k, v] = f.split('=');
      parts.push(`nwr(around:${radiusM},${lat},${lng})["${k}"="${v}"];`);
    }
  }
  // `out center` gives a point for ways/relations (hospital buildings are usually polygons).
  return `[out:json][timeout:10];(${parts.join('')});out center tags ${Math.max(limit * 4, 24)};`;
}

const addressOf = (t) => {
  const line = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city'] || t['addr:town'] || t['addr:village'], t['addr:postcode']].filter(Boolean).join(', ');
  return line || t['addr:full'] || null;
};

function categoryOf(tags, wanted) {
  for (const c of wanted) {
    if (CATEGORIES[c].filters.some((f) => { const [k, v] = f.split('='); return tags[k] === v; })) return c;
  }
  return wanted[0];
}

/** Links a person can open to navigate. Straight from coordinates, so they never depend on a provider key. */
function linksFor(from, to) {
  const osm = from
    ? `https://www.openstreetmap.org/directions?from=${from.lat}%2C${from.lng}&to=${to.lat}%2C${to.lng}`
    : `https://www.openstreetmap.org/?mlat=${to.lat}&mlon=${to.lng}#map=17/${to.lat}/${to.lng}`;
  const google = from
    ? `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${to.lat},${to.lng}`;
  return { directions: osm, googleMaps: google };
}

async function overpass(query) {
  const urls = env.copilot.overpassUrls;
  let lastErr = 'no Overpass server configured';
  const started = Date.now();
  for (const url of urls) {
    const left = OVERPASS_DEADLINE_MS - (Date.now() - started);
    if (left < 2000) break;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'User-Agent': userAgent(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(Math.min(MIRROR_TIMEOUT_MS, left)),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status} from ${new URL(url).host}`; continue; }
      const json = await res.json();
      if (!json || !Array.isArray(json.elements)) { lastErr = `unreadable response from ${new URL(url).host}`; continue; }
      return { elements: json.elements, host: new URL(url).host, dataTimestamp: json.osm3s?.timestamp_osm_base || null };
    } catch (err) {
      lastErr = `${new URL(url).host} ${err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : 'unreachable'}`;
    }
  }
  throw new PlacesError(`The map-data service is not responding right now (${lastErr})`);
}

/**
 * Nearest facilities of the given categories around a point, nearest first.
 * Distances are STRAIGHT-LINE (great-circle); use routeBetween() for road/walking distance.
 */
async function findNearby({ lat, lng, categories, radiusM = 3000, limit = 5 }) {
  const wanted = [...new Set(categories)].filter((c) => CATEGORIES[c]);
  if (!wanted.length) throw new PlacesError('Unknown facility category');
  const radius = Math.min(Math.max(Math.round(radiusM), 200), MAX_RADIUS_M);
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}:${radius}:${wanted.sort().join('+')}`;
  const hit = cacheGet(key);
  let raw; let fetchedAt; let cached = false;
  if (hit) { raw = hit.value; fetchedAt = new Date(hit.at); cached = true; } else {
    raw = await overpass(buildQuery(lat, lng, radius, wanted, limit));
    fetchedAt = new Date();
    cacheSet(key, raw);
  }
  const origin = { lat, lng };
  const seen = new Set();
  const places = [];
  for (const el of raw.elements) {
    const t = el.tags || {};
    const p = { lat: el.lat ?? el.center?.lat, lng: el.lon ?? el.center?.lon };
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (!t.name && !t['name:en']) continue; // unnamed features are not useful to a person in trouble
    const dedupe = `${(t.name || '').toLowerCase()}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const cat = categoryOf(t, wanted);
    places.push({
      name: t.name || t['name:en'],
      category: cat,
      categoryLabel: CATEGORIES[cat].label,
      lat: round(p.lat, 6),
      lng: round(p.lng, 6),
      straightLineKm: round(haversineKm(origin, p), 2),
      address: addressOf(t),
      phone: t.phone || t['contact:phone'] || null,
      // Shown only when OpenStreetMap has it; volunteers maintain it, so it can be out of date.
      openingHours: t.opening_hours || null,
      emergencyDepartment: t.emergency === 'yes' ? true : null,
      osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      links: linksFor(origin, p),
    });
  }
  places.sort((a, b) => a.straightLineKm - b.straightLineKm);
  return {
    places: places.slice(0, limit),
    totalFound: places.length,
    radiusM: radius,
    source: 'OpenStreetMap contributors (Overpass API)',
    server: raw.host,
    mapDataTimestamp: raw.dataTimestamp,
    fetchedAt: fetchedAt.toISOString(),
    cached,
    distanceType: 'straight-line',
  };
}

const ROUTERS = () => ({
  foot: env.copilot.routingFootUrl,
  driving: env.copilot.routingDrivingUrl,
});

/** Real road/path distance and time from an OSRM-compatible server. Best-effort: null when unavailable. */
async function routeBetween({ from, to, mode = 'foot' }) {
  const base = ROUTERS()[mode];
  if (!base) throw new PlacesError('Unknown travel mode');
  const url = `${base.replace(/\/+$/, '')}/route/v1/${mode === 'foot' ? 'foot' : 'driving'}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new PlacesError(`The routing service is not responding (${err.name === 'TimeoutError' ? 'timed out' : 'unreachable'})`);
  }
  if (!res.ok) throw new PlacesError(`The routing service returned an error (HTTP ${res.status})`);
  const json = await res.json().catch(() => null);
  const route = json?.code === 'Ok' ? json.routes?.[0] : null;
  if (!route) throw new PlacesError('No route could be found between those points');
  return {
    mode,
    distanceKm: round(route.distance / 1000, 2),
    durationMinutes: Math.round(route.duration / 60),
    distanceType: mode === 'foot' ? 'walking route' : 'driving route',
    source: 'OpenStreetMap routing (OSRM)',
    note: 'Estimate from public routing data; real conditions (traffic, closures) are not included.',
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { findNearby, routeBetween, linksFor, setFetch, clearCache, PlacesError, CATEGORIES, MAX_RADIUS_M };
