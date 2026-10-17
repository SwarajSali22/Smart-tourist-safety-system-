import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { label } from '../../shared/utils/format.js';

const TYPES = ['hospital', 'police', 'fire', 'embassy', 'pharmacy', 'other'];
const EMPTY = { name: '', type: 'hospital', phone: '', address: '', lat: '', lng: '' };

/** Real help centers (nothing is pre-seeded); tourists see the nearest ones first. */
function HelpCenters() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get('/help-centers')
    .then((d) => { setItems(d.helpCenters || []); setError(''); })
    .catch((e) => setError(e.message || 'Could not load help centers')), []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/help-centers', {
        name: form.name, type: form.type,
        ...(form.phone ? { phone: form.phone } : {}),
        ...(form.address ? { address: form.address } : {}),
        location: { lat: Number(form.lat), lng: Number(form.lng) },
      });
      toast.success(`${form.name} added.`);
      setForm(EMPTY);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not add the help center.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(h) {
    try {
      await api.patch(`/help-centers/${h._id}`, { isActive: !h.isActive });
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update the help center.');
    }
  }

  async function remove(h) {
    try {
      await api.delete(`/help-centers/${h._id}`);
      toast.success(`${h.name} removed.`);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not remove the help center.');
    }
  }

  return (
    <div className="page-stack">
      <h1 className="page-title">Help centers</h1>
      <Card title="Add a help center">
        <form onSubmit={submit} className="form-grid">
          <label>Name<input required maxLength={120} value={form.name} onChange={set('name')} /></label>
          <label>Type
            <select value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
          </label>
          <label>Phone<input type="tel" value={form.phone} onChange={set('phone')} /></label>
          <label>Address<input maxLength={300} value={form.address} onChange={set('address')} /></label>
          <label>Latitude<input required type="number" step="any" min="-90" max="90" value={form.lat} onChange={set('lat')} /></label>
          <label>Longitude<input required type="number" step="any" min="-180" max="180" value={form.lng} onChange={set('lng')} /></label>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Adding…' : 'Add help center'}</button>
        </form>
      </Card>
      <Card title="All help centers">
        {error ? <ErrorState message={error} onRetry={load} />
          : !items ? <SkeletonRows rows={4} />
            : items.length === 0 ? <p className="muted">No help centers yet. Add hospitals, police stations and embassies tourists can reach.</p>
              : (
                <ul>
                  {items.map((h) => (
                    <li key={h._id}>
                      <strong>{h.name}</strong> <Badge variant="info">{label(h.type)}</Badge>{' '}
                      {!h.isActive && <Badge variant="neutral">Inactive</Badge>}
                      <div className="muted">{[h.phone, h.address].filter(Boolean).join(' · ')}</div>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggle(h)}>{h.isActive ? 'Deactivate' : 'Activate'}</button>{' '}
                      <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove ${h.name}`} onClick={() => remove(h)}><Trash2 size={16} /></button>
                    </li>
                  ))}
                </ul>
              )}
      </Card>
    </div>
  );
}

export default HelpCenters;
