import { useEffect, useState } from 'react';
import { Copy, Watch } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import DataTable from '../../shared/components/ui/DataTable.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { label, sourceLabel, STALE_MS, timeAgo } from '../../shared/utils/format.js';

const STATUS_VARIANT = {
  active: 'success',
  inactive: 'neutral',
  lost: 'warning',
  emergency: 'danger',
};

function Devices() {
  const toast = useToast();
  const now = useNow(15000);
  const [devices, setDevices] = useState([]);
  const [tourists, setTourists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedTourist, setSelectedTourist] = useState('');
  const [registering, setRegistering] = useState(false);
  const [formError, setFormError] = useState('');
  const [issuedKey, setIssuedKey] = useState(null); // { deviceId, apiKey }

  function loadDevices() {
    return api.get('/devices').then((data) => setDevices(data.devices || []));
  }

  function loadTourists() {
    return api.get('/tourists').then((data) => setTourists(data.tourists || []));
  }

  useEffect(() => {
    Promise.all([loadDevices(), loadTourists()])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    function onLocationUpdate(device) {
      setDevices((ds) => {
        const exists = ds.some((d) => d._id === device._id);
        return exists ? ds.map((d) => (d._id === device._id ? device : d)) : [device, ...ds];
      });
    }
    socket.on('location:update', onLocationUpdate);
    return () => socket.off('location:update', onLocationUpdate);
  }, []);

  // A tourist tracked only by their phone can still be given a wristband (it replaces the phone device).
  const unassignedTourists = tourists.filter((t) => !t.device || t.deviceType === 'phone');

  async function handleRegister(e) {
    e.preventDefault();
    setFormError('');
    if (!selectedTourist) {
      setFormError('Choose a tourist to assign the device to.');
      return;
    }
    setRegistering(true);
    try {
      const data = await api.post('/devices', { tourist: selectedTourist });
      setIssuedKey({ deviceId: data.device.deviceId, apiKey: data.apiKey });
      setSelectedTourist('');
      toast.success(`Device ${data.device.deviceId} registered.`);
      await Promise.all([loadDevices(), loadTourists()]);
    } catch (err) {
      setFormError(err.message || 'Failed to register device');
    } finally {
      setRegistering(false);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(issuedKey.apiKey);
      toast.success('API key copied to clipboard.');
    } catch {
      toast.error('Couldn’t copy automatically — select the key and copy it manually.');
    }
  }

  const columns = [
    { key: 'deviceId', header: 'Device ID', sortValue: (d) => d.deviceId },
    { key: 'type', header: 'Source', sortValue: (d) => sourceLabel(d), render: (d) => <Badge variant="neutral">{sourceLabel(d)}</Badge> },
    { key: 'tourist', header: 'Tourist', sortValue: (d) => d.tourist?.name?.toLowerCase() ?? '', render: (d) => (d.tourist ? `${d.tourist.name} (${d.tourist.email})` : '—') },
    {
      key: 'status', header: 'Status', sortValue: (d) => d.status,
      render: (d) => {
        const stale = d.status === 'active' && d.lastSeen && now - new Date(d.lastSeen).getTime() > STALE_MS;
        return (
          <span className="badge-row">
            <Badge variant={STATUS_VARIANT[d.status] || 'neutral'}>{label(d.status)}</Badge>
            {stale && <Badge variant="warning">Silent</Badge>}
          </span>
        );
      },
    },
    { key: 'battery', header: 'Battery', sortValue: (d) => d.battery, render: (d) => (typeof d.battery === 'number' ? `${d.battery}%` : '—') },
    { key: 'lastSeen', header: 'Last seen', sortValue: (d) => (d.lastSeen ? new Date(d.lastSeen).getTime() : null), render: (d) => (d.lastSeen ? <time dateTime={d.lastSeen} title={new Date(d.lastSeen).toLocaleString()}>{timeAgo(d.lastSeen, now)}</time> : '—') },
    { key: 'location', header: 'Last location', render: (d) => (d.lastLocation?.lat != null ? `${d.lastLocation.lat.toFixed(4)}, ${d.lastLocation.lng.toFixed(4)}` : '—') },
  ];

  return (
    <div className="app-page">
      <h1 className="page-title">Devices</h1>
      <p className="page-subtitle">Registered tracking devices (simulated until the ESP32 wristband is ready)</p>

      <Card title="Register a device" className="mt-4">
        {issuedKey && (
          <div className="callout callout--warning" role="status">
            <p>
              Device <strong>{issuedKey.deviceId}</strong> registered. Copy this API key now —
              it will not be shown again:
            </p>
            <code className="callout__code">{issuedKey.apiKey}</code>
            <div className="contact-actions">
              <button className="btn btn--primary btn--sm" onClick={copyKey}><Copy size={14} aria-hidden="true" /> Copy key</button>
              <button className="btn btn--ghost btn--sm" onClick={() => setIssuedKey(null)}>Dismiss</button>
            </div>
          </div>
        )}

        <form onSubmit={handleRegister} className="auth-form mt-4">
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <label className="form-label">
            Tourist
            <select className="form-input" value={selectedTourist} onChange={(e) => setSelectedTourist(e.target.value)}>
              <option value="">Select a tourist without a wristband…</option>
              {unassignedTourists.map((t) => (
                <option key={t._id} value={t._id}>{t.name} ({t.email}){t.deviceType === 'phone' ? ' — phone GPS only' : ''}</option>
              ))}
            </select>
            {!loading && unassignedTourists.length === 0 && (
              <span className="form-hint">Every registered tourist already has a device.</span>
            )}
          </label>
          <button className="btn btn--primary" type="submit" disabled={registering}>
            {registering ? 'Registering…' : 'Register device'}
          </button>
        </form>
      </Card>

      <Card title="All devices" className="mt-4">
        {loading && <SkeletonRows rows={5} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!loading && !error && (
          <DataTable
            columns={columns}
            rows={devices}
            searchText={(d) => `${d.deviceId} ${d.tourist?.name || ''} ${d.tourist?.email || ''} ${d.status}`}
            searchLabel="Search devices"
            emptyIcon={Watch}
            emptyTitle="No devices registered yet"
            emptyText="Phones appear automatically when a tourist shares their location. For a wristband, register one above and run scripts/simulateGps.js with the issued key."
            caption="Registered devices"
          />
        )}
      </Card>
    </div>
  );
}

export default Devices;
