const mongoose = require('mongoose');
const env = require('./env');

/**
 * Connects to MongoDB Atlas via Mongoose. Deliberately non-fatal: if
 * MONGODB_URI is missing or the connection fails, the API still starts so
 * /api/health can report a clear "disconnected" status instead of crashing
 * the whole server over a database outage. Later phases that need the
 * database (Phase 2+) should treat a disconnected state as a hard error at
 * the route level, not here.
 */
async function connectDB() {
  if (!env.mongoUri) {
    console.warn(
      '[db] MONGODB_URI is not set — skipping database connection. ' +
        'Add it to backend/.env to connect to MongoDB Atlas.'
    );
    return;
  }

  try {
    await mongoose.connect(env.mongoUri);
    console.log('[db] MongoDB connected');
  } catch (err) {
    console.error('[db] MongoDB connection error:', err.message);
  }
}

module.exports = connectDB;
