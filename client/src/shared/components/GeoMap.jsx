import { useEffect, useRef, useState } from 'react';
import MapInteractions, { MAP_INTERACTION_OPTIONS } from './MapInteractions.jsx';
import { MapContainer, TileLayer, Polygon, Polyline, Marker, CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { divIcon } from 'leaflet';
import { Maximize2, Minimize2 } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { label, sourceLabel, timeAgo } from '../utils/format.js';
import { FRESH_LABEL, freshnessOf } from '../utils/freshness.js';

const ZONE_COLOR = {
  safe: '#2e7d5b',
  danger: '#c0392b',
  restricted: '#b45309',
};

const LEGEND = [
  ['low', 'Low risk'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['critical', 'Critical'],
  ['sos', 'SOS / emergency'],
  ['stale', 'Stale or offline data'],
  ['idle', 'No risk data yet'],
];

// Leaflet's default marker PNGs don't resolve correctly through Vite's
// bundler — plain coloured dots avoid that class of broken-asset bug. Icons
// are cached per class so re-renders don't recreate (and flicker) markers.
const iconCache = new Map();
function deviceIcon(kind) {
  if (!iconCache.has(kind)) {
    iconCache.set(kind, divIcon({ className: `device-marker device-marker--${kind}`, html: '<span></span>', iconSize: [18, 18] }));
  }
  return iconCache.get(kind);
}

// Small round handle for each vertex of the zone being drawn (draggable).
const vertexIcon = divIcon({ className: 'draft-vertex', html: '<span></span>', iconSize: [16, 16] });

// Distinct from deviceIcon() so a tourist's own live browser position never
// looks like just another tracked wristband on the same map.
const userIcon = divIcon({ className: 'user-marker', html: '<span></span>', iconSize: [16, 16] });

// Emergencies always show as SOS. Otherwise data that isn't fresh is drawn grey ("stale"),
// so an old position is never mistaken for a live one.
function markerKind(device, risk) {
  if (device.emergencyMode || device.status === 'emergency') return 'sos';
  if (freshnessOf(device.lastSeen) !== 'live') return 'stale';
  if (device.status === 'inactive' || device.status === 'lost') return 'idle';
  return risk?.level || 'idle';
}

// A Marker that glides to its new position (~1 s, eased) instead of jumping
// when a new ping arrives. Moves the Leaflet marker directly with
// requestAnimationFrame, so React doesn't re-render 60 times a second.
// Honors prefers-reduced-motion and skips the glide for big jumps (a first
// fix or a GPS correction), where animating would just look like a streak.
const GLIDE_MS = 1000;
const MAX_GLIDE_DEG = 0.05; // ~5 km
function SmoothMarker({ position, ...props }) {
  const markerRef = useRef(null);
  const [initial] = useState(position); // react-leaflet only sees the first position; we drive the rest
  const current = useRef(position);
  const frame = useRef(0);
  const [lat, lng] = position;

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return undefined;
    const from = current.current;
    if (from[0] === lat && from[1] === lng) return undefined;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const far = Math.abs(lat - from[0]) + Math.abs(lng - from[1]) > MAX_GLIDE_DEG;
    if (reduced || far) {
      current.current = [lat, lng];
      marker.setLatLng([lat, lng]);
      return undefined;
    }

    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2; // easeInOutQuad
      const next = [from[0] + (lat - from[0]) * e, from[1] + (lng - from[1]) * e];
      current.current = next;
      marker.setLatLng(next);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [lat, lng]);

  return <Marker ref={markerRef} position={initial} {...props} />;
}

function ClickCapture({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng);
    },
  });
  return null;
}

// MapContainer's `center` prop only applies on first mount. This recenters
// exactly once, the first time a real position arrives, then leaves the map
// alone so it doesn't fight a viewer's manual pan/zoom.
function RecenterOnce({ position, zoom }) {
  const map = useMap();
  const hasCentered = useRef(false);

  useEffect(() => {
    if (!position || hasCentered.current) return;
    hasCentered.current = true;
    map.setView(position, zoom);
  }, [position, zoom, map]);

  return null;
}

