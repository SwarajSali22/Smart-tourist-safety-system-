import { useEffect, useState } from 'react';
import { Pencil, Shapes, Trash2, Undo2 } from 'lucide-react';
import { api, tokens } from '../../api/client.js';
import { connectSocket } from '../../shared/socket/socket.js';
import { useZoneSync } from '../../shared/socket/useZoneSync.js';
import { useOnReconnect } from '../../shared/socket/useSocketStatus.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import DataTable from '../../shared/components/ui/DataTable.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import GeoMap from '../../shared/components/GeoMap.jsx';
import { formatDateTime, label } from '../../shared/utils/format.js';
import { formatArea, polygonAreaM2 } from '../../shared/utils/geo.js';

const ZONE_BADGE = { safe: 'success', danger: 'danger', restricted: 'warning' };
const ZONE_HELP = {
  safe: 'Tourists are welcome here; entering is logged only.',
  restricted: 'Entering raises a violation alert to admins and the tourist.',
  danger: 'Entering raises an alert and triggers an automatic SOS.',
};

function Zones() {
  const toast = useToast();
  const [zones, setZones] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [draftPoints, setDraftPoints] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'danger', riskLevel: 50 });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [editing, setEditing] = useState(null); // zone being edited
  const [editForm, setEditForm] = useState({ name: '', type: 'danger', riskLevel: 0, isActive: true });
  const [deleting, setDeleting] = useState(null); // zone pending delete

  useEffect(() => {
    Promise.all([
      api.get('/zones').then((data) => setZones(data.zones || [])),
      api.get('/geofence-events').then((data) => setEvents(data.events || [])),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useZoneSync(setZones);
  useOnReconnect(() => {
    api.get('/geofence-events').then((d) => setEvents(d.events || [])).catch(() => {});
  });

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    function onGeofenceEvent(event) {
      setEvents((es) => [event, ...es]);
    }
    socket.on('geofence:event', onGeofenceEvent);
    return () => socket.off('geofence:event', onGeofenceEvent);
  }, []);

  function handleMapClick(latlng) {
    setDraftPoints((pts) => [...pts, latlng]);
  }

  function moveDraftPoint(index, latlng) {
    setDraftPoints((pts) => pts.map((p, i) => (i === index ? { lat: latlng.lat, lng: latlng.lng } : p)));
  }

  function clearDraft() {
    setDraftPoints([]);
    setFormError('');
  }

  async function handleSaveZone(e) {
    e.preventDefault();
    setFormError('');
    if (draftPoints.length < 3) {
      setFormError('Click at least 3 points on the map to form a polygon.');
      return;
    }
    const risk = Number(form.riskLevel);
    if (Number.isNaN(risk) || risk < 0 || risk > 100) {
      setFormError('Risk level must be between 0 and 100.');
      return;
    }
    setSaving(true);
    try {
      const coordinates = [draftPoints.map((p) => [p.lng, p.lat])];
      await api.post('/zones', { name: form.name.trim(), type: form.type, riskLevel: risk, geometry: { type: 'Polygon', coordinates } });
      toast.success(`Zone “${form.name.trim()}” created.`);
      setDraftPoints([]);
      setForm({ name: '', type: 'danger', riskLevel: 50 });
      // No manual refetch — the zone:created socket event (useZoneSync) updates the list.
    } catch (err) {
      setFormError(err.message || 'Failed to save zone');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(zone) {
    setEditing(zone);
    setEditForm({ name: zone.name, type: zone.type, riskLevel: zone.riskLevel, isActive: zone.isActive });
  }

  async function confirmEdit() {
    const risk = Number(editForm.riskLevel);
    if (!editForm.name.trim() || Number.isNaN(risk) || risk < 0 || risk > 100) {
      toast.error('Enter a name and a risk level between 0 and 100.');
      return;
    }
    const zone = editing;
    const patch = { ...editForm, name: editForm.name.trim(), riskLevel: risk };
    setEditing(null); // optimistic: close and show the new values straight away
    setZones((zs) => zs.map((z) => (z._id === zone._id ? { ...z, ...patch, _pending: true } : z)));
    try {
      await api.patch(`/zones/${zone._id}`, patch);
      toast.success('Zone updated.');
    } catch (err) {
      // roll back only if the row is still our optimistic copy (a socket update replaces it)
      setZones((zs) => zs.map((z) => (z._id === zone._id && z._pending ? zone : z)));
      toast.error(`Couldn’t update “${zone.name}”: ${err.message || 'request failed'}. Your changes were undone.`);
    }
  }

  async function confirmDelete() {
    const zone = deleting;
    const index = zones.findIndex((z) => z._id === zone._id);
    setDeleting(null); // optimistic: remove from the list immediately
    setZones((zs) => zs.filter((z) => z._id !== zone._id));
    try {
      await api.delete(`/zones/${zone._id}`);
      toast.success(`Zone “${zone.name}” deleted.`);
    } catch (err) {
      setZones((zs) => {
        if (zs.some((z) => z._id === zone._id)) return zs;
        const next = [...zs];
        next.splice(Math.min(Math.max(index, 0), next.length), 0, zone);
        return next;
      });
      toast.error(`Couldn’t delete “${zone.name}”: ${err.message || 'request failed'}. The zone was restored.`);
    }
  }

  async function resolveEvent(event) {
    setEvents((es) => es.map((x) => (x._id === event._id ? { ...x, resolved: true } : x)));
    try {
      await api.patch(`/geofence-events/${event._id}/resolve`, {});
      toast.success('Event marked resolved.');
    } catch (err) {
      setEvents((es) => es.map((x) => (x._id === event._id ? { ...x, resolved: false } : x)));
      toast.error(`Couldn’t mark the event resolved: ${err.message || 'request failed'}. It was restored.`);
    }
  }

  const zoneColumns = [
    { key: 'name', header: 'Name', sortValue: (z) => z.name.toLowerCase() },
    { key: 'type', header: 'Type', sortValue: (z) => z.type, render: (z) => <Badge variant={ZONE_BADGE[z.type]}>{label(z.type)}</Badge> },
    { key: 'riskLevel', header: 'Risk level', sortValue: (z) => z.riskLevel },
    { key: 'isActive', header: 'Active', render: (z) => (z.isActive ? 'Yes' : 'No') },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>,
      render: (z) => (
        <div className="contact-actions">
          <button className="btn btn--ghost btn--sm" onClick={() => openEdit(z)} aria-label={`Edit zone ${z.name}`}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
          <button className="btn btn--ghost btn--sm btn--danger-text" onClick={() => setDeleting(z)} aria-label={`Delete zone ${z.name}`}>
            <Trash2 size={14} aria-hidden="true" /> Delete
          </button>
        </div>
      ),
    },
  ];

  const eventColumns = [
    { key: 'tourist', header: 'Tourist', render: (e) => e.tourist?.name || '—' },
    { key: 'zone', header: 'Zone', render: (e) => e.zone?.name || '—' },
    { key: 'eventType', header: 'Event', sortValue: (e) => e.eventType, render: (e) => <Badge variant={e.eventType === 'enter' ? 'info' : 'neutral'}>{label(e.eventType)}</Badge> },
    {
      key: 'resolved', header: 'Resolved',
      render: (e) => (e.resolved ? 'Yes' : e.eventType === 'enter' && e._id ? (
        <button className="btn btn--ghost btn--sm" onClick={() => resolveEvent(e)}>Mark resolved</button>
      ) : 'No'),
    },
    { key: 'createdAt', header: 'When', sortValue: (e) => new Date(e.createdAt).getTime(), render: (e) => formatDateTime(e.createdAt) },
  ];

  if (loading) {
    return (
      <div className="app-page">
        <h1 className="page-title">Zones</h1>
        <SkeletonRows rows={6} />
      </div>
    );
  }

  return (
    <div className="app-page">
      <h1 className="page-title">Zones</h1>
      <p className="page-subtitle">Geofence definitions — click the map to draw a new zone</p>

      {error && <p className="form-error">{error}</p>}

      <Card id="zone-map">
        <GeoMap zones={zones} onMapClick={handleMapClick} draftPoints={draftPoints} onDraftChange={moveDraftPoint} height={420} allowFullscreen />
        <p className="zone-draw-hint" aria-live="polite">
          {draftPoints.length === 0
            ? 'Click on the map to start drawing a zone.'
            : draftPoints.length < 3
              ? `${draftPoints.length} point${draftPoints.length === 1 ? '' : 's'} placed — place at least 3.`
              : <><strong>{draftPoints.length} vertices</strong> · area ≈ <strong>{formatArea(polygonAreaM2(draftPoints))}</strong>. Drag any point to adjust the shape.</>}
        </p>

        <form onSubmit={handleSaveZone} className="auth-form mt-4">
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <label className="form-label">
            Zone name
            <input className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={80} />
          </label>
          <label className="form-label">
            Type
            <select className="form-input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="safe">Safe</option>
              <option value="restricted">Restricted</option>
              <option value="danger">Danger</option>
            </select>
            <span className="form-hint">{ZONE_HELP[form.type]}</span>
          </label>
          <label className="form-label">
            Risk level (0–100)
            <input className="form-input" type="number" min="0" max="100" value={form.riskLevel} onChange={(e) => setForm((f) => ({ ...f, riskLevel: e.target.value }))} />
          </label>
          <div className="contact-actions">
            <button className="btn btn--primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save zone'}</button>
            <button className="btn btn--ghost" type="button" onClick={() => setDraftPoints((p) => p.slice(0, -1))} disabled={draftPoints.length === 0}>
              <Undo2 size={14} aria-hidden="true" /> Undo point
            </button>
            <button className="btn btn--ghost" type="button" onClick={clearDraft} disabled={draftPoints.length === 0}>Clear</button>
          </div>
        </form>
      </Card>

      <Card title="Existing zones" className="mt-4">
        <DataTable
          columns={zoneColumns}
          rows={zones}
          searchText={(z) => `${z.name} ${z.type}`}
          searchLabel="Search zones"
          emptyIcon={Shapes}
          emptyTitle="No zones yet"
          emptyAction={<a className="btn btn--primary btn--sm" href="#zone-map">Draw your first zone</a>}
          emptyText="Draw a polygon on the map above to create your first geofence."
          pageSize={8}
          caption="Geofence zones"
        />
      </Card>

      <Card title="Recent geofence events" className="mt-4">
        <DataTable
          columns={eventColumns}
          rows={events}
          searchText={(e) => `${e.tourist?.name || ''} ${e.zone?.name || ''} ${e.eventType}`}
          searchLabel="Search events"
          emptyTitle="No geofence events yet"
          emptyText="Enter and exit events are logged as tourists cross zone boundaries."
          pageSize={8}
          caption="Recent geofence events"
        />
      </Card>

      <ConfirmDialog
        open={Boolean(editing)}
        title={`Edit zone`}
        confirmLabel="Save changes"
        onConfirm={confirmEdit}
        onCancel={() => setEditing(null)}
      >
        <div className="auth-form modal__form">
          <label className="form-label">
            Name
            <input className="form-input" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="form-label">
            Type
            <select className="form-input" value={editForm.type} onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="safe">Safe</option>
              <option value="restricted">Restricted</option>
              <option value="danger">Danger</option>
            </select>
          </label>
          <label className="form-label">
            Risk level (0–100)
            <input className="form-input" type="number" min="0" max="100" value={editForm.riskLevel} onChange={(e) => setEditForm((f) => ({ ...f, riskLevel: e.target.value }))} />
          </label>
          <label className="check-label">
            <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Zone is active (inactive zones don’t trigger alerts)
          </label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        danger
        title="Delete this zone?"
        message={deleting ? `“${deleting.name}” will stop triggering alerts immediately. This can’t be undone.` : ''}
        confirmLabel="Delete zone"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

export default Zones;
