import { useEffect, useMemo, useRef } from 'react';
import MapInteractions, { MAP_INTERACTION_OPTIONS } from './MapInteractions.jsx';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [20.5937, 78.9629]; // overview of India until a point is chosen
const pinIcon = divIcon({ className: 'device-marker device-marker--medium', html: '<span></span>', iconSize: [18, 18] });

const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

function Recenter({ point }) {
  const map = useMap();
  useEffect(() => {
    if (!valid(point)) return;
    // Zoom in on a freshly chosen point, but never yank the view back while the user is
    // already looking at the pin (e.g. after dragging the map around or nudging the pin).
    const zoom = map.getZoom();
    if (zoom >= 13 && map.getBounds().contains([point.lat, point.lng])) return;
    map.setView([point.lat, point.lng], Math.max(zoom, 15), { animate: true });
  }, [map, point?.lat, point?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ClickToPlace({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/**
 * Small Leaflet map for choosing a location: click to place the pin or drag it.
 * No marker is drawn until `point` holds valid coordinates.
 */
function LocationPicker({ point, onPick, height = 260 }) {
  const ok = valid(point);
  const markerRef = useRef(null);
  const handlers = useMemo(() => ({
    dragend() {
      const m = markerRef.current;
      if (m) onPick(m.getLatLng().lat, m.getLatLng().lng);
    },
  }), [onPick]);

  return (
    <div className="picker-map" style={{ height }}>
      <MapContainer center={ok ? [point.lat, point.lng] : DEFAULT_CENTER} zoom={ok ? 15 : 4} {...MAP_INTERACTION_OPTIONS} style={{ height: '100%', width: '100%' }}>
        <MapInteractions />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPlace onPick={onPick} />
        <Recenter point={point} />
        {ok && <Marker position={[point.lat, point.lng]} icon={pinIcon} draggable eventHandlers={handlers} ref={markerRef} />}
      </MapContainer>
      {!ok && <div className="picker-map__hint">Search for a place, enter coordinates, or click the map to drop a pin.</div>}
    </div>
  );
}

export default LocationPicker;