// Fly to a point whenever `target.key` changes (e.g. admin selects a tourist).
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target?.lat != null) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [target?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Fit the map to a set of points whenever `fit.key` changes ("Fit all" button).
function FitBounds({ fit }) {
  const map = useMap();
  useEffect(() => {
    const pts = fit?.points;
    if (!pts || pts.length === 0) return;
    if (pts.length === 1) map.flyTo(pts[0], Math.max(map.getZoom(), 15), { duration: 0.8 });
    else map.fitBounds(pts, { padding: [48, 48], maxZoom: 16, animate: true });
  }, [fit?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Leaflet caches its size; tell it when the container changes (fullscreen toggle).
function InvalidateOn({ dep }) {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(id);
  }, [dep, map]);
  return null;
}

/**
 * Shared Leaflet map.
 *  - `zones` → coloured polygons, `devices` → risk/SOS-coloured markers
 *    (`riskByTourist` maps touristId → latest RiskAssessment).
 *  - `onMapClick` + `draftPoints` → click-to-place polygon drawing; pass `onDraftChange(index, latlng)`
 *    to make every placed vertex draggable so the shape can be adjusted afterwards.
 *  - `routes` → [{ id, points, color, dashed, label }] planned/recommended routes; `pins` → [{ id, lat, lng, title, text, tone }] labelled stops.
 *  - `trails` → [{ id, points: [[lat,lng]…] }] polylines; `replayPoint` → moving dot.
 *  - `heatPoints` → [{ lat, lng, weight }] incident density overlay.
 *  - `flyTo` → { lat, lng, key } smooth recenter; `fit` → { key, points } fit-all; `selectedDeviceId` highlights one device.
 *  - `showZones` / `showDevices` switch those layers off (the admin "Layers" menu).
 *  - `userPosition` → the viewer's own live location (distinct green marker).
 *  - `allowFullscreen` adds an expand button (Esc to exit); `showLegend` adds a text legend.
 */
function GeoMap({
  center = [28.6139, 77.209],
  zoom = 13,
  height = 360,
  zones = [],
  devices = [],
  riskByTourist = {},
  trails = [],
  routes = [],
  pins = [],
  heatPoints = [],
  replayPoint,
  selectedDeviceId,
  onSelectDevice,
  flyTo,
  fit,
  showZones = true,
  showDevices = true,
  onMapClick,
  draftPoints,
  onDraftChange,
  focusPosition,
  userPosition,
  allowFullscreen = false,
  showLegend = false,
}) {
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => e.key === 'Escape' && setFull(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  return (
    <div className={`map-container${full ? ' map-container--full' : ''}`} style={full ? undefined : { height }}>
      {allowFullscreen && (
        <button
          type="button"
          className="map-fs-btn"
          onClick={() => setFull((f) => !f)}
          aria-label={full ? 'Exit full screen map' : 'Full screen map'}
          title={full ? 'Exit full screen (Esc)' : 'Full screen'}
        >
          {full ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </button>
      )}

      <MapContainer center={center} zoom={zoom} {...MAP_INTERACTION_OPTIONS} style={{ height: '100%', width: '100%' }}>
        <MapInteractions />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <InvalidateOn dep={full} />
        {focusPosition && <RecenterOnce position={focusPosition} zoom={zoom} />}
        {flyTo && <FlyTo target={flyTo} />}
        {fit && <FitBounds fit={fit} />}
        {onMapClick && <ClickCapture onMapClick={onMapClick} />}

        {showZones && zones.map((zone) => (
          <Polygon
            key={zone._id}
            positions={zone.geometry.coordinates[0].map(([lng, lat]) => [lat, lng])}
            pathOptions={{ color: ZONE_COLOR[zone.type] || '#64748b', fillOpacity: 0.2 }}
          >
            <Popup>
              <strong>{zone.name}</strong> ({label(zone.type)})
              {zone.description && <p>{zone.description}</p>}
            </Popup>
          </Polygon>
        ))}

        {heatPoints.map((p, i) => (
          <CircleMarker
            key={`h${i}`}
            center={[p.lat, p.lng]}
            radius={14 + (p.weight || 1) * 3}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: '#dc2626', fillOpacity: 0.1 + Math.min(0.12, (p.weight || 1) * 0.03) }}
          />
        ))}

        {draftPoints && draftPoints.length > 0 && (
          <Polygon
            positions={draftPoints.map(({ lat, lng }) => [lat, lng])}
            pathOptions={{ color: '#1d6fcc', dashArray: '6 6', fillOpacity: 0.1 }}
          />
        )}

        {onDraftChange && draftPoints?.map((p, i) => (
          <Marker
            key={`v${i}`}
            position={[p.lat, p.lng]}
            icon={vertexIcon}
            draggable
            eventHandlers={{ drag: (e) => onDraftChange(i, e.target.getLatLng()) }}
          />
        ))}

        {trails.map((t) => (
          <Polyline key={t.id} positions={t.points} pathOptions={{ color: '#4f46e5', weight: 3, opacity: 0.75 }} />
        ))}

        {routes.map((r) => (
          <Polyline
            key={r.id}
            positions={r.points}
            pathOptions={{ color: r.color || '#4f46e5', weight: r.weight || 5, opacity: r.opacity ?? 0.85, dashArray: r.dashed ? '8 8' : undefined }}
          >
            {r.label && <Popup>{r.label}</Popup>}
          </Polyline>
        ))}

        {pins.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={deviceIcon(`pin pin--${p.tone || 'info'}`)}>
            <Popup>
              <strong>{p.title}</strong>
              {p.text && <><br />{p.text}</>}
            </Popup>
          </Marker>
        ))}

        {replayPoint && (
          <CircleMarker
            center={[replayPoint.lat, replayPoint.lng]}
            radius={9}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#4f46e5', fillOpacity: 1 }}
          />
        )}

        {userPosition && (
          <SmoothMarker position={[userPosition.lat, userPosition.lng]} icon={userIcon}>
            <Popup>
              <strong>Your location</strong>
              {typeof userPosition.accuracy === 'number' && (
                <>
                  <br />
                  Accuracy: ±{Math.round(userPosition.accuracy)}m
                </>
              )}
            </Popup>
          </SmoothMarker>
        )}

        {showDevices && devices
          .filter((d) => d.lastLocation?.lat != null)
          .map((d) => {
            const risk = riskByTourist[d.tourist?._id || d.tourist];
            const kind = markerKind(d, risk);
            return (
              <SmoothMarker
                key={d._id}
                position={[d.lastLocation.lat, d.lastLocation.lng]}
                icon={deviceIcon(selectedDeviceId === d.deviceId ? `${kind} device-marker--selected` : kind)}
                zIndexOffset={kind === 'sos' ? 1000 : selectedDeviceId === d.deviceId ? 500 : 0}
                eventHandlers={onSelectDevice ? { click: () => onSelectDevice(d) } : undefined}
              >
                <Popup>
                  <strong>{d.tourist?.name || d.deviceId}</strong>
                  <br />
                  {sourceLabel(d)} · {FRESH_LABEL[freshnessOf(d.lastSeen)]}
                  <br />
                  Status: {label(d.status)}
                  {risk && (
                    <>
                      <br />
                      Risk: {label(risk.level)} ({risk.score})
                    </>
                  )}
                  {typeof d.battery === 'number' && (
                    <>
                      <br />
                      Battery: {d.battery}%
                    </>
                  )}
                  {d.lastSeen && (
                    <>
                      <br />
                      Last seen: {timeAgo(d.lastSeen)}
                    </>
                  )}
                </Popup>
              </SmoothMarker>
            );
          })}
      </MapContainer>

      {showLegend && (
        <ul className="map-legend" aria-label="Map legend">
          {LEGEND.map(([kind, text]) => (
            <li key={kind}>
              <span className={`map-legend__dot device-marker--${kind}`} aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default GeoMap;
