// GeolocationPositionError codes -> the user-facing fallback messages and a
// status slug. Shared by the map's live-position hook and the location reporter.
export const GEO_ERROR_MESSAGES = {
  1: 'Location permission was denied. Enable it in your browser/device settings to see your live position.',
  2: 'Your position is currently unavailable. Move to an area with a clearer GPS/network signal.',
  3: 'Getting your location timed out — retrying…',
};
export const GEO_STATUS_BY_CODE = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
