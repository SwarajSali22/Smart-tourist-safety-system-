const env = require('../config/env');
const { runCopilot, isConfigured, CopilotError } = require('../services/copilot/engine');

// Per-user daily question cap (in memory; resets at midnight UTC and on restart) — a cost guard.
const usage = new Map();
function takeQuota(userId) {
  const key = `${userId}:${new Date().toISOString().slice(0, 10)}`;
  const n = (usage.get(key) || 0) + 1;
  if (usage.size > 5000) usage.clear();
  usage.set(key, n);
  return n <= env.copilot.dailyLimitPerUser;
}
const resetQuota = () => usage.clear();

// ── GET /api/copilot/status  (admin, tourist) ────────────────────────────────
function status(req, res) {
  res.json({
    success: true,
    available: isConfigured(),
    model: isConfigured() ? env.copilot.models[0] : null,
    mapData: 'OpenStreetMap (Overpass, Nominatim, OSRM)',
    role: req.user.role,
    dailyLimit: env.copilot.dailyLimitPerUser,
  });
}

// ── POST /api/copilot/chat  (admin, tourist) ─────────────────────────────────
// Body: { messages: [{role, content}], lang, location? }  — the browser keeps the conversation and
// resends it; the server re-reads live data on every question and stores nothing about the chat.
async function chat(req, res, next) {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ success: false, code: 'not_configured', message: 'The AI Copilot is not configured on this server.' });
    }
    if (!takeQuota(req.user.id)) {
      return res.status(429).json({ success: false, code: 'daily_limit', message: 'Daily Copilot question limit reached. Try again tomorrow.' });
    }
    const { messages, lang, location } = req.body;
    const result = await runCopilot({
      user: { id: req.user.id, role: req.user.role },
      messages,
      lang,
      // A browser fix is only used for tourists asking about themselves.
      browserLocation: req.user.role === 'tourist' ? location || null : null,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof CopilotError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    return next(err);
  }
}

module.exports = { status, chat, resetQuota };
