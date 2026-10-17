import { Link, Navigate } from 'react-router-dom';
import { Link2, MapPinned, Radio, ShieldCheck, Siren } from 'lucide-react';
import HealthStatus from '../components/HealthStatus.jsx';
import PublicStats from '../components/PublicStats.jsx';
import { useAuth } from '../shared/auth/AuthContext.jsx';
import { ThemeToggle } from '../shared/theme/ThemeContext.jsx';
import { ROLE_HOME } from '../shared/navConfig.js';

const FEATURES = [
  { icon: MapPinned, title: 'GPS geofencing', text: 'Safe, restricted and danger zones with instant alerts when a tourist crosses a boundary.' },
  { icon: ShieldCheck, title: 'Live risk scoring', text: 'A transparent, explainable score updates as conditions change — rules always override.' },
  { icon: Siren, title: 'One-tap SOS', text: 'Admins and emergency contacts are alerted immediately, and every step is tracked.' },
  { icon: Link2, title: 'Tamper-evident audit trail', text: 'Critical events are hash-chained so records can be verified later.' },
];

function Home() {
  const { user, loading } = useAuth();

  // Already logged in — redirect straight to their dashboard
  if (!loading && user) {
    return <Navigate to={ROLE_HOME[user.role] || '/'} replace />;
  }

  return (
    <main className="landing">
      <div className="landing__top"><ThemeToggle /></div>
      <section className="landing__hero">
        <span className="landing__logo"><Radio size={22} aria-hidden="true" /></span>
        <h1>Smart Tourist Safety System</h1>
        <p className="landing__lead">Real-time tracking, geofencing and emergency response — so travellers and the people looking after them always know what’s happening.</p>
        <nav className="page-nav page-nav--center" aria-label="Get started">
          <Link className="btn btn--primary" to="/login">Sign in</Link>
          <Link className="btn btn--ghost" to="/register">Create a tourist account</Link>
        </nav>
        <PublicStats />
        <HealthStatus />
      </section>

      <ul className="landing__features">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="card landing__feature">
            <Icon size={22} aria-hidden="true" />
            <h2>{title}</h2>
            <p>{text}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default Home;
