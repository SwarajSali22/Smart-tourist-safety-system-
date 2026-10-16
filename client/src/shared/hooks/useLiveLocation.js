import { useEffect, useRef, useState } from 'react';

const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 };

// GeolocationPositionError's numeric codes, kept here since the type is
// only ever in scope inside the error callback itself.
const ERROR_MESSAGES = {
  1: 'Location permission was denied. Enable it in your browser/device settings to see your live position.',
  2: 'Your position is currently unavailable. Move to an area with a clearer GPS/network signal.',
  3: 'Getting your location timed out — retrying…',
};
const STATUS_BY_CODE = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

/**
 * Wraps navigator.geolocation.watchPosition so a component can render a
 * continuously-updating "you are here" marker instead of one static fix.
 * Never throws — permission denial, timeout, and an unsupported browser
 * are all reported through `status`/`error` so the caller can render a
 * visible fallback instead of failing silently. Clears the watch on
 * unmount.
 */
export function useLiveLocation() {
  const [position, setPosition] = useState(null); // { lat, lng, accuracy } | null
  const [status, setStatus] = useState('idle'); // idle | loading | success | denied | unavailable | timeout | unsupported
  const [error, setError] = useState('');
  const watchIdRef = useRef(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      setError('This browser does not support geolocation.');
      return;
    }

    setStatus('loading');

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus('success');
        setError('');
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        setStatus(STATUS_BY_CODE[err.code] || 'error');
        setError(ERROR_MESSAGES[err.code] || err.message || 'Unable to determine your location.');
      },
      WATCH_OPTIONS
    );

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  return { position, status, error };
}
