const { RiskAssessment, User } = require('../models');
const { evaluateRisk } = require('../services/riskAssessment/evaluateRisk');

// ── GET /api/risk/mine  (tourist only) ────────────────────────────────────────
async function getMyRisk(req, res, next) {
  try {
    const riskAssessment = await RiskAssessment.findOne({ tourist: req.user.id }).sort({ evaluatedAt: -1 });
    return res.json({ success: true, riskAssessment: riskAssessment || null });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/risk  (admin only) — latest assessment per tourist, for the risk board ─
async function listLatestRisk(req, res, next) {
  try {
    const latest = await RiskAssessment.aggregate([
      { $sort: { evaluatedAt: -1 } },
      { $group: { _id: '$tourist', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { score: -1 } },
    ]);
    await RiskAssessment.populate(latest, { path: 'tourist', select: 'name email isDemo' });
    return res.json({ success: true, assessments: latest });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/risk/:tourist/history  (admin, or the owning tourist) ───────────
async function getRiskHistory(req, res, next) {
  try {
    const { tourist } = req.params;
    if (req.user.role !== 'admin' && req.user.id !== tourist) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const history = await RiskAssessment.find({ tourist }).sort({ evaluatedAt: -1 }).limit(50).lean();
    return res.json({ success: true, history });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/risk/:tourist/evaluate  (admin only) — force re-evaluation ─────
async function forceEvaluate(req, res, next) {
  try {
    const { tourist } = req.params;
    const touristUser = await User.findOne({ _id: tourist, role: 'tourist' });
    if (!touristUser) {
      return res.status(404).json({ success: false, message: 'Tourist not found' });
    }

    const { riskAssessment, incident } = await evaluateRisk(tourist, req.app.get('io'), { force: true });
    return res.status(201).json({ success: true, riskAssessment, incident });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyRisk, listLatestRisk, getRiskHistory, forceEvaluate };
