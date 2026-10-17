const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two { lat, lng } points. */
function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

module.exports = { haversineKm, EARTH_RADIUS_KM };
