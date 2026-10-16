/**
 * Central place to read environment variables. Nothing else in the codebase
 * should touch `process.env` directly — import this instead, so every
 * required value and its default lives in one file.
 *
 * `dotenv` is loaded once, in src/server.js, before this module is used.
 */

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  // Tests use a separate database name on the same cluster (never the real data).
  mongoDbName: process.env.MONGODB_DB || '',
  // Rate limits are skipped under test unless a test switches them on.
  rateLimitEnabled: process.env.NODE_ENV !== 'test' && process.env.RATE_LIMIT_DISABLED !== '1',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || '',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  safetyCheckIntervalMinutes: Number(process.env.SAFETY_CHECK_INTERVAL_MINUTES) || 25,
  safetyCheckResponseWindowMinutes: Number(process.env.SAFETY_CHECK_RESPONSE_WINDOW_MINUTES) || 5,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_FROM || '',
  },
};

module.exports = env;
