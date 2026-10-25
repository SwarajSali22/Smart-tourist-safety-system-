const { Trip, Device } = require('../../models');
const { haversineKm } = require('../geo/haversine');
const { distanceToPathM } = require('../geo/pathDistance');
const { notifyUser, notifyAdmins } = require('../notifications/notify');
const { logActivity } = require('../activity/logActivity');
const thresholds = require('../../config/thresholds');

const MIN = 60 * 1000;

/**
 * Trip monitoring thresholds (all overridable via env). None of these ever raise an SOS by
 * themselves: a missed check-in or a detour sends a warning the tourist can confirm or dismiss,
 * and admins get an informational notification — escalation to an emergency stays a human decision.
 */
const cfg = () => ({
  stopGraceMs: (Number(process.env.TRIP_STOP_GRACE_MIN) || 15) * MIN,
  checkInGraceMs: (Number(process.env.TRIP_CHECKIN_GRACE_MIN) || 10) * MIN,
});

const touristLink = '/tourist/trips';
const adminLink = '/admin/trips';

async function raise(trip, io, { kind, message, dedupe, simulated }) {
  const note = simulated ? `${message} (simulated device location)` : message;
  trip.alerts.push({ kind, message: note });
  if (trip.alerts.length > 50) trip.alerts = trip.alerts.slice(-50);
  await notifyUser(trip.tourist, {
    type: 'general', title: 'Trip reminder', message: note, severity: 'warning', link: touristLink,
    payload: { trip: trip._id, kind }, dedupeKey: `trip:${trip._id}:${dedupe}`,
  });
  await notifyAdmins({
    type: 'general', title: `Trip alert: ${trip.name}`, message: note, severity: 'warning', link: adminLink,
    payload: { trip: trip._id, tourist: String(trip.tourist), kind }, dedupeKey: `trip-admin:${trip._id}:${dedupe}`,
  });
  io?.to(`tourist:${trip.tourist}`).emit('trip:alert', { trip: trip._id, kind, message: note });
  io?.to('admin').emit('trip:alert', { trip: trip._id, tourist: String(trip.tourist), kind, message: note });
  await logActivity({ actor: null, role: 'system', action: `trip.${kind}`, targetModel: 'Trip', targetId: trip._id, summary: note });
}

/** Called every sweep (60 s) for active trips. */
async function sweepTrips(io, now = Date.now()) {
  const { stopGraceMs, checkInGraceMs } = cfg();

  // planned trips whose window has started become active (the tourist can also start them manually)
  await Trip.updateMany({ status: 'planned', startAt: { $lte: new Date(now) }, endAt: { $gt: new Date(now) } }, { $set: { status: 'active' } });

  const trips = await Trip.find({ status: 'active' });
  for (const trip of trips) {
    const device = await Device.findOne({ tourist: trip.tourist }).select('lastLocation lastSeen isSimulated').lean();
    const fresh = device?.lastLocation?.lat != null && device.lastSeen && now - new Date(device.lastSeen).getTime() <= thresholds.device.staleMs;
    const simulated = Boolean(device?.isSimulated);
    let dirty = false;

    // 1. GPS-confirmed arrival (only with a fresh position)
    if (fresh) {
      for (const stop of trip.stops) {
        if (stop.status === 'pending' && haversineKm(device.lastLocation, stop.location) * 1000 <= stop.radiusM) {
          stop.status = 'arrived'; stop.arrivedAt = new Date(now); stop.arrivedVia = 'gps';
          dirty = true;
        }
      }
    }

    // 2. Overdue stops — alerted once per stop
    for (const stop of trip.stops) {
      if (stop.status === 'pending' && !stop.overdueAlertedAt && now - new Date(stop.expectedArrival).getTime() > stopGraceMs) {
        stop.overdueAlertedAt = new Date(now);
        dirty = true;
        await raise(trip, io, { kind: 'stop_overdue', message: `Not yet confirmed at "${stop.name}" (expected ${new Date(stop.expectedArrival).toLocaleString()}).`, dedupe: `stop:${stop._id}`, simulated: false });
      }
    }

    // 3. Missed scheduled check-in — alerted once per due time
    if (trip.checkInEveryMin > 0 && trip.nextCheckInDue && !trip.checkInAlertedAt && now - new Date(trip.nextCheckInDue).getTime() > checkInGraceMs) {
      trip.checkInAlertedAt = new Date(now);
      dirty = true;
      await raise(trip, io, { kind: 'checkin_missed', message: `Scheduled check-in for "${trip.name}" was not confirmed.`, dedupe: `checkin:${new Date(trip.nextCheckInDue).getTime()}`, simulated: false });
    }

    // 4. Route deviation — needs a fresh position and at least two stops; alerted once until back on route
    const path = trip.stops.map((s) => s.location);
    if (fresh && path.length >= 2) {
      const off = distanceToPathM(device.lastLocation, path);
      if (off > trip.deviationThresholdM && !trip.deviationAlertedAt) {
        trip.deviationAlertedAt = new Date(now);
        dirty = true;
        await raise(trip, io, { kind: 'deviation', message: `About ${(off / 1000).toFixed(1)} km away from the planned route for "${trip.name}".`, dedupe: `deviation:${now}`, simulated });
      } else if (off <= trip.deviationThresholdM && trip.deviationAlertedAt) {
        trip.deviationAlertedAt = null;
        dirty = true;
      }
    }

    // 5. Trip window over: nothing left pending → completed; otherwise flag once and leave it to the tourist/admin
    if (now > new Date(trip.endAt).getTime() && trip.stops.every((s) => s.status !== 'pending')) {
      trip.status = 'completed'; trip.completedAt = new Date(now); dirty = true;
    }
    if (dirty) await trip.save();
  }
}

module.exports = { sweepTrips };
