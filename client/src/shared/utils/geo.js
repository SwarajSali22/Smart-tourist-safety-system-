const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG_AT_EQUATOR = 111320;

/**
 * Approximate area (m²) of a small polygon given as [{lat, lng}, …], using a local
 * equirectangular projection + the shoelace formula. Accurate to well under 1 %
 * for zone-sized shapes (a few km), which is all the zone editor needs.
 */
export function polygonAreaM2(points) {
  if (!points || points.length < 3) return 0;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng0 = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const kx = M_PER_DEG_LNG_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const xy = points.map((p) => [(p.lng - lng0) * kx, (p.lat - lat0) * M_PER_DEG_LAT]);
  let sum = 0;
  for (let i = 0; i < xy.length; i += 1) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** "850 m²", "2.4 ha", "1.35 km²" */
export function formatArea(m2) {
  if (m2 < 10000) return `${Math.round(m2).toLocaleString()} m²`;
  if (m2 < 1000000) return `${(m2 / 10000).toFixed(1)} ha`;
  return `${(m2 / 1000000).toFixed(2)} km²`;
}
