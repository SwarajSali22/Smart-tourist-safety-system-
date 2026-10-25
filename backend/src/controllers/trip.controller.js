const { Trip, Device } = require('../models');
const { logActivity } = require('../services/activity/logActivity');
const { getIo } = require('../services/realtime');

const fail = (res, code, message) => res.status(code).json({ success: false, message });

async function loadOwn(req, res) {
  const trip = await Trip.findById(req.params.id);
  if (!trip) { fail(res, 404, 'Trip not found'); return null; }
  // Tourists reach only their own trips; staff are read-only via the list endpoint.
  if (String(trip.tourist) !== req.user.id) { fail(res, 404, 'Trip not found'); return null; }
  return trip;
}

const tripView = (t) => {
  const o = t.toObject ? t.toObject() : t;
  const pending = (o.stops || []).filter((s) => s.status === 'pending');
  const now = Date.now();
  o.overdueStops = pending.filter((s) => now - new Date(s.expectedArrival).getTime() > 0).length;
  return o;
};

// POST /api/trips  (tourist)
async function createTrip(req, res, next) {
  try {
    const b = req.body;
    if (new Date(b.endAt) <= new Date(b.startAt)) return fail(res, 400, 'endAt: must be after the start time');
    const trip = await Trip.create({
      tourist: req.user.id, name: b.name, destination: b.destination, startAt: b.startAt, endAt: b.endAt,
      checkInEveryMin: b.checkInEveryMin || 0,
      ...(b.deviationThresholdM ? { deviationThresholdM: b.deviationThresholdM } : {}),
      stops: b.stops.map((s) => ({ name: s.name, location: { lat: s.lat, lng: s.lng }, expectedArrival: s.expectedArrival, ...(s.radiusM ? { radiusM: s.radiusM } : {}) })),
    });
    return res.status(201).json({ success: true, trip: tripView(trip) });
  } catch (err) { next(err); }
}

// GET /api/trips  (tourist: own; admin: everyone's, ?active=1 ?overdue=1)
async function listTrips(req, res, next) {
  try {
    const filter = {};
    if (req.user.role === 'tourist') filter.tourist = req.user.id;
    if (req.query.active === '1') filter.status = 'active';
    else if (req.query.status) filter.status = req.query.status;
    const trips = await Trip.find(filter).populate('tourist', 'name email isDemo').sort({ startAt: -1 }).limit(200).lean();
    // Which trips belong to a simulated device? Shown so simulated data is never mistaken for real tracking.
    const devs = await Device.find({ tourist: { $in: trips.map((t) => t.tourist?._id || t.tourist) } }).select('tourist isSimulated type').lean();
    const sim = new Map(devs.map((d) => [String(d.tourist), d.isSimulated ? 'simulated' : d.type === 'phone' ? 'phone' : 'wristband']));
    let rows = trips.map((t) => ({ ...tripView(t), trackingSource: sim.get(String(t.tourist?._id || t.tourist)) || 'none' }));
    if (req.query.overdue === '1') rows = rows.filter((t) => t.status === 'active' && (t.overdueStops > 0 || t.alerts?.some((a) => !a.acknowledged)));
    return res.json({ success: true, trips: rows });
  } catch (err) { next(err); }
}

async function getTrip(req, res, next) {
  try {
    const trip = await loadOwn(req, res); if (!trip) return undefined;
    return res.json({ success: true, trip: tripView(trip) });
  } catch (err) { next(err); }
}

// PATCH /api/trips/:id/start
async function startTrip(req, res, next) {
  try {
    const trip = await loadOwn(req, res); if (!trip) return undefined;
    if (trip.status !== 'planned') return fail(res, 409, `A ${trip.status} trip cannot be started`);
    trip.status = 'active';
    if (trip.checkInEveryMin) trip.nextCheckInDue = new Date(Date.now() + trip.checkInEveryMin * 60000);
    await trip.save();
    return res.json({ success: true, trip: tripView(trip) });
  } catch (err) { next(err); }
}

// POST /api/trips/:id/stops/:stopId/arrive — "I've safely reached this destination"
async function arriveAtStop(req, res, next) {
  try {
    const trip = await loadOwn(req, res); if (!trip) return undefined;
    if (!['planned', 'active'].includes(trip.status)) return fail(res, 409, 'This trip is no longer active');
    const stop = trip.stops.id(req.params.stopId);
    if (!stop) return fail(res, 404, 'Stop not found');
    if (stop.status === 'pending') {
      stop.status = 'arrived'; stop.arrivedAt = new Date(); stop.arrivedVia = 'manual';
      if (trip.status === 'planned') trip.status = 'active';
      await trip.save();
    }
    return res.json({ success: true, trip: tripView(trip) });
  } catch (err) { next(err); }
}

// POST /api/trips/:id/check-in — confirms the tourist is OK and schedules the next check-in
async function checkIn(req, res, next) {
  try {
    const trip = await loadOwn(req, res); if (!trip) return undefined;
    if (trip.status !== 'active') return fail(res, 409, 'Check-ins are only for active trips');
    const now = new Date();
    trip.lastCheckInAt = now; trip.checkInAlertedAt = null;
    if (trip.checkInEveryMin) trip.nextCheckInDue = new Date(now.getTime() + trip.checkInEveryMin * 60000);
    trip.alerts.forEach((a) => { if (a.kind === 'checkin_missed') a.acknowledged = true; });
    await trip.save();
    return res.json({ success: true, trip: tripView(trip) });
  } catch (err) { next(err); }
}

// POST /api/trips/:id/acknowledge — "I'm fine" for any open warning (no further alerts for the same event)
async function acknowledge(req, res, next) {
  try {
    const trip = await loadOwn(req, res); if (!trip) return undefined;
    trip.alerts.forEach((a) => { a.acknowledged = true; });
    trip.warningsAcknowledgedAt = new Date();
    await trip.save();
    getIo()?.to('admin').emit('trip:alert', { trip: trip._id, tourist: String(trip.tourist), kind: 'acknowledged', message: 'Tourist confirmed they are fine' });
    return res.json({ success: true, trip: tripView(trip) });
  } catch (err) { next(err); }
}

async function finish(req, res, next, status) {
  try {
    const trip = await loadOwn(req, res); if (!trip) return undefined;
    if (['completed', 'cancelled'].includes(trip.status)) return res.json({ success: true, trip: tripView(trip) });
    trip.status = status;
    if (status === 'cancelled') trip.cancelledAt = new Date(); else trip.completedAt = new Date();
    await trip.save();
    await logActivity({ req, action: `trip.${status}`, targetModel: 'Trip', targetId: trip._id, summary: trip.name });
    return res.json({ success: true, trip: tripView(trip) });
  } catch (err) { next(err); }
}
const cancelTrip = (req, res, next) => finish(req, res, next, 'cancelled');
const completeTrip = (req, res, next) => finish(req, res, next, 'completed');

module.exports = { createTrip, listTrips, getTrip, startTrip, arriveAtStop, checkIn, acknowledge, cancelTrip, completeTrip };
