import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, Flame, Hospital, Landmark, Loader2, LifeBuoy, MapPin, Pencil, Phone, Pill, Plus, Search,
  ShieldHalf, Siren, Trash2, X, ExternalLink, Crosshair, Info,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import LocationPicker from '../../shared/components/LocationPicker.jsx';

const TYPES = {
  hospital: { label: 'Hospital', icon: Hospital },
  police: { label: 'Police Station', icon: ShieldHalf },
  pharmacy: { label: 'Pharmacy', icon: Pill },
  fire: { label: 'Fire Station', icon: Flame },
  embassy: { label: 'Embassy', icon: Landmark },
  emergency: { label: 'Emergency Service', icon: Siren },
  other: { label: 'Other', icon: Building2 },
};
const typeLabel = (t) => TYPES[t]?.label || 'Other';

const EMPTY = { name: '', type: 'hospital', phone: '', address: '', lat: '', lng: '' };
const SEARCH_DEBOUNCE_MS = 450;
const REVERSE_DEBOUNCE_MS = 800;
const MIN_QUERY = 3;
const PHONE_RE = /^\+?[\d\s()-]{3,20}$/;

const fix = (n) => Number(n).toFixed(6);
const num = (s) => (String(s).trim() === '' ? NaN : Number(s));

function validateCoords(lat, lng) {
  const a = String(lat).trim();
  const b = String(lng).trim();
  if (!a && !b) return { state: 'empty' };
  if (!a || !b) return { state: 'incomplete', message: 'Enter both latitude and longitude.' };
  const la = num(a);
  const lo = num(b);
  if (Number.isNaN(la) || la < -90 || la > 90) return { state: 'invalid', field: 'lat', message: 'Latitude must be between -90 and 90.' };
  if (Number.isNaN(lo) || lo < -180 || lo > 180) return { state: 'invalid', field: 'lng', message: 'Longitude must be between -180 and 180.' };
  return { state: 'ok', lat: la, lng: lo };
}

