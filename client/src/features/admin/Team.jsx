import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../shared/components/ui/Toast.jsx';
import Card from '../../shared/components/ui/Card.jsx';
import Badge from '../../shared/components/ui/Badge.jsx';
import ErrorState from '../../shared/components/ui/ErrorState.jsx';
import { SkeletonRows } from '../../shared/components/ui/Skeleton.jsx';
import { label } from '../../shared/utils/format.js';

const EMPTY = { name: '', email: '', password: '', phone: '' };

/** Admins and responders who can be assigned incidents; admins can add responder accounts. */
function Team() {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.get('/users/assignable')
    .then((d) => { setUsers(d.users || []); setError(''); })
    .catch((e) => setError(e.message || 'Could not load the team')), []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: form.name, email: form.email, password: form.password, ...(form.phone ? { phone: form.phone } : {}) };
      await api.post('/users/responders', body);
      toast.success(`Responder ${form.name} created.`);
      setForm(EMPTY);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not create the responder.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <h1 className="page-title">Team</h1>
      <Card title="Add a responder">
        <form onSubmit={submit} className="form-grid">
          <label>Name<input required maxLength={100} value={form.name} onChange={set('name')} /></label>
          <label>Email<input required type="email" value={form.email} onChange={set('email')} /></label>
          <label>Password<input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} /></label>
          <label>Phone (optional)<input type="tel" value={form.phone} onChange={set('phone')} /></label>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Creating…' : 'Create responder'}</button>
        </form>
      </Card>
      <Card title="Admins and responders">
        {error ? <ErrorState message={error} onRetry={load} />
          : !users ? <SkeletonRows rows={4} />
            : users.length === 0 ? <p className="muted">No team members yet.</p>
              : (
                <ul>
                  {users.map((u) => (
                    <li key={u._id}>
                      {u.name} — {u.email}{' '}
                      <Badge variant={u.role === 'admin' ? 'info' : 'neutral'}>{label(u.role)}</Badge>
                      {u.isDemo && <Badge variant="neutral">Demo</Badge>}{' '}
                      <span className="muted">{u.activeIncidents} active</span>
                    </li>
                  ))}
                </ul>
              )}
      </Card>
    </div>
  );
}

export default Team;
