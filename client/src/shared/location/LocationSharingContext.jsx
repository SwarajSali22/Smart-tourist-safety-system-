import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocationReporter } from '../hooks/useLocationReporter.js';

const LocationSharingContext = createContext(null);
const PREF_KEY = 'shareLocation';

function readPref() {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === '1' ? true : v === '0' ? false : null; // null = never chosen
  } catch { return null; }
}

/**
 * Mounted by AppShell for tourists only, so it runs on every tourist page and
 * unmounts (stopping the GPS watch) on logout.
 *
 * Preference: the tourist's explicit choice is remembered in localStorage.
 * With no stored choice, sharing defaults to ON as soon as the browser's
 * location permission is "granted" (and stays off while it is "prompt"/"denied").
 */
export function LocationSharingProvider({ children }) {
  const [pref, setPref] = useState(readPref);
  const [permission, setPermission] = useState('unknown'); // granted | prompt | denied | unknown

  useEffect(() => {
    let cancelled = false;
    let result;
    navigator.permissions?.query({ name: 'geolocation' })
      .then((r) => {
        if (cancelled) return;
        result = r;
        setPermission(r.state);
        r.onchange = () => setPermission(r.state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (result) result.onchange = null;
    };
  }, []);

  const enabled = permission !== 'denied' && (pref === true || (pref === null && permission === 'granted'));
  const reporter = useLocationReporter({ enabled });

  const setShare = useCallback((on) => {
    try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    setPref(on);
  }, []);

  // Browser permission denied (and the tourist hasn't switched sharing off): say so.
  const denied = permission === 'denied' && pref !== false;
  const status = denied ? 'denied' : reporter.status;
  const error = denied && !reporter.error
    ? 'Location permission was denied. Enable it in your browser/device settings to share your location.'
    : reporter.error;

  const value = useMemo(
    () => ({ sharing: enabled, setShare, status, error, lastSentAt: reporter.lastSentAt, permission, otherDevice: reporter.otherDevice }),
    [enabled, setShare, status, error, reporter.lastSentAt, permission, reporter.otherDevice]
  );

  return <LocationSharingContext.Provider value={value}>{children}</LocationSharingContext.Provider>;
}

export function useLocationSharing() {
  const ctx = useContext(LocationSharingContext);
  if (!ctx) throw new Error('useLocationSharing must be used inside <LocationSharingProvider>');
  return ctx;
}
