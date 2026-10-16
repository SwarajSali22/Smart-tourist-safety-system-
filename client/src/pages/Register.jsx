import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthContext.jsx';
import AuthFrame from '../shared/layouts/AuthFrame.jsx';
import { ROLE_HOME } from '../shared/navConfig.js';

function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const user = await register({
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        role: 'tourist', // self-registration is always tourist
      });
      navigate(ROLE_HOME[user.role], { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame title="Create account" footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      {error && <p className="form-error" role="alert">{error}</p>}

      <form onSubmit={handleSubmit} className="auth-form">
        <label className="form-label">
          Full name
          <input className="form-input" type="text" name="name" value={form.name} onChange={handleChange} required autoComplete="name" />
        </label>

        <label className="form-label">
          Email
          <input className="form-input" type="email" name="email" value={form.email} onChange={handleChange} required autoComplete="email" />
        </label>

        <label className="form-label">
          Password <span className="form-hint">(min 8 characters)</span>
          <span className="input-with-btn">
            <input
              className="form-input"
              type={showPw ? 'text' : 'password'}
              name="password"
              value={form.password}
              onChange={handleChange}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <button type="button" className="icon-btn input-with-btn__btn" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </span>
        </label>

        <label className="form-label">
          Phone <span className="form-hint">(optional)</span>
          <input className="form-input" type="tel" name="phone" value={form.phone} onChange={handleChange} autoComplete="tel" />
        </label>

        <button className="btn btn--primary btn--full" type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthFrame>
  );
}

export default Register;
