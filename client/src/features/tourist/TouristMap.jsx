import { useEffect, useState } from 'react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useZoneSync } from '../../shared/socket/useZoneSync.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useLiveLocation } from '../../shared/hooks/useLiveLocation.js';
import { useI18n } from '../../shared/i18n/I18nContext.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Spinner from '../../shared/components/ui/Spinner.jsx';
import GeoMap from '../../shared/components/GeoMap.jsx';

const GEO_FALLBACK_STATUSES = new Set(['denied', 'unavailable', 'timeout', 'unsupported', 'error']);

function TouristMap() {
  const { t } = useI18n();
  const [deviceId, setDeviceId] = useState(undefined); // undefined = loading, null = none
  const [device, setDevice]     = useState(null);
  const [zones, setZones]       = useState([]);
  const [trail, setTrail]       = useState([]);
  const [error, setError]       = useState('');

  const { position: livePosition, status: geoStatus } = useLiveLocation();

  useEffect(() => {
    api.get('/tourists/me')
      .then((data) => setDeviceId(data.profile?.device?.deviceId || null))
      .catch((err) => setError(err.message));
    api.get('/zones').then((data) => setZones(data.zones || [])).catch(() => {});
  }, []);

  useZoneSync(setZones);
  useOnReconnect(() => {
    if (deviceId) api.get(`/devices/${deviceId}`).then((d) => setDevice(d.device)).catch(() => {});
  });

  useEffect(() => {
    if (!deviceId) return;
    api.get(`/devices/${deviceId}`).then((data) => setDevice(data.device)).catch(() => {});
    api.get(`/devices/${deviceId}/trail?limit=100`).then((data) => setTrail(data.trail || [])).catch(() => {});
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    // The server only ever emits location:update for a tourist's own
    // device into their room, so any event received here is guaranteed
    // to be this device — no client-side filtering needed.
    const socket = connectSocket(tokens.getAccess());
    function onLocationUpdate(updated) {
      setDevice(updated);
    }
    socket.on('location:update', onLocationUpdate);
    return () => socket.off('location:update', onLocationUpdate);
  }, [deviceId]);

  if (deviceId === undefined) return <Spinner fullPage />;

  const trails = trail.length > 1 ? [{ id: 'mine', points: trail.map((p) => [p.lat, p.lng]) }] : [];

  // Prefer the browser's live position for centering; fall back to the
  // tracking device's last reported location when geolocation isn't
  // available, so a permission denial doesn't leave the map with nothing
  // to focus on.
  const deviceLocation = device?.lastLocation?.lat != null ? device.lastLocation : null;
  const focusPosition = livePosition
    ? [livePosition.lat, livePosition.lng]
    : deviceLocation
      ? [deviceLocation.lat, deviceLocation.lng]
      : null;

  return (
    <div className="app-page">
      <h1 className="page-title">{t('map.title')}</h1>

      {error && <p className="form-error">{error}</p>}

      {GEO_FALLBACK_STATUSES.has(geoStatus) && (
        <div className="callout callout--warning mt-4">
          <p>
            {t(`geo.${geoStatus}`)}{' '}
            {deviceLocation ? t('map.fallback.device') : t('map.fallback.default')}
          </p>
        </div>
      )}

      {deviceId === null && (
        <p className="placeholder-text mt-4">{t('map.noDevice')}</p>
      )}

      <Card className="mt-4">
        <GeoMap
          zones={zones}
          devices={device ? [device] : []}
          userPosition={livePosition}
          focusPosition={focusPosition}
          trails={trails}
          height={480}
          allowFullscreen
        />
      </Card>
    </div>
  );
}

export default TouristMap;
