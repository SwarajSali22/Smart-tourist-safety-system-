import { useState } from 'react';
import { Eye, EyeOff, ShieldCheck, UserRound, Loader2 } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthContext.jsx';
import { ThemeToggle } from '../shared/theme/ThemeContext.jsx';
import { ROLE_HOME } from '../shared/navConfig.js';

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
        ? await register({ name: form.name, email: form.email, password: form.password, phone: form.phone || undefined, role: 'tourist' })
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
  const from = useLocation().state?.from?.pathname;
  const done = (user) => navigate(from || ROLE_HOME[user.role], { replace: true });

  return (
    <main className="auth-page auth-page--dual" id="main">
      <div className="auth-page__tools"><ThemeToggle /></div>
      <div className="login-wrap">
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
