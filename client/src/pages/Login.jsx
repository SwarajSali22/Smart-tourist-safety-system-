import { useEffect, useState } from 'react';
import { Eye, EyeOff, ShieldCheck, UserRound, Loader2 } from 'lucide-react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Spinner from '../shared/components/ui/Spinner.jsx';
import { useAuth } from '../shared/auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { ThemeToggle } from '../shared/theme/ThemeContext.jsx';
import { ROLE_HOME } from '../shared/navConfig.js';

// The invitation token must survive redirects, reloads and the sign-in/register switch, so it is kept for this tab.
const INVITE_KEY = 'sts_invite';
function readInvite() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('invite');
    if (fromUrl) { sessionStorage.setItem(INVITE_KEY, fromUrl); return fromUrl; }
    return sessionStorage.getItem(INVITE_KEY) || '';
  } catch { return ''; }
}
function clearInvite() { try { sessionStorage.removeItem(INVITE_KEY); } catch { /* ignore */ } }

/**
 * Someone who is ALREADY signed in opened an invitation link. Previously the page just redirected to their dashboard
 * and the invitation was lost. A tourist now joins the group (the server decides the group from the token); staff
 * accounts cannot join and are told to sign out.
 */
function JoinGroup({ invite }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isTourist = user.role === 'tourist';
  const [state, setState] = useState({ phase: isTourist ? 'joining' : 'staff', group: '', message: '' });
  useEffect(() => {
    if (!isTourist) return undefined;
    let live = true;
    api.post(`/invitations/${encodeURIComponent(invite)}/join`, {})
      .then((d) => live && setState({ phase: 'done', group: d.group.name, message: d.status === 'already_member' ? 'You are already a member of this group.' : 'You have joined the group.' }))
      .catch((e) => live && setState({ phase: 'error', group: '', message: e.message || 'The invitation could not be used.' }));
    return () => { live = false; };
  }, [invite, isTourist]);
  const proceed = () => { clearInvite(); navigate(ROLE_HOME[user.role] || '/', { replace: true }); };
  return (
    <main className="auth-page" id="main">
      <div className="login-wrap">
        <h1 className="login-wrap__title">Tour group invitation</h1>
        <section className="login-panel" role="status">
          {state.phase === 'joining' && <p>Joining the group…</p>}
          {state.phase === 'done' && <p><strong>{state.group}</strong>: {state.message}</p>}
          {state.phase === 'error' && <p className="form-error" role="alert">{state.message}</p>}
          {state.phase === 'staff' && <p className="form-error" role="alert">You are signed in as staff ({user.name}). Staff accounts cannot join a tour group. Sign out, then open the link again to register as a tourist.</p>}
          <div className="detail-actions mt-4">
            {state.phase === 'staff'
              ? <button className="btn btn--primary btn--sm" type="button" onClick={async () => { await logout(); }}>Sign out</button>
              : <button className="btn btn--primary btn--sm" type="button" disabled={state.phase === 'joining'} onClick={proceed}>Continue to my dashboard</button>}
            {state.phase === 'staff' && <button className="btn btn--ghost btn--sm" type="button" onClick={proceed}>Back to dashboard</button>}
          </div>
        </section>
      </div>
    </main>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete, minLength, hint }) {
  const [show, setShow] = useState(false);
  return (
    <div className="form-label">
      <label htmlFor={id}>{label} {hint && <span className="form-hint">{hint}</span>}</label>
      <span className="input-with-btn">
        <input
          id={id}
          className="form-input"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          required
          minLength={minLength}
          autoComplete={autoComplete}
        />
        <button type="button" className="icon-btn input-with-btn__btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </span>
    </div>
  );
}

function Field({ id, label, hint, ...props }) {
  return (
    <div className="form-label">
      <label htmlFor={id}>{label} {hint && <span className="form-hint">{hint}</span>}</label>
      <input id={id} className="form-input" {...props} />
    </div>
  );
}

function PanelHeader({ icon: Icon, title, subtitle }) {
  return (
    <header className="login-panel__head">
      <span className="login-panel__icon"><Icon size={22} aria-hidden="true" /></span>
      <div>
        <h2 className="login-panel__title">{title}</h2>
        <p className="login-panel__sub">{subtitle}</p>
      </div>
    </header>
  );
}

