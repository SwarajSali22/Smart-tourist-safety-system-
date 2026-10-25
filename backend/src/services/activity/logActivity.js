const { ActivityLog } = require('../../models');

const SENSITIVE = /pass(word)?|token|secret|apikey|authorization/i;

function clean(meta) {
  if (!meta || typeof meta !== 'object') return meta || null;
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !SENSITIVE.test(k)));
}

/** Never throws — logging must not break the request it observes. */
async function logActivity({ req, actor, role, action, outcome = 'success', targetModel, targetId, summary, metadata }) {
  try {
    await ActivityLog.create({
      actor: actor || req?.user?.id || null,
      actorRole: role || req?.user?.role || null,
      action,
      outcome,
      targetModel: targetModel || null,
      targetId: targetId ? String(targetId) : null,
      summary: summary || null,
      ip: req?.ip || null,
      metadata: clean(metadata),
    });
  } catch (err) {
    console.error('[activity] failed to log:', err.message);
  }
}

module.exports = { logActivity };
