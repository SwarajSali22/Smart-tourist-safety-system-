import { useEffect, useState } from 'react';
import { Copy, Watch } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useNow } from '../../shared/hooks/useNow.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import DataTable from '../../shared/components/ui/DataTable.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { label, timeAgo } from '../../shared/utils/format.js';
import { FRESH_LABEL, FRESH_VARIANT, freshnessOf, sourceOf } from '../../shared/utils/freshness.js';

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
  const [deviceKind, setDeviceKind] = useState('simulator'); // 'simulator' | 'wristband'
  const [confirmPhone, setConfirmPhone] = useState(null);    // tourist whose working phone device would be replaced
  const [removeTarget, setRemoveTarget] = useState(null);    // a never-reported device the admin may remove
  const [removing, setRemoving] = useState(false);
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
  useOnReconnect(() => {
    loadDevices().catch(() => {});
    loadTourists().catch(() => {});
  });

  const unassignedTourists = tourists.filter((t) => !t.device || t.deviceType === 'phone');

  // Registering a device for a tourist whose own phone is already being tracked would replace the phone device,
  // after which the phone's GPS is no longer recorded. That must be a deliberate choice, never a side effect.
  function handleRegister(e) {
    e.preventDefault();
    setFormError('');
    const chosen = tourists.find((t) => t._id === selectedTourist);
    if (!chosen) {
      setFormError('Choose a tourist to assign the device to.');
      return;
    }
    if (chosen.deviceType === 'phone') {
      setConfirmPhone(chosen);
      return;
    }
    register(false);
  }

  async function register(replacePhone) {
    setRegistering(true);
    try {
      const data = await api.post('/devices', {
        tourist: selectedTourist,
        isSimulated: deviceKind !== 'wristband',
        ...(replacePhone ? { replacePhone: true } : {}),
      });
      setIssuedKey({ deviceId: data.device.deviceId, apiKey: data.apiKey });
      setSelectedTourist('');
      setConfirmPhone(null);
      toast.success(`Device ${data.device.deviceId} registered.`);
      await Promise.all([loadDevices(), loadTourists()]);
    } catch (err) {
      setConfirmPhone(null);
      setFormError(err.message || 'Failed to register device');
    } finally {
      setRegistering(false);
    }
  }

  async function removeUnused() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.delete(`/devices/${encodeURIComponent(removeTarget.deviceId)}`);
      toast.success(`Device ${removeTarget.deviceId} removed.`);
      setRemoveTarget(null);
      await Promise.all([loadDevices(), loadTourists()]);
    } catch (err) {
      toast.error(err.message || 'Could not remove the device.');
      setRemoveTarget(null);
    } finally {
      setRemoving(false);
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
    { key: 'type', header: 'Source', sortValue: (d) => sourceOf(d), render: (d) => <Badge variant={sourceOf(d) === 'Simulator' ? 'info' : 'neutral'}>{sourceOf(d)}</Badge> },
    { key: 'tourist', header: 'Tourist', sortValue: (d) => d.tourist?.name?.toLowerCase() ?? '', render: (d) => (d.tourist ? `${d.tourist.name} (${d.tourist.email})` : '—') },
    {
      key: 'status', header: 'Status', sortValue: (d) => d.status,
      render: (d) => {
        const fresh = freshnessOf(d.lastSeen, now);
        return (
          <span className="badge-row">
            <Badge variant={STATUS_VARIANT[d.status] || 'neutral'}>{label(d.status)}</Badge>
            <Badge variant={FRESH_VARIANT[fresh]}>{FRESH_LABEL[fresh]}</Badge>
          </span>
        );
      },
    },
    { key: 'battery', header: 'Battery', sortValue: (d) => d.battery, render: (d) => (typeof d.battery === 'number' ? `${d.battery}%` : '—') },
    { key: 'lastSeen', header: 'Last seen', sortValue: (d) => (d.lastSeen ? new Date(d.lastSeen).getTime() : null), render: (d) => (d.lastSeen ? <time dateTime={d.lastSeen} title={new Date(d.lastSeen).toLocaleString()}>{timeAgo(d.lastSeen, now)}</time> : '—') },
    { key: 'location', header: 'Last location', render: (d) => (d.lastLocation?.lat != null ? `${d.lastLocation.lat.toFixed(4)}, ${d.lastLocation.lng.toFixed(4)}` : '—') },
    {
      key: 'actions', header: 'Actions',
      // Only a device that has never reported anything can be removed (the server enforces this too).
      render: (d) => (!d.lastSeen && !d.emergencyMode
        ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRemoveTarget(d)}>Remove</button>
        : null),
    },
  ];

  const CSV = {
    deviceId: (d) => d.deviceId, type: (d) => sourceOf(d), tourist: (d) => d.tourist?.name || '', status: (d) => d.status,
    battery: (d) => (typeof d.battery === 'number' ? d.battery : ''), lastSeen: (d) => d.lastSeen || '',
    location: (d) => (d.lastLocation?.lat != null ? `${d.lastLocation.lat},${d.lastLocation.lng}` : ''),
  };
  columns.forEach((c) => { if (CSV[c.key]) c.csvValue = CSV[c.key]; });

  return (
    <div className="app-page">
      <h1 className="page-title">Devices</h1>
      <p className="page-subtitle">Phones, wristbands and simulators. “Simulator” devices are not real hardware; data older than 2 minutes is marked Stale, older than 15 minutes Offline.</p>

      <Card id="register-device" title="Register a device" className="mt-4">
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
                <option key={t._id} value={t._id}>{t.name} ({t.email}){t.deviceType === 'phone' ? ' — tracked by their phone (registering replaces it)' : ''}</option>
              ))}
            </select>
            {!loading && unassignedTourists.length === 0 && (
              <span className="form-hint">Every registered tourist already has a device.</span>
            )}
          </label>
          <label className="form-label">
            Device type
            <select className="form-input" value={deviceKind} onChange={(e) => setDeviceKind(e.target.value)}>
              <option value="simulator">Simulator — for testing, not real hardware</option>
              <option value="wristband">Real wristband</option>
            </select>
          </label>
          <p className="form-hint">
            A tourist’s own phone does not need registering: it appears here automatically, as a Phone, once they turn on “Share my location”.
            Only register a simulator or wristband for a tourist who is not using their phone for tracking.
          </p>
          <button className="btn btn--primary" type="submit" disabled={registering}>
            {registering ? 'Registering…' : 'Register device'}
          </button>
        </form>
      </Card>

      <ConfirmDialog
        open={Boolean(confirmPhone)}
        title="Replace this tourist’s phone tracking?"
        message={confirmPhone ? `${confirmPhone.name} is currently tracked by their own phone. Registering a ${deviceKind === 'wristband' ? 'wristband' : 'simulator'} replaces it, and their phone’s GPS will no longer be recorded or shown on the map.` : ''}
        confirmLabel="Replace phone tracking"
        danger
        busy={registering}
        onConfirm={() => register(true)}
        onCancel={() => setConfirmPhone(null)}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={removeTarget ? `Remove ${removeTarget.deviceId}?` : 'Remove device'}
        message={removeTarget ? `This device has never reported any data. Removing it lets ${removeTarget.tourist?.name || 'the tourist'}’s own phone GPS be recorded again. A device that has reported data cannot be removed.` : ''}
        confirmLabel="Remove device"
        danger
        busy={removing}
        onConfirm={removeUnused}
        onCancel={() => setRemoveTarget(null)}
      />

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
            emptyAction={<a className="btn btn--primary btn--sm" href="#register-device">Register a device</a>}
            emptyText="Phones appear automatically when a tourist shares their location. For a wristband, register one above and run scripts/simulateGps.js with the issued key."
            caption="Registered devices"
            csvName="devices.csv"
          />
        )}
      </Card>
    </div>
  );
}

export default Devices;
