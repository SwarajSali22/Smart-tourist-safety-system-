const { User, TouristProfile, Device } = require('../models');

// ── GET /api/tourists  (admin only) ──────────────────────────────────────────
async function listTourists(req, res, next) {
  try {
    const users = await User.find({ role: 'tourist' })
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .lean();

    // Pull device references from profiles in one query
    const profiles = await TouristProfile.find({
      user: { $in: users.map((u) => u._id) },
    })
      .select('user device')
      .lean();

    const devices = await Device.find({ _id: { $in: profiles.map((p) => p.device).filter(Boolean) } })
      .select('type')
      .lean();
    const typeByDevice = {};
    devices.forEach((d) => { typeByDevice[d._id.toString()] = d.type || 'wristband'; });

    const deviceByUser = {};
    profiles.forEach((p) => { deviceByUser[p.user.toString()] = p.device; });

    const tourists = users.map((u) => {
      const device = deviceByUser[u._id.toString()] || null;
      return { ...u, device, deviceType: device ? typeByDevice[device.toString()] || null : null };
    });

    res.json({ success: true, tourists });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/tourists/me  (tourist — own profile) ─────────────────────────────
async function getMyProfile(req, res, next) {
  try {
    let profile = await TouristProfile.findOne({ user: req.user.id })
      .populate('device', 'deviceId status isSimulated lastSeen')
      .lean();

    if (!profile) {
      // Auto-create if somehow missing (shouldn't happen post-Phase 3 register)
      profile = await TouristProfile.create({ user: req.user.id });
    }

    res.json({ success: true, profile });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/tourists/me/emergency-contacts  (tourist) ─────────────────────
async function updateEmergencyContacts(req, res, next) {
  try {
    const { emergencyContacts } = req.body;
    if (!Array.isArray(emergencyContacts)) {
      return res.status(400).json({ success: false, message: 'emergencyContacts must be an array' });
    }

    // Basic validation: each contact must have name + phone
    for (const c of emergencyContacts) {
      if (!c.name || !c.phone) {
        return res.status(400).json({
          success: false,
          message: 'Each emergency contact must have a name and phone',
        });
      }
    }

    const profile = await TouristProfile.findOneAndUpdate(
      { user: req.user.id },
      { emergencyContacts },
      { new: true, upsert: true }
    );

    res.json({ success: true, emergencyContacts: profile.emergencyContacts });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/tourists/me/itinerary  (tourist) ──────────────────────────────
async function updateItinerary(req, res, next) {
  try {
    const { itinerary } = req.body;
    if (!Array.isArray(itinerary) || itinerary.length > 50) {
      return res.status(400).json({ success: false, message: 'itinerary must be an array (max 50 items)' });
    }
    const clean = [];
    for (const item of itinerary) {
      const destination = typeof item.destination === 'string' ? item.destination.trim() : '';
      if (!destination) {
        return res.status(400).json({ success: false, message: 'Each itinerary item needs a destination' });
      }
      const arrivalAt = item.arrivalAt ? new Date(item.arrivalAt) : null;
      const departureAt = item.departureAt ? new Date(item.departureAt) : null;
      if ((arrivalAt && isNaN(arrivalAt)) || (departureAt && isNaN(departureAt))) {
        return res.status(400).json({ success: false, message: 'Invalid date in itinerary' });
      }
      if (arrivalAt && departureAt && departureAt < arrivalAt) {
        return res.status(400).json({ success: false, message: `Departure is before arrival for "${destination}"` });
      }
      clean.push({ destination, arrivalAt, departureAt, notes: item.notes || null });
    }
    const profile = await TouristProfile.findOneAndUpdate(
      { user: req.user.id },
      { itinerary: clean },
      { new: true, upsert: true }
    );
    res.json({ success: true, itinerary: profile.itinerary });
  } catch (err) {
    next(err);
  }
}

module.exports = { listTourists, getMyProfile, updateEmergencyContacts, updateItinerary };
