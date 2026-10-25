const { haversineKm } = require('./haversine');

/** Distance in metres from point p to the segment a–b (equirectangular approximation, fine at city scale). */
function distanceToSegmentM(p, a, b) {
  const kLat = 111320;
  const kLng = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const px = (p.lng - a.lng) * kLng; const py = (p.lat - a.lat) * kLat;
  const bx = (b.lng - a.lng) * kLng; const by = (b.lat - a.lat) * kLat;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Smallest distance in metres from p to a polyline of { lat, lng } points. */
function distanceToPathM(p, path) {
  if (!path.length) return Infinity;
  if (path.length === 1) return haversineKm(p, path[0]) * 1000;
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i += 1) best = Math.min(best, distanceToSegmentM(p, path[i], path[i + 1]));
  return best;
}

module.exports = { distanceToSegmentM, distanceToPathM };
