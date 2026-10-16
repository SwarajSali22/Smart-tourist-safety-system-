import { useEffect, useRef, useState } from 'react';
import { GEO_ERROR_MESSAGES as ERROR_MESSAGES, GEO_STATUS_BY_CODE as STATUS_BY_CODE } from '../location/geoErrors.js';

const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 };

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
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [status, setStatus] = useState(supported ? 'idle' : 'unsupported'); // idle | loading | success | denied | unavailable | timeout | unsupported
  const [error, setError] = useState(supported ? '' : 'This browser does not support geolocation.');
  const watchIdRef = useRef(null);

  useEffect(() => {
    if (!supported) return undefined;

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
  }, [supported]);

  return { position, status, error };
}
