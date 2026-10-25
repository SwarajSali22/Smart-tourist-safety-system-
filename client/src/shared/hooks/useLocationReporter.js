import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { GEO_ERROR_MESSAGES, GEO_STATUS_BY_CODE } from '../location/geoErrors.js';

const SEND_EVERY_MS = 5000;
const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 };

/**
 * Watches the phone's GPS and reports it to POST /api/tourists/me/location.
 *  - sends a position every 5 s, but only while the tab is visible
 *    (and immediately on the first fix / when the tab becomes visible again);
 *  - stops on unmount (the provider unmounts on logout);
 *  - never throws: permission denial, no signal, timeouts, an unsupported
 *    browser and "you already have a wristband" are reported through `status`.
 *
 * status: 'off' | 'waiting' | 'sharing' | 'denied' | 'unavailable' | 'timeout'
 *       | 'unsupported' | 'wristband' | 'tracker_blocked' | 'error'
 *   'wristband'       = another device that HAS been reporting is the tracker (nothing is recorded from the phone)
 *   'tracker_blocked' = another device is assigned but has never reported (e.g. a simulator registered by mistake):
 *                       the phone's GPS is NOT being recorded, and the tourist is told so. It is retried periodically,
 *                       so tracking resumes by itself once an admin removes that device.
 */
const RETRY_WHEN_OTHER_DEVICE_MS = 30000;
export function useLocationReporter({ enabled }) {
  const [state, setState] = useState({ status: 'waiting', error: '', lastSentAt: null, otherDevice: null });
  const posRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    if (!('geolocation' in navigator)) {
      const id = setTimeout(() => setState({ status: 'unsupported', error: 'This browser does not support geolocation.', lastSentAt: null }), 0);
      return () => clearTimeout(id);
    }

    let stopped = false;
    let blockedUntil = 0; // server said another device is assigned — pause, then ask again
    let inFlight = false;

    async function send() {
      const pos = posRef.current;
      if (stopped || Date.now() < blockedUntil || inFlight || !pos || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const res = await api.post('/tourists/me/location', { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
        if (stopped) return;
        if (res.accepted === false) {
          blockedUntil = Date.now() + RETRY_WHEN_OTHER_DEVICE_MS;
          const other = res.device || null;
          const neverReported = !other || other.hasReported === false;
          setState({ status: neverReported ? 'tracker_blocked' : 'wristband', error: '', lastSentAt: null, otherDevice: other });
        } else {
          setState({ status: 'sharing', error: '', lastSentAt: Date.now(), otherDevice: null });
        }
      } catch (err) {
        // 429 = we were a hair too fast; the next tick will succeed.
        if (!stopped && err.status !== 429) {
          // The GPS fix is fine but the server could not be reached (or refused it): say so, keep trying every tick.
          setState((s) => ({ ...s, status: 'error', error: err.message || 'Could not send your location.' }));
        }
      } finally {
        inFlight = false;
      }
    }

    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const first = posRef.current === null;
        posRef.current = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        if (first) send();
      },
      (err) => {
        if (stopped) return;
        setState({
          status: GEO_STATUS_BY_CODE[err.code] || 'error',
          error: GEO_ERROR_MESSAGES[err.code] || err.message || 'Unable to determine your location.',
          lastSentAt: null,
          otherDevice: null,
        });
      },
      WATCH_OPTIONS
    );

    const timer = setInterval(send, SEND_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') send(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      posRef.current = null;
      navigator.geolocation.clearWatch(watchId);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return enabled ? state : { status: 'off', error: '', lastSentAt: null, otherDevice: null };
}
