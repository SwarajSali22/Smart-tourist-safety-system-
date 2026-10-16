const { Zone, GeofenceEvent } = require('../../models');

/**
 * Compares the zones a device is currently inside (from a $geoIntersects
 * query) against `device.currentZones`, logs GeofenceEvent enter/exit
 * records for the difference, and updates `device.currentZones` in place.
 * Does not save `device` — the caller (device.controller's ingestTelemetry)
 * saves it once alongside the other telemetry fields.
 *
 * Returns `{ entered, exited }`, each an array of `{ zone, eventType,
 * location }` with `zone` populated (`name type`) — the caller uses this
 * to emit socket events without a second query.
 */
async function evaluateGeofence(device, lat, lng) {
  const zonesHere = await Zone.find({
    isActive: true,
    geometry: {
      $geoIntersects: { $geometry: { type: 'Point', coordinates: [lng, lat] } },
    },
  }).select('_id name type');

  const zonesHereById = new Map(zonesHere.map((z) => [z._id.toString(), z]));
  const nowIds = new Set(zonesHereById.keys());
  const previousIds = new Set((device.currentZones || []).map((id) => id.toString()));

  const enteredIds = [...nowIds].filter((id) => !previousIds.has(id));
  const exitedIds = [...previousIds].filter((id) => !nowIds.has(id));

  const location = { lat, lng };
  const entered = [];
  const exited = [];

  for (const zoneId of enteredIds) {
    const event = await GeofenceEvent.create({
      tourist: device.tourist,
      zone: zoneId,
      device: device._id,
      eventType: 'enter',
      location,
    });
    entered.push({
      _id: event._id,
      zone: zonesHereById.get(zoneId),
      eventType: 'enter',
      location,
      resolved: false,
      createdAt: event.createdAt,
    });
  }

  for (const zoneId of exitedIds) {
    const event = await GeofenceEvent.create({
      tourist: device.tourist,
      zone: zoneId,
      device: device._id,
      eventType: 'exit',
      location,
    });
    await GeofenceEvent.findOneAndUpdate(
      { tourist: device.tourist, zone: zoneId, eventType: 'enter', resolved: false },
      { resolved: true, resolvedAt: new Date() }
    );
    const zone = await Zone.findById(zoneId).select('name type');
    exited.push({
      _id: event._id,
      zone,
      eventType: 'exit',
      location,
      resolved: false,
      createdAt: event.createdAt,
    });
  }

  device.currentZones = [...nowIds];

  return { entered, exited };
}

module.exports = { evaluateGeofence };
