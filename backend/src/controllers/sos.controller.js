const { SOSEvent, Device } = require('../models');
const { triggerSos, SosAlreadyActiveError } = require('../services/sos/triggerSos');
const { evaluateRisk } = require('../services/riskAssessment/evaluateRisk');

// ── POST /api/sos  (tourist only — software fallback, no device needed) ──────
async function createSos(req, res, next) {
  try {
    const device = await Device.findOne({ tourist: req.user.id });
    if (!device || device.lastLocation?.lat == null) {
      return res.status(400).json({
        success: false,
        message: 'No device location available yet — a linked device must have sent telemetry first',
      });
    }

    const { sosEvent, incident } = await triggerSos({
      tourist: req.user.id,
      device: device._id,
      location: device.lastLocation,
      source: 'app',
      io: req.app.get('io'),
    });

    // An app-triggered SOS must show up in the risk score straight away (the
    // telemetry path already does this) — but never let that fail the SOS itself.
    try {
      await evaluateRisk(req.user.id, req.app.get('io'), { force: true });
    } catch (riskErr) {
      console.error('[sos] risk re-evaluation failed:', riskErr.message);
    }

    return res.status(201).json({ success: true, sosEvent, incident });
  } catch (err) {
    if (err instanceof SosAlreadyActiveError) {
      return res.status(409).json({ success: false, message: err.message });
    }
    next(err);
  }
}

// ── GET /api/sos/mine  (tourist only) ─────────────────────────────────────────
async function getMySos(req, res, next) {
  try {
    const sosEvent = await SOSEvent.findOne({ tourist: req.user.id })
      .sort({ createdAt: -1 })
      .limit(1);
    return res.json({ success: true, sosEvent: sosEvent || null });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/sos  (admin only) ────────────────────────────────────────────────
async function listSos(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const events = await SOSEvent.find(filter)
      .populate('tourist', 'name email')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
}

module.exports = { createSos, getMySos, listSos };
