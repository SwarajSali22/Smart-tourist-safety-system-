/**
 * Test harness (node:test + supertest).
 *
 * Each test FILE runs in its own process and gets its own throwaway database
 * (`sts_test_<random>`) on the same MongoDB cluster as MONGODB_URI — real data is
 * never touched — which is dropped when the file finishes.
 *
 *   npm test            # runs everything in tests/
 *
 * Requires MONGODB_URI (from backend/.env or the environment).
 */
process.env.NODE_ENV = 'test';

const path = require('path');
const dns = require('dns');
const crypto = require('crypto');

// Same workaround as src/server.js (some networks can't resolve Atlas SRV records).
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* ignore */ }

require('dotenv').config({ path: path.join(__dirname, '../.env') });
process.env.MONGODB_DB = `sts_test_${crypto.randomBytes(5).toString('hex')}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-test-refresh-secret';
process.env.BCRYPT_ROUNDS = '4'; // fast hashing in tests

const mongoose = require('mongoose');
const request = require('supertest');
const env = require('../src/config/env');
const models = require('../src/models');
const { hashPassword, generateDeviceApiKey, hashDeviceApiKey } = require('../src/services/auth.service');

if (!env.mongoUri) {
  console.error('MONGODB_URI is not set — the tests need a MongoDB cluster (a throwaway database is created on it).');
  process.exit(1);
}

const app = require('../src/app');

const PASSWORD = 'Test-Password-123';
let counter = 0;

async function connect() {
  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName });
  // Build the unique / sparse / 2dsphere indexes the code relies on.
  await Promise.all(Object.values(models).map((m) => m.init()));
}

async function disconnect() {
  try { await mongoose.connection.dropDatabase(); } catch { /* ignore */ }
  await mongoose.disconnect();
}

/** Creates a user directly in the DB (admins can't self-register) and returns { user, token, password }. */
async function createUser(role = 'tourist', overrides = {}) {
  counter += 1;
  const user = await models.User.create({
    name: overrides.name || `${role} ${counter}`,
    email: overrides.email || `${role}${counter}.${crypto.randomBytes(3).toString('hex')}@example.test`,
    passwordHash: await hashPassword(PASSWORD),
    role,
    ...overrides,
  });
  if (role === 'tourist') await models.TouristProfile.create({ user: user._id });
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  return { user, token: res.body.accessToken, refreshToken: res.body.refreshToken, password: PASSWORD };
}

/** Registers a wristband for a tourist (DB-level, returns the plaintext key like the admin UI does). */
async function createDevice(tourist, overrides = {}) {
  const apiKey = generateDeviceApiKey();
  counter += 1;
  const device = await models.Device.create({
    deviceId: overrides.deviceId || `TEST-${counter}-${crypto.randomBytes(2).toString('hex')}`,
    tourist: tourist._id,
    apiKeyHash: await hashDeviceApiKey(apiKey),
    isSimulated: true,
    status: 'active',
    ...overrides,
  });
  await models.TouristProfile.findOneAndUpdate({ user: tourist._id }, { device: device._id }, { upsert: true });
  return { device, apiKey, headers: { 'X-Device-Id': device.deviceId, 'X-Api-Key': apiKey } };
}

/** A square zone centred on (lat, lng), `half` degrees each way. */
async function createZone(type, lat, lng, half = 0.01, extra = {}) {
  return models.Zone.create({
    name: `${type} zone ${++counter}`,
    type,
    riskLevel: type === 'danger' ? 80 : 40,
    geometry: { type: 'Polygon', coordinates: [[[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half], [lng - half, lat - half]]] },
    ...extra,
  });
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Polls `fn` until it returns a truthy value (for fire-and-forget side effects like notification hooks). */
async function eventually(fn, { timeout = 8000, interval = 150, message = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

module.exports = { app, request, env, models, mongoose, connect, disconnect, createUser, createDevice, createZone, auth, eventually, PASSWORD };
