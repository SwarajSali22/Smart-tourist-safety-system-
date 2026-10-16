const { SafetyCheck, User } = require('../models');
const env = require('../config/env');
const { escalateUnsafeResponse } = require('../services/safetyCheck/escalate');
const { evaluateRisk } = require('../services/riskAssessment/evaluateRisk');

// ── POST /api/safety-checks/trigger  (admin only) ─────────────────────────────
async function triggerCheck(req, res, next) {
  try {
    const { tourist } = req.body;
    if (!tourist) {
      return res.status(400).json({ success: false, message: 'tourist is required' });
    }

    const touristUser = await User.findOne({ _id: tourist, role: 'tourist' });
    if (!touristUser) {
      return res.status(404).json({ success: false, message: 'Tourist not found' });
    }

    const safetyCheck = await SafetyCheck.create({
      tourist,
      scheduledAt: new Date(),
      triggeredBy: 'admin',
    });

    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('safetycheck:prompt', safetyCheck);
      io.to(`tourist:${tourist}`).emit('safetycheck:prompt', safetyCheck);
    }

    return res.status(201).json({ success: true, safetyCheck });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/safety-checks/:id/respond  (tourist only, must own it) ─────────
async function respondToCheck(req, res, next) {
  try {
    const { response, message } = req.body;
    if (!['safe', 'unsafe'].includes(response)) {
      return res.status(400).json({ success: false, message: "response must be 'safe' or 'unsafe'" });
    }

    const safetyCheck = await SafetyCheck.findOne({ _id: req.params.id, tourist: req.user.id });
    if (!safetyCheck) {
      return res.status(404).json({ success: false, message: 'Safety check not found' });
    }
    if (safetyCheck.respondedAt) {
      return res.status(409).json({ success: false, message: 'Already responded' });
    }

    safetyCheck.respondedAt = new Date();
    safetyCheck.response = response;
    safetyCheck.message = message || null;
    await safetyCheck.save();

    let incident = null;
    if (response === 'unsafe') {
      // escalateUnsafeResponse triggers its own forced risk re-evaluation.
      incident = await escalateUnsafeResponse(safetyCheck, req.app.get('io'));
    } else {
      // A discrete, meaningful event — always re-evaluate, bypassing the
      // telemetry-path throttle in evaluateRisk.
      await evaluateRisk(req.user.id, req.app.get('io'), { force: true });
    }

    const io = req.app.get('io');
    if (io) {
      const payload = { safetyCheck, incident };
      io.to('admin').emit('safetycheck:response', payload);
      io.to(`tourist:${req.user.id}`).emit('safetycheck:response', payload);
    }

    return res.json({ success: true, safetyCheck, incident });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/safety-checks/mine  (tourist only) ───────────────────────────────
async function getMyCheck(req, res, next) {
  try {
    const safetyCheck = await SafetyCheck.findOne({ tourist: req.user.id })
      .sort({ scheduledAt: -1 })
      .limit(1);
    return res.json({
      success: true,
      safetyCheck: safetyCheck || null,
      config: {
        intervalMinutes: env.safetyCheckIntervalMinutes,
        responseWindowMinutes: env.safetyCheckResponseWindowMinutes,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/safety-checks  (admin only) ──────────────────────────────────────
async function listChecks(req, res, next) {
  try {
    const filter = {};
    if (req.query.escalated === 'true') filter.escalated = true;
    if (req.query.escalated === 'false') filter.escalated = false;

    const checks = await SafetyCheck.find(filter)
      .populate('tourist', 'name email')
      .sort({ scheduledAt: -1 })
      .limit(100)
      .lean();

    return res.json({ success: true, checks });
  } catch (err) {
    next(err);
  }
}

module.exports = { triggerCheck, respondToCheck, getMyCheck, listChecks };
