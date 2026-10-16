import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthContext.jsx';
import AuthFrame from '../shared/layouts/AuthFrame.jsx';
import { ROLE_HOME } from '../shared/navConfig.js';

function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname;

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      // Go back to where they came from, or role-based home
      navigate(from || ROLE_HOME[user.role], { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame title="Sign in" footer={<>No account? <Link to="/register">Register</Link></>}>
      {error && <p className="form-error" role="alert">{error}</p>}

      <form onSubmit={handleSubmit} className="auth-form">
        <label className="form-label">
          Email
          <input className="form-input" type="email" name="email" value={form.email} onChange={handleChange} required autoComplete="email" />
        </label>

        <label className="form-label">
          Password
          <span className="input-with-btn">
            <input
              className="form-input"
              type={showPw ? 'text' : 'password'}
              name="password"
              value={form.password}
              onChange={handleChange}
              required
              autoComplete="current-password"
            />
            <button type="button" className="icon-btn input-with-btn__btn" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </span>
        </label>

        <button className="btn btn--primary btn--full" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthFrame>
  );
}

export default Login;
