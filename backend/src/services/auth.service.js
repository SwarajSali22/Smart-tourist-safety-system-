const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// ── Password helpers ──────────────────────────────────────────────────────────

async function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptRounds);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ── JWT helpers ───────────────────────────────────────────────────────────────

function issueAccessToken(user) {
  if (!env.jwtSecret) throw new Error('JWT_SECRET is not configured');
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function issueRefreshToken(user) {
  if (!env.jwtRefreshSecret) throw new Error('JWT_REFRESH_SECRET is not configured');
  return jwt.sign(
    { sub: user._id.toString() },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiresIn }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

// ── Device API-key helpers ────────────────────────────────────────────────────
// Each device gets a random plaintext key once at registration.  Only the
// bcrypt hash is stored in the database.

const crypto = require('crypto');

function generateDeviceApiKey() {
  return crypto.randomBytes(32).toString('hex'); // 64-char hex string
}

async function hashDeviceApiKey(plainKey) {
  // Use a fixed cost of 10 for device keys (they are machine-checked,
  // so a slightly lower cost is acceptable over bcryptRounds which
  // is tuned for human-entered passwords).
  return bcrypt.hash(plainKey, 10);
}

async function verifyDeviceApiKey(plainKey, storedHash) {
  return bcrypt.compare(plainKey, storedHash);
}

module.exports = {
  hashPassword,
  verifyPassword,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateDeviceApiKey,
  hashDeviceApiKey,
  verifyDeviceApiKey,
};
