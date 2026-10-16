/**
 * Shared helpers for the demo scripts (demoScenarios.js, demoReset.js).
 *
 * Demo data is SIMULATED: every demo user, device and zone carries `isDemo: true`,
 * the UI labels it "Simulated", demo events are chained in a separate audit chain,
 * simulated tourists never trigger real SMS, and `demoReset.js` removes exactly
 * that data and nothing else.
 */
const path = require('path');
const dns = require('dns');

// Same workaround as backend/src/server.js (some networks can't resolve Atlas SRV records).
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* ignore */ }

// scripts/ has no node_modules of its own — resolve dependencies through backend/'s.
const backendRequire = require('module').createRequire(path.join(__dirname, '../../backend/package.json'));
backendRequire('dotenv').config({ path: path.join(__dirname, '../../backend/.env') });

const mongoose = backendRequire('mongoose');
const models = require('../../backend/src/models');
const { hashPassword } = require('../../backend/src/services/auth.service');
const env = require('../../backend/src/config/env');

const ARGS = (() => {
  const out = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i += 1; }
    } else out._.push(a);
  }
  return out;
})();

const BASE = String(ARGS.base || process.env.DEMO_API_BASE || `http://localhost:${env.port}/api`).replace(/\/$/, '');
const APP_URL = String(ARGS.app || process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  if (!env.mongoUri) throw new Error('MONGODB_URI is not set (backend/.env).');
  await mongoose.connect(env.mongoUri, env.mongoDbName ? { dbName: env.mongoDbName } : undefined);
}
async function disconnect() { await mongoose.disconnect(); }

/** Calls the real HTTP API — the demo drives the same endpoints the apps and devices use. */
async function api(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, ok: res.ok, json };
}

async function assertBackendUp() {
  try {
    const r = await api('GET', '/health');
    if (!r.ok) throw new Error(`health check returned ${r.status}`);
  } catch (err) {
    throw new Error(`Can't reach the backend at ${BASE} (${err.message}). Start it with "npm start" in backend/ first.`);
  }
}

// ── geometry ────────────────────────────────────────────────────────────────────
const box = (lat, lng, half) => ({
  type: 'Polygon',
  coordinates: [[[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half], [lng - half, lat - half]]],
});

/** The demo "city": a safe plaza, a restricted old market and a danger riverbank (central Delhi). */
const DEMO_ZONES = [
  { key: 'plaza', name: 'DEMO Tourist Plaza', type: 'safe', riskLevel: 5, center: [28.6139, 77.209], half: 0.004 },
  { key: 'market', name: 'DEMO Old Market (restricted)', type: 'restricted', riskLevel: 45, center: [28.62, 77.22], half: 0.0035 },
  { key: 'river', name: 'DEMO Riverbank (danger)', type: 'danger', riskLevel: 85, center: [28.605, 77.225], half: 0.0035 },
];
const START = [28.6139, 77.209];

function lerp(a, b, t) { return a + (b - a) * t; }
/** n evenly spaced points from `from` to `to` (excluding `from`), with ~5 m of GPS-like jitter. */
function route(from, to, n) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const jitter = () => (Math.random() - 0.5) * 0.00005;
    return [lerp(from[0], to[0], t) + jitter(), lerp(from[1], to[1], t) + jitter()];
  });
}

// ── demo data lifecycle ───────────────────────────────────────────────────────────
const randomPassword = () => `Demo-${Math.random().toString(36).slice(2, 10)}!${Math.floor(Math.random() * 90 + 10)}`;

/**
 * Deletes ONLY demo data: users/devices/zones flagged isDemo, plus records that belong to
 * demo tourists. Returns counts. `dry` counts without deleting.
 */
async function cleanupDemo({ dry = false } = {}) {
  const demoUsers = await models.User.find({ isDemo: true }).select('_id').lean();
  const ids = demoUsers.map((u) => u._id);
  const byTourist = { tourist: { $in: ids } };

  const counts = {};
  const run = async (label, model, filter) => {
    counts[label] = dry ? await model.countDocuments(filter) : (await model.deleteMany(filter)).deletedCount;
  };

  await run('notifications', models.Notification, { $or: [{ isDemo: true }, { recipient: { $in: ids } }, { 'payload.tourist': { $in: ids } }] });
  await run('sos events', models.SOSEvent, byTourist);
  await run('incidents', models.Incident, byTourist);
  await run('geofence events', models.GeofenceEvent, byTourist);
  await run('risk assessments', models.RiskAssessment, byTourist);
  await run('safety checks', models.SafetyCheck, byTourist);
  await run('location pings', models.LocationPing, byTourist);
  await run('tourist profiles', models.TouristProfile, { user: { $in: ids } });
  await run('devices', models.Device, { $or: [{ isDemo: true }, byTourist] });
  await run('zones', models.Zone, { isDemo: true });
  // the demo audit chain is separate from the real one, so it can be removed whole
  await run('audit proofs (demo chain)', models.AuditProof, { isDemo: true });
  await run('users', models.User, { isDemo: true });
  return counts;
}

module.exports = {
  mongoose, models, hashPassword, env, ARGS, BASE, APP_URL, sleep,
  connect, disconnect, api, assertBackendUp,
  box, DEMO_ZONES, START, lerp, route, randomPassword, cleanupDemo,
};
