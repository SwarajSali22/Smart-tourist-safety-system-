const { SOSEvent, Device } = require('../models');
const { triggerSos, SosAlreadyActiveError } = require('../services/sos/triggerSos');
const { evaluateRisk } = require('../services/riskAssessment/evaluateRisk');

// ── POST /api/sos  (tourist only — software fallback, no device needed) ──────
async function createSos(req, res, next) {
  try {
    const device = await Device.findOne({ tourist: req.user.id });
    if (!device || device.lastLocation?.lat == null) {
      // Never invent a position. Explain what is missing so the tourist can fix it (and knows to call 112).
      const hint = !device
        ? 'Your phone has not shared a location yet. Turn on "Share my location" on the Home page, wait until it says Sharing, then try again.'
        : device.type === 'phone'
          ? 'Your phone has not shared a location yet. Turn on "Share my location" on the Home page, wait until it says Sharing, then try again.'
          : `The ${device.isSimulated ? 'simulator' : 'tracker'} assigned to your account (${device.deviceId}) has not reported a location, so your phone's GPS is not being recorded. Ask an administrator to remove it.`;
      return res.status(400).json({
        success: false,
        code: 'no_device_location',
        message: `No location is available for your SOS. ${hint} If you are in danger, call 112.`,
        deviceType: device?.type || null,
      });
    }

    const { sosEvent, incident } = await triggerSos({
      tourist: req.user.id,
      device: device._id,
      location: device.lastLocation,
      source: 'app',
      clientTriggeredAt: req.body.clientTriggeredAt && req.body.clientTriggeredAt <= new Date() ? req.body.clientTriggeredAt : null,
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

    const populateSort = (q) => q.populate('tourist', 'name email isDemo').sort({ createdAt: -1 });
    const events = await populateSort(SOSEvent.find(filter)).limit(100).lean();

    // The dashboard counts active SOS from this list, so every still-open SOS must be in it even when
    // more than 100 newer (resolved) events exist — otherwise the count silently drops old open ones.
    if (!req.query.status) {
      const have = new Set(events.map((e) => String(e._id)));
      const open = await populateSort(SOSEvent.find({ status: { $in: ['active', 'acknowledged'] }, _id: { $nin: [...have] } })).lean();
      events.push(...open);
      events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
}

module.exports = { createSos, getMySos, listSos };
