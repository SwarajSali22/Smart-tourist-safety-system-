import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Interaction settings shared by every Leaflet map in the app, so no page can end up
 * with a map that can't be dragged or pinched. Leaflet's own handlers do the work:
 * mouse/touch/pen dragging, pinch zoom, wheel zoom, double-click zoom, keyboard.
 */
export const MAP_INTERACTION_OPTIONS = {
  dragging: true,
  touchZoom: true,
  scrollWheelZoom: true,
  doubleClickZoom: true,
  boxZoom: true,
  keyboard: true,
  inertia: true,
  zoomSnap: 1,
  wheelPxPerZoomLevel: 90,
};

// A notched mouse wheel reports line deltas or big pixel steps; a touchpad's two-finger
// scroll reports many small pixel deltas (often with horizontal movement).
const isTouchpadScroll = (e) => e.deltaMode === 0 && !e.ctrlKey && (e.deltaX !== 0 || Math.abs(e.deltaY) < 50);

/**
 * Mounted inside <MapContainer>. Pinch on a touchpad arrives as ctrl+wheel and zooms through
 * Leaflet as usual; a two-finger touchpad swipe pans the map instead of zooming it. Real
 * mouse wheels still zoom.
 */
function MapInteractions() {
  const map = useMap();

  useEffect(() => {
    const el = map.getContainer();
    function onWheel(e) {
      if (!isTouchpadScroll(e)) return;
      e.preventDefault();
      e.stopPropagation(); // keep Leaflet's wheel-zoom handler out of it
      map.panBy([e.deltaX, e.deltaY], { animate: false });
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [map]);

  useEffect(() => {
    // Leaflet may have measured a zero-size container if the map mounted while hidden/animating.
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [map]);

  return null;
}

export default MapInteractions;