const Submit = ({ busy, idle, working }) => (
  <button className="btn btn--primary btn--full login-panel__submit" type="submit" disabled={busy}>
    {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
    {busy ? working : idle}
  </button>
);

/** Administrator / responder sign-in. The server refuses tourist accounts on this panel. */
function StaffPanel({ onDone }) {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onDone(await login(form.email, form.password, 'staff'));
    } catch (err) {
      setError(err.message || 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <section className="login-panel" aria-labelledby="staff-title">
      <PanelHeader icon={ShieldCheck} title="Admin login" subtitle="Administrators and response team" />
      <span id="staff-title" className="sr-only">Admin login</span>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form onSubmit={submit} className="auth-form" noValidate={false}>
        <Field id="admin-email" label="Admin email" type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="admin@example.com" />
        <PasswordField id="admin-password" label="Password" autoComplete="current-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <Submit busy={busy} idle="Admin login" working="Signing in…" />
      </form>
      <p className="login-panel__note">Administrator accounts are issued by your organisation and can’t be created here.</p>
    </section>
  );
}

/** Tourist sign-in, with an in-place switch to registration (tourist accounts only). */
function TouristPanel({ onDone, initialMode }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';
  // A guide's invitation link (/register?invite=...): show which group it joins; the server re-checks it on submit.
  const [invite] = useState(readInvite);
  const [inviteGroup, setInviteGroup] = useState(null); // null = not checked, '' = invalid
  useEffect(() => {
    if (!invite) return;
    api.get(`/invitations/${encodeURIComponent(invite)}`).then((d) => setInviteGroup(d.group.name)).catch(() => setInviteGroup(''));
  }, [invite]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (isRegister && form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      const user = isRegister
        ? await register({ name: form.name, email: form.email, password: form.password, phone: form.phone || undefined, role: 'tourist', ...(invite ? { invite } : {}) })
        : await login(form.email, form.password, 'tourist');
      onDone(user);
    } catch (err) {
      setError(err.message || (isRegister ? 'Registration failed' : 'Sign-in failed'));
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setForm({ name: '', email: '', password: '', phone: '' });
    setError('');
  }

  return (
    <section className="login-panel" aria-labelledby="tourist-title">
      <PanelHeader
        icon={UserRound}
        title={isRegister ? 'Tourist registration' : 'Tourist login'}
        subtitle={isRegister ? 'Create your traveller account' : 'Travellers and visitors'}
      />
      <span id="tourist-title" className="sr-only">Tourist {isRegister ? 'registration' : 'login'}</span>
      {error && <p className="form-error" role="alert">{error}</p>}
      {invite && inviteGroup && <p className="form-hint" role="status">{isRegister ? 'You are joining' : 'After you sign in you will join'} the group <strong>{inviteGroup}</strong>.</p>}
      {invite && inviteGroup === '' && <p className="form-error" role="alert">This invitation is invalid, expired or withdrawn. Ask your guide for a new link.</p>}
      <form onSubmit={submit} className="auth-form">
        {isRegister && <Field id="t-name" label="Full name" type="text" autoComplete="name" required maxLength={100} value={form.name} onChange={set('name')} />}
        <Field id="t-email" label="Tourist email" type="email" autoComplete={isRegister ? 'email' : 'username'} required value={form.email} onChange={set('email')} placeholder="you@example.com" />
        <PasswordField id="t-password" label="Password" hint={isRegister ? '(min 8 characters)' : ''} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 8 : undefined} value={form.password} onChange={set('password')} />
        {isRegister && <Field id="t-phone" label="Phone" hint="(optional)" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />}
        <Submit busy={busy} idle={isRegister ? 'Create tourist account' : 'Tourist login'} working={isRegister ? 'Creating account…' : 'Signing in…'} />
      </form>
      <p className="login-panel__note">
        {isRegister
          ? <>Already registered? <button type="button" className="link-btn" onClick={() => switchMode('login')}>Tourist login</button></>
          : <>New here? <button type="button" className="link-btn" onClick={() => switchMode('register')}>Register as a tourist</button></>}
      </p>
    </section>
  );
}

function Login({ initialMode = 'login' }) {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const from = useLocation().state?.from?.pathname;
  const done = (u) => navigate(from || ROLE_HOME[u.role], { replace: true });

  // Already signed in (e.g. opening "/" with a live session) — go straight to the right dashboard.
  if (loading) return <Spinner fullPage />;
  const pendingInvite = readInvite();
  if (user && pendingInvite) return <JoinGroup invite={pendingInvite} />;
  if (user) return <Navigate to={from || ROLE_HOME[user.role] || '/'} replace />;

  return (
    <main className="auth-page auth-page--dual" id="main">
      <div className="auth-page__tools"><ThemeToggle /></div>
      <div className="login-wrap login-wrap--anim">
        <Link to="/" className="auth-card__brand login-wrap__brand">
          <span className="app-brand__logo"><ShieldCheck size={18} aria-hidden="true" /></span>
          <span>Smart Tourist Safety</span>
        </Link>
        <h1 className="login-wrap__title">Sign in to continue</h1>
        <div className="login-grid">
          <StaffPanel onDone={done} />
          <TouristPanel onDone={done} initialMode={initialMode} />
        </div>
      </div>
    </main>
  );
}

export default Login;
