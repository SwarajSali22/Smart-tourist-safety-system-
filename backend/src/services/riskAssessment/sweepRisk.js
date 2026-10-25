const { RiskAssessment } = require('../../models');
const { evaluateRisk } = require('./evaluateRisk');
const { autoResolveClearedRisk } = require('./escalateRisk');
const thresholds = require('../../config/thresholds');

/**
 * Risk is normally re-scored when telemetry arrives. If a device goes quiet, its last (high)
 * score would otherwise stay "current" forever. Each sweep therefore:
 *  1. re-scores tourists whose latest high/critical score is old (the stale-aware engine then stops
 *     counting zones it can no longer prove they are in), and
 *  2. closes risk alerts whose cause has passed (see autoResolveClearedRisk).
 * An SOS-forced score is refreshed too (it stays critical while the SOS is open, and drops once it is resolved).
 */
async function sweepRisk(io, now = Date.now()) {
  const old = new Date(now - thresholds.risk.refreshMs);
  const latest = await RiskAssessment.aggregate([
    { $sort: { evaluatedAt: -1 } },
    { $group: { _id: '$tourist', doc: { $first: '$$ROOT' } } },
    { $match: { 'doc.level': { $in: ['high', 'critical'] }, 'doc.evaluatedAt': { $lt: old } } },
    { $limit: 200 },
  ]);
  for (const row of latest) await evaluateRisk(row._id, io, { force: true });
  await autoResolveClearedRisk();
}

module.exports = { sweepRisk };
