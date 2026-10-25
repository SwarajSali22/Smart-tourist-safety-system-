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
  // Place search / reverse geocoding (admin Help Centers form). Defaults to the public OpenStreetMap
  // Nominatim service, whose policy requires an identifying User-Agent — set GEOCODE_USER_AGENT.
  geocode: {
    baseUrl: (process.env.GEOCODE_BASE_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, ''),
    userAgent: process.env.GEOCODE_USER_AGENT || '',
    email: process.env.GEOCODE_EMAIL || '',
  },
  // AI Copilot (optional). Uses the Google Gemini API FREE tier (Google AI Studio key, no billing). Without
  // GEMINI_API_KEY the Copilot reports itself as unavailable and the rest of the application is unaffected.
  // Maps/places data comes from public OpenStreetMap services (no key).
  copilot: {
    apiKey: process.env.GEMINI_API_KEY || '',
    // Free models tried in order; each model has its own free quota, so the next one is used if the first is exhausted.
    models: (process.env.COPILOT_MODELS || process.env.COPILOT_MODEL || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash')
      .split(',').map((m) => m.trim()).filter(Boolean),
    maxOutputTokens: Number(process.env.COPILOT_MAX_OUTPUT_TOKENS) || 4096,
    dailyLimitPerUser: Number(process.env.COPILOT_DAILY_LIMIT) || 100,
    overpassUrls: (process.env.OVERPASS_URLS || 'https://overpass.openstreetmap.fr/api/interpreter,https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter')
      .split(',').map((s) => s.trim()).filter(Boolean),
    routingFootUrl: (process.env.COPILOT_ROUTING_FOOT_URL || 'https://routing.openstreetmap.de/routed-foot').replace(/\/+$/, ''),
    routingDrivingUrl: (process.env.COPILOT_ROUTING_DRIVING_URL || process.env.ROUTING_BASE_URL || 'https://router.project-osrm.org').replace(/\/+$/, ''),
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TWILIO_FROM || '',
  },
};

module.exports = env;