/** Real help centers (nothing is pre-seeded); tourists see the nearest ones first. */
function HelpCenters() {
  const toast = useToast();
  const formRef = useRef(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({});
  const [typeChosen, setTypeChosen] = useState(false);
  const [filter, setFilter] = useState({ q: '', type: '' });
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // place search
  const [configured, setConfigured] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const searchSeq = useRef(0);
  const searchArmed = useRef(false); // only typing in the name box searches, never programmatic fills

  // reverse geocoding
  const [resolving, setResolving] = useState(false);
  const [reverseMsg, setReverseMsg] = useState('');
  const [typeHint, setTypeHint] = useState(null);
  const addressAuto = useRef(false); // true while the address was filled by a lookup, so a lookup may refresh it
  const reverseArmed = useRef(false);
  const reverseSeq = useRef(0);

  const load = useCallback(() => api.get('/help-centers')
    .then((d) => { setItems(d.helpCenters || []); setError(''); })
    .catch((e) => setError(e.message || 'Could not load help centers')), []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/geocode/status').then((d) => setConfigured(Boolean(d.configured))).catch(() => setConfigured(false));
  }, []);

  const coords = validateCoords(form.lat, form.lng);
  const point = coords.state === 'ok' ? { lat: coords.lat, lng: coords.lng } : null;

  // ── autocomplete (debounced, stale responses ignored) ──────────────────────
  useEffect(() => {
    if (!searchArmed.current) return undefined;
    const q = form.name.trim();
    if (q.length < MIN_QUERY || configured === false) return undefined;
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const d = await api.get(`/geocode/search?q=${encodeURIComponent(q)}&type=${form.type}`);
        if (seq !== searchSeq.current) return;
        setSuggestions(d.results || []);
        setSearchMsg((d.results || []).length ? '' : 'No matching places found. You can fill in the details manually.');
        setActive(-1);
        setOpen(true);
      } catch (err) {
        if (seq !== searchSeq.current) return;
        setSuggestions([]);
        setSearchMsg(`${err.message || 'Place search failed'}. You can fill in the details manually.`);
        setOpen(true);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [form.name, form.type, configured]);

  // ── reverse geocoding when coordinates change by hand / on the map ─────────
  useEffect(() => {
    if (!reverseArmed.current) return undefined;
    if (coords.state !== 'ok' || configured === false) return undefined;
    const { lat, lng } = coords;
    const seq = ++reverseSeq.current;
    const t = setTimeout(async () => {
      try {
        const d = await api.get(`/geocode/reverse?lat=${lat}&lng=${lng}`);
        if (seq !== reverseSeq.current) return;
        const r = d.result;
        if (!r) { setReverseMsg('No address was found for these coordinates — enter it manually.'); return; }
        // Never overwrite an address the admin typed; the coordinates are never changed by a lookup.
        if (!form.address.trim() || addressAuto.current) {
          addressAuto.current = true;
          setForm((f) => ({ ...f, address: r.address.slice(0, 300), phone: f.phone || r.phone || '' }));
        }
        if (r.suggestedType && r.suggestedType !== form.type) {
          if (!typeChosen) setForm((f) => ({ ...f, type: r.suggestedType }));
          else setTypeHint(r.suggestedType);
        } else {
          setTypeHint(null);
        }
      } catch (err) {
        if (seq === reverseSeq.current) setReverseMsg(`${err.message || 'Address lookup failed'}. Enter the address manually.`);
      } finally {
        if (seq === reverseSeq.current) setResolving(false);
      }
    }, REVERSE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.lat, form.lng, configured]);

  const setField = (k) => (e) => {
    const v = e.target.value;
    if (k === 'name') searchArmed.current = true;
    if (k === 'name' || k === 'type') {
      // the debounced effect does the request; here we only reflect "searching" state immediately
      const q = (k === 'name' ? v : form.name).trim();
      const will = searchArmed.current && q.length >= MIN_QUERY && configured !== false;
      searchSeq.current += 1;
      setSearching(will); setSearchMsg('');
      if (!will) { setSuggestions([]); setOpen(false); }
    }
    if (k === 'lat' || k === 'lng') {
      reverseArmed.current = true; setTypeHint(null); setReverseMsg('');
      const c = validateCoords(k === 'lat' ? v : form.lat, k === 'lng' ? v : form.lng);
      reverseSeq.current += 1;
      setResolving(c.state === 'ok' && configured !== false);
    }
    if (k === 'address') addressAuto.current = false;
    if (k === 'type') setTypeChosen(true);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  function pickSuggestion(s) {
    searchArmed.current = false;
    reverseArmed.current = false; // the place already came with its own address
    addressAuto.current = true;
    setOpen(false);
    setSuggestions([]);
    setSearching(false);
    setTypeHint(null);
    setReverseMsg('');
    setForm((f) => ({ ...f, name: s.name, address: s.address.slice(0, 300), lat: fix(s.lat), lng: fix(s.lng), phone: s.phone && PHONE_RE.test(s.phone) ? s.phone : f.phone }));
  }

  const pickOnMap = useCallback((lat, lng) => {
    reverseArmed.current = true;
    reverseSeq.current += 1;
    setTypeHint(null);
    setReverseMsg('');
    setResolving(configured !== false);
    setForm((f) => ({ ...f, lat: fix(lat), lng: fix(lng) }));
  }, [configured]);

  function onKeyDown(e) {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pickSuggestion(suggestions[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  // ── validation ─────────────────────────────────────────────────────────────
  const errors = {};
  if (!form.name.trim()) errors.name = 'Name is required.';
  if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) errors.phone = 'Enter a valid phone number.';
  if (coords.state === 'empty') errors.coords = 'Choose a location: search for a place, enter coordinates, or click the map.';
  else if (coords.state !== 'ok') errors.coords = coords.message;

  function reset() {
    searchSeq.current += 1; reverseSeq.current += 1;
    searchArmed.current = false; reverseArmed.current = false; addressAuto.current = false;
    setForm(EMPTY); setEditingId(null); setTouched({}); setTypeChosen(false); setTypeHint(null);
    setSuggestions([]); setOpen(false); setSearching(false); setResolving(false); setReverseMsg(''); setSearchMsg('');
  }

  async function submit(e) {
    e.preventDefault();
    setTouched({ name: true, phone: true, coords: true });
    if (Object.keys(errors).length) return;
    setBusy(true);
    const body = {
      name: form.name.trim(), type: form.type,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      location: { lat: coords.lat, lng: coords.lng },
    };
    try {
      if (editingId) await api.patch(`/help-centers/${editingId}`, body);
      else await api.post('/help-centers', body);
      toast.success(editingId ? `${body.name} updated.` : `${body.name} added.`);
      reset();
      load();
    } catch (err) {
      toast.error(err.message || 'Could not save the help center.');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(h) {
    reset();
    setEditingId(h._id);
    setTypeChosen(true);
    setForm({ name: h.name, type: h.type, phone: h.phone || '', address: h.address || '', lat: fix(h.location.lat), lng: fix(h.location.lng) });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function toggle(h) {
    try {
      await api.patch(`/help-centers/${h._id}`, { isActive: !h.isActive });
      toast.success(`${h.name} ${h.isActive ? 'deactivated' : 'activated'}.`);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update the help center.');
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api.delete(`/help-centers/${toDelete._id}`);
      toast.success(`${toDelete.name} removed.`);
      if (editingId === toDelete._id) reset();
      setToDelete(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not remove the help center.');
    } finally {
      setDeleting(false);
    }
  }

  const shown = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return (items || []).filter((h) => (!filter.type || h.type === filter.type)
      && (!q || `${h.name} ${h.address || ''} ${h.phone || ''}`.toLowerCase().includes(q)));
  }, [items, filter]);

  const showErr = (k) => touched[k] && errors[k];

  return (
    <div className="app-page page-stack">
      <div>
        <h1 className="page-title">Help centers</h1>
        <p className="page-subtitle">Hospitals, police stations, pharmacies and other services tourists can reach. Tourists see the nearest active ones first.</p>
      </div>

      <div ref={formRef}>
        <Card title={editingId ? 'Edit help center' : 'Add a help center'} className="hc-form-card">
          {configured === false && (
            <p className="notice notice--warn" role="status">
              <Info size={16} aria-hidden="true" /> Place search isn’t configured on this server (set <code>GEOCODE_USER_AGENT</code> in the backend environment). You can still enter details and coordinates manually.
            </p>
          )}
          <form onSubmit={submit} noValidate className="hc-form">
            <div className="hc-form__fields">
              <fieldset className="fs">
                <legend className="fs__legend">Help center details</legend>
                <div className="fs__grid">
                  <div className="fld">
                    <label htmlFor="hc-type">Service type</label>
                    <select id="hc-type" className="form-input" value={form.type} onChange={setField('type')}>
                      {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <div className="fld fld--combo">
                    <label htmlFor="hc-name">Name</label>
                    <div className="combo">
                      <Search size={16} className="combo__icon" aria-hidden="true" />
                      <input
                        id="hc-name" className="form-input combo__input" maxLength={120} autoComplete="off"
                        role="combobox" aria-expanded={open} aria-controls="hc-suggest" aria-autocomplete="list"
                        aria-activedescendant={active >= 0 ? `hc-sg-${active}` : undefined}
                        aria-invalid={Boolean(showErr('name'))}
                        placeholder={`Search ${typeLabel(form.type).toLowerCase()} by name…`}
                        value={form.name} onChange={setField('name')} onBlur={blur('name')} onKeyDown={onKeyDown}
                        onFocus={() => suggestions.length && setOpen(true)}
                      />
                      {searching && <Loader2 size={16} className="combo__spin spin" aria-label="Searching" />}
                      {open && (
                        <ul id="hc-suggest" role="listbox" className="combo__list">
                          {suggestions.map((s, i) => (
                            <li key={s.placeId} id={`hc-sg-${i}`} role="option" aria-selected={i === active}
                              className={`combo__opt${i === active ? ' is-active' : ''}`}
                              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}>
                              <strong>{s.name}</strong>
                              <span>{s.address}</span>
                            </li>
                          ))}
                          {!suggestions.length && searchMsg && <li className="combo__msg">{searchMsg}</li>}
                        </ul>
                      )}
                    </div>
                    {showErr('name') && <p className="fld__error" role="alert">{errors.name}</p>}
                    {!showErr('name') && <p className="fld__hint">Start typing to pick a real place — its address and coordinates fill in automatically.</p>}
                  </div>
                  <div className="fld">
                    <label htmlFor="hc-phone">Phone <span className="form-hint">(optional)</span></label>
                    <input id="hc-phone" className="form-input" type="tel" autoComplete="off" placeholder="+91 …" value={form.phone}
                      onChange={setField('phone')} onBlur={blur('phone')} aria-invalid={Boolean(showErr('phone'))} />
                    {showErr('phone') && <p className="fld__error" role="alert">{errors.phone}</p>}
                  </div>
                </div>
              </fieldset>

              <fieldset className="fs">
                <legend className="fs__legend">Location details</legend>
                <div className="fs__grid">
                  <div className="fld fld--wide">
                    <label htmlFor="hc-address">Address {resolving && <span className="form-hint inline-busy"><Loader2 size={12} className="spin" aria-hidden="true" /> Looking up address…</span>}</label>
                    <textarea id="hc-address" className="form-input" rows={2} maxLength={300} placeholder="Full street address"
                      value={form.address} onChange={setField('address')} />
                    {reverseMsg && <p className="fld__hint fld__hint--warn" role="status">{reverseMsg}</p>}
                  </div>
                  <div className="fld">
                    <label htmlFor="hc-lat">Latitude</label>
                    <input id="hc-lat" className="form-input" inputMode="decimal" placeholder="e.g. 28.613900" value={form.lat}
                      onChange={setField('lat')} onBlur={blur('coords')} aria-invalid={Boolean(showErr('coords') && coords.field !== 'lng')} />
                  </div>
                  <div className="fld">
                    <label htmlFor="hc-lng">Longitude</label>
                    <input id="hc-lng" className="form-input" inputMode="decimal" placeholder="e.g. 77.209000" value={form.lng}
                      onChange={setField('lng')} onBlur={blur('coords')} aria-invalid={Boolean(showErr('coords') && coords.field !== 'lat')} />
                  </div>
                  {showErr('coords') && <p className="fld__error fld--wide" role="alert">{errors.coords}</p>}
                  {typeHint && (
                    <p className="fld--wide notice notice--info" role="status">
                      <Info size={16} aria-hidden="true" /> This location looks like a <strong>{typeLabel(typeHint)}</strong>.
                      <button type="button" className="link-btn" onClick={() => { setForm((f) => ({ ...f, type: typeHint })); setTypeHint(null); }}>Use {typeLabel(typeHint)}</button>
                    </p>
                  )}
                </div>
              </fieldset>
            </div>

            <div className="hc-form__map">
              <p className="fs__legend">Map preview</p>
              <LocationPicker point={point} onPick={pickOnMap} height={300} />
              <p className="fld__hint">Click the map or drag the pin to adjust — coordinates update and the address is looked up again.</p>
            </div>

            <div className="hc-form__actions">
              {editingId && <button type="button" className="btn btn--ghost" onClick={reset}><X size={16} aria-hidden="true" /> Cancel edit</button>}
              <button className="btn btn--primary" disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add help center'}
              </button>
            </div>
          </form>
        </Card>
      </div>

      <Card title={`Saved help centers${items ? ` (${items.length})` : ''}`}>
        <div className="hc-filters">
          <div className="combo hc-filters__search">
            <Search size={16} className="combo__icon" aria-hidden="true" />
            <input className="form-input combo__input" type="search" aria-label="Search help centers" placeholder="Search by name, address or phone"
              value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <select className="form-input hc-filters__type" aria-label="Filter by type" value={filter.type} onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}>
            <option value="">All types</option>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {error ? <ErrorState message={error} onRetry={load} />
          : !items ? <SkeletonRows rows={4} />
            : items.length === 0 ? (
              <EmptyState icon={LifeBuoy} title="No help centers yet">Add hospitals, police stations and embassies tourists can reach. Nothing is pre-filled.</EmptyState>
            ) : shown.length === 0 ? (
              <EmptyState icon={Search} title="No matches">No saved help center matches this search.</EmptyState>
            ) : (
              <ul className="hc-grid">
                {shown.map((h) => {
                  const Icon = TYPES[h.type]?.icon || Building2;
                  const { lat, lng } = h.location;
                  return (
                    <li key={h._id} className={`hc-card${h.isActive ? '' : ' is-inactive'}`}>
                      <div className="hc-card__top">
                        <span className="hc-card__icon"><Icon size={20} aria-hidden="true" /></span>
                        <div className="hc-card__title">
                          <h3>{h.name}</h3>
                          <div className="badge-row"><Badge variant="info">{typeLabel(h.type)}</Badge>{!h.isActive && <Badge variant="neutral">Inactive</Badge>}</div>
                        </div>
                      </div>
                      <dl className="hc-card__meta">
                        <div><dt><Phone size={14} aria-label="Phone" /></dt><dd>{h.phone ? <a href={`tel:${h.phone.replace(/[\s()-]/g, '')}`}>{h.phone}</a> : <span className="muted">No phone</span>}</dd></div>
                        <div><dt><MapPin size={14} aria-label="Address" /></dt><dd>{h.address || <span className="muted">No address</span>}</dd></div>
                        <div><dt><Crosshair size={14} aria-label="Coordinates" /></dt><dd className="mono">{fix(lat)}, {fix(lng)}</dd></div>
                      </dl>
                      <div className="hc-card__actions">
                        <a className="btn btn--ghost btn--sm" target="_blank" rel="noreferrer noopener"
                          href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`}>
                          <ExternalLink size={14} aria-hidden="true" /> View on map
                        </a>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEdit(h)}><Pencil size={14} aria-hidden="true" /> Edit</button>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggle(h)}>{h.isActive ? 'Deactivate' : 'Activate'}</button>
                        <button type="button" className="btn btn--ghost btn--sm btn--danger-text" aria-label={`Delete ${h.name}`} onClick={() => setToDelete(h)}><Trash2 size={14} aria-hidden="true" /> Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
      </Card>

      <ConfirmDialog
        open={Boolean(toDelete)} danger busy={deleting}
        title="Delete this help center?"
        message={toDelete ? `“${toDelete.name}” will be removed and tourists will no longer see it. This cannot be undone.` : ''}
        confirmLabel="Delete" onConfirm={confirmDelete} onCancel={() => !deleting && setToDelete(null)}
      />
    </div>
  );
}

export default HelpCenters;
