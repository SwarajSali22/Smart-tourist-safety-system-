import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Pencil, Phone, Plus, Search, ShieldCheck, UserCheck, UserX, UsersRound, X, Eye, EyeOff } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../shared/auth/AuthContext.jsx';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import EmptyState from '../../shared/components/ui/EmptyState.jsx';
import ConfirmDialog from '../../shared/components/ui/ConfirmDialog.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { label } from '../../shared/utils/format.js';

const EMPTY = { name: '', email: '', password: '', phone: '' };
const PHONE_RE = /^\+?[\d\s()-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  role: (a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name),
  load: (a, b) => b.activeIncidents - a.activeIncidents || a.name.localeCompare(b.name),
};

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

/** Admins and responders who can be assigned incidents; admins manage responder accounts. */
function Team() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // responder being edited, or null when adding
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState({ q: '', role: '', status: '' });
  const [sort, setSort] = useState('role');
  const [toggleTarget, setToggleTarget] = useState(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(() => api.get('/users/assignable?all=1')
    .then((d) => { setUsers(d.users || []); setError(''); })
    .catch((e) => setError(e.message || 'Could not load the team')), []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const errors = {};
  if (!form.name.trim()) errors.name = 'Name is required.';
  if (!editing) {
    if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Enter a valid email address.';
    if (form.password.length < 8) errors.password = 'Password must be at least 8 characters.';
  }
  if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) errors.phone = 'Enter a valid phone number.';
  const showErr = (k) => touched[k] && errors[k];

  function closeForm() {
    setFormOpen(false); setEditing(null); setForm(EMPTY); setTouched({}); setShowPw(false);
  }
  function openAdd() {
    setEditing(null); setForm(EMPTY); setTouched({}); setFormOpen(true);
  }
  function openEdit(u) {
    setEditing(u); setForm({ name: u.name, email: u.email, password: '', phone: u.phone || '' }); setTouched({}); setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(e) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true, phone: true });
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/users/${editing._id}`, { name: form.name.trim(), phone: form.phone.trim() || null });
        toast.success(`${form.name.trim()} updated.`);
      } else {
        await api.post('/users/responders', {
          name: form.name.trim(), email: form.email.trim(), password: form.password,
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        });
        toast.success(`Responder ${form.name.trim()} created.`);
      }
      closeForm();
      load();
    } catch (err) {
      toast.error(err.message || 'Could not save the team member.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmToggle() {
    const u = toggleTarget;
    setToggling(true);
    try {
      await api.patch(`/users/${u._id}`, { isActive: u.isActive === false });
      toast.success(`${u.name} ${u.isActive === false ? 'reactivated' : 'deactivated'}.`);
      setToggleTarget(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update the account.');
      setToggleTarget(null);
    } finally {
      setToggling(false);
    }
  }

  const shown = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return (users || [])
      .filter((u) => (!filter.role || u.role === filter.role)
        && (!filter.status || (filter.status === 'active') === (u.isActive !== false))
        && (!q || `${u.name} ${u.email} ${u.phone || ''}`.toLowerCase().includes(q)))
      .sort(SORTS[sort]);
  }, [users, filter, sort]);

  const counts = useMemo(() => ({
    admins: (users || []).filter((u) => u.role === 'admin').length,
    responders: (users || []).filter((u) => u.role === 'responder').length,
    active: (users || []).reduce((n, u) => n + u.activeIncidents, 0),
  }), [users]);

  return (
    <div className="page-stack">
      <div className="team-head">
        <div>
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle">Administrators and responders who can be assigned incidents.</p>
        </div>
        {!formOpen && <button type="button" className="btn btn--primary" onClick={openAdd}><Plus size={16} aria-hidden="true" /> Add responder</button>}
      </div>

      {users && (
        <div className="team-stats">
          <span><strong>{counts.admins}</strong> admin{counts.admins === 1 ? '' : 's'}</span>
          <span><strong>{counts.responders}</strong> responder{counts.responders === 1 ? '' : 's'}</span>
          <span><strong>{counts.active}</strong> active assignment{counts.active === 1 ? '' : 's'}</span>
        </div>
      )}

      {formOpen && (
        <Card title={editing ? `Edit ${editing.name}` : 'Add a responder'}>
          <form onSubmit={submit} noValidate className="team-form">
            <div className="fld">
              <label htmlFor="tm-name">Full name</label>
              <input id="tm-name" className="form-input" maxLength={100} placeholder="e.g. Priya Sharma" value={form.name}
                onChange={set('name')} onBlur={blur('name')} aria-invalid={Boolean(showErr('name'))} />
              {showErr('name') && <p className="fld__error" role="alert">{errors.name}</p>}
            </div>
            <div className="fld">
              <label htmlFor="tm-email">Email</label>
              <input id="tm-email" className="form-input" type="email" placeholder="responder@example.com" value={form.email}
                onChange={set('email')} onBlur={blur('email')} disabled={Boolean(editing)} autoComplete="off" aria-invalid={Boolean(showErr('email'))} />
              {showErr('email') && <p className="fld__error" role="alert">{errors.email}</p>}
              {editing && <p className="fld__hint">The email is the login and can’t be changed.</p>}
            </div>
            {!editing && (
              <div className="fld">
                <label htmlFor="tm-pw">Temporary password <span className="form-hint">(min 8 characters)</span></label>
                <span className="input-with-btn">
                  <input id="tm-pw" className="form-input" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={form.password}
                    onChange={set('password')} onBlur={blur('password')} aria-invalid={Boolean(showErr('password'))} />
                  <button type="button" className="icon-btn input-with-btn__btn" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                    {showPw ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </span>
                {showErr('password') && <p className="fld__error" role="alert">{errors.password}</p>}
              </div>
            )}
            <div className="fld">
              <label htmlFor="tm-phone">Phone <span className="form-hint">(optional)</span></label>
              <input id="tm-phone" className="form-input" type="tel" placeholder="+91 …" value={form.phone}
                onChange={set('phone')} onBlur={blur('phone')} aria-invalid={Boolean(showErr('phone'))} />
              {showErr('phone') && <p className="fld__error" role="alert">{errors.phone}</p>}
            </div>
            <div className="team-form__actions">
              <button type="button" className="btn btn--ghost" onClick={closeForm}><X size={16} aria-hidden="true" /> Cancel</button>
              <button className="btn btn--primary" disabled={busy}>
                {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create responder'}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Members">
        <div className="hc-filters">
          <div className="combo hc-filters__search">
            <Search size={16} className="combo__icon" aria-hidden="true" />
            <input className="form-input combo__input" type="search" aria-label="Search team" placeholder="Search by name, email or phone"
              value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <select className="form-input hc-filters__type" aria-label="Filter by role" value={filter.role} onChange={(e) => setFilter((f) => ({ ...f, role: e.target.value }))}>
            <option value="">All roles</option><option value="admin">Admins</option><option value="responder">Responders</option>
          </select>
          <select className="form-input hc-filters__type" aria-label="Filter by status" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Any status</option><option value="active">Active</option><option value="inactive">Deactivated</option>
          </select>
          <select className="form-input hc-filters__type" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="role">Sort: role</option><option value="name">Sort: name</option><option value="load">Sort: workload</option>
          </select>
        </div>

        {error ? <ErrorState message={error} onRetry={load} />
          : !users ? <SkeletonRows rows={4} />
            : users.length === 0 ? <EmptyState icon={UsersRound} title="No team members yet">Add a responder so incidents can be assigned.</EmptyState>
              : shown.length === 0 ? <EmptyState icon={Search} title="No matches">No team member matches these filters.</EmptyState>
                : (
                  <ul className="team-grid">
                    {shown.map((u) => {
                      const inactive = u.isActive === false;
                      const isAdmin = u.role === 'admin';
                      return (
                        <li key={u._id} className={`team-card${inactive ? ' is-inactive' : ''}`}>
                          <div className="team-card__top">
                            <span className={`avatar${isAdmin ? ' avatar--admin' : ''}`} aria-hidden="true">{initials(u.name)}</span>
                            <div className="team-card__id">
                              <h3>{u.name}{u._id === me?.id && <span className="muted"> (you)</span>}</h3>
                              <div className="badge-row">
                                <Badge variant={isAdmin ? 'info' : 'neutral'}>{isAdmin && <ShieldCheck size={12} aria-hidden="true" />}{label(u.role)}</Badge>
                                <Badge variant={inactive ? 'danger' : 'success'}>{inactive ? 'Deactivated' : 'Active'}</Badge>
                                {u.isDemo && <Badge variant="neutral">Demo</Badge>}
                              </div>
                            </div>
                          </div>
                          <dl className="hc-card__meta">
                            <div><dt><Mail size={14} aria-label="Email" /></dt><dd className="break">{u.email}</dd></div>
                            <div><dt><Phone size={14} aria-label="Phone" /></dt><dd>{u.phone || <span className="muted">No phone</span>}</dd></div>
                          </dl>
                          <p className={`team-card__load${u.activeIncidents ? ' has-load' : ''}`}>
                            {u.activeIncidents ? `${u.activeIncidents} active incident${u.activeIncidents === 1 ? '' : 's'} assigned` : 'No active assignments'}
                          </p>
                          {!isAdmin && (
                            <div className="hc-card__actions">
                              <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(u)}><Pencil size={14} aria-hidden="true" /> Edit</button>
                              <button type="button" className={`btn btn--ghost btn--sm${inactive ? '' : ' btn--danger-text'}`} onClick={() => setToggleTarget(u)}>
                                {inactive ? <><UserCheck size={14} aria-hidden="true" /> Reactivate</> : <><UserX size={14} aria-hidden="true" /> Deactivate</>}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
      </Card>

      <ConfirmDialog
        open={Boolean(toggleTarget)} danger={toggleTarget?.isActive !== false} busy={toggling}
        title={toggleTarget?.isActive === false ? 'Reactivate this responder?' : 'Deactivate this responder?'}
        message={toggleTarget
          ? (toggleTarget.isActive === false
            ? `${toggleTarget.name} will be able to sign in and receive assignments again.`
            : `${toggleTarget.name} can no longer sign in or refresh a session (an open session lapses within minutes). Their history is kept.`)
          : ''}
        confirmLabel={toggleTarget?.isActive === false ? 'Reactivate' : 'Deactivate'}
        onConfirm={confirmToggle} onCancel={() => !toggling && setToggleTarget(null)}
      />
    </div>
  );
}

export default Team;
