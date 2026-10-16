import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '../theme/ThemeContext.jsx';

/** Shared frame for Login / Register: same card, brand mark and theme toggle as the app shell. */
function AuthFrame({ title, footer, children }) {
  return (
    <main className="auth-page" id="main">
      <div className="auth-page__tools"><ThemeToggle /></div>
      <div className="auth-card">
        <Link to="/" className="auth-card__brand">
          <span className="app-brand__logo"><ShieldCheck size={18} aria-hidden="true" /></span>
          <span>Smart Tourist Safety</span>
        </Link>
        <h1 className="auth-card__title">{title}</h1>
        {children}
        {footer && <p className="auth-card__footer">{footer}</p>}
      </div>
    </main>
  );
}

export default AuthFrame;
