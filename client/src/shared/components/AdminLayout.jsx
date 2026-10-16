import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3, LayoutDashboard, Link2, LogOut, Menu, Radar, Shapes, ShieldCheck, Siren, Users, Watch, X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { AlertsProvider, useAlerts } from '../alerts/AlertsContext.jsx';
import AlertBell from '../alerts/AlertBell.jsx';
import { ThemeToggle } from '../theme/ThemeContext.jsx';

const NAV_ITEMS = [
  { to: '/admin',            label: 'Dashboard',    icon: LayoutDashboard, end: true },
  { to: '/admin/map',        label: 'Live map',     icon: Radar },
  { to: '/admin/tourists',   label: 'Tourists',     icon: Users },
  { to: '/admin/zones',      label: 'Zones',        icon: Shapes },
  { to: '/admin/devices',    label: 'Devices',      icon: Watch },
  { to: '/admin/incidents',  label: 'Incidents',    icon: Siren },
  { to: '/admin/analytics',  label: 'Analytics',    icon: BarChart3 },
  { to: '/admin/blockchain', label: 'Audit proofs', icon: Link2 },
];

function SosBanner() {
  const { activeSos } = useAlerts();
  if (activeSos.length === 0) return null;
  const unacked = activeSos.filter((e) => e.status === 'active');
  const first = activeSos[0];
  return (
    <div className="sos-banner" role="alert">
      <Siren size={18} aria-hidden="true" />
      <span>
        <strong>{activeSos.length} active SOS</strong>
        {' — '}
        {first.tourist?.name || 'A tourist'}
        {activeSos.length > 1 ? ` and ${activeSos.length - 1} more` : ''}
        {unacked.length > 0 ? ` (${unacked.length} awaiting acknowledgement)` : ' (all acknowledged)'}
      </span>
      <Link to="/admin/incidents" className="btn btn--sm sos-banner__btn">Respond</Link>
    </div>
  );
}

function AdminShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer on Escape (navigation closes it via the link onClick).
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>

      {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <aside className={`sidebar${menuOpen ? ' sidebar--open' : ''}`} id="admin-sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo"><ShieldCheck size={18} aria-hidden="true" /></span>
          <span>STS Admin</span>
          <button type="button" className="icon-btn sidebar__close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav className="sidebar__nav" aria-label="Admin">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => 'sidebar__link' + (isActive ? ' sidebar__link--active' : '')}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <span className="sidebar__user" title={user?.email}>{user?.name}</span>
          <button className="btn btn--ghost btn--sm" onClick={handleLogout}>
            <LogOut size={14} aria-hidden="true" /> Logout
          </button>
        </div>
      </aside>

      <div className="shell__col">
        <header className="topstrip">
          <button
            type="button"
            className="icon-btn topstrip__menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="admin-sidebar"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <span className="topstrip__title">Smart Tourist Safety</span>
          <div className="topstrip__tools">
            <AlertBell />
            <ThemeToggle />
          </div>
        </header>
        <SosBanner />
        <main className="shell__main" id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AdminLayout() {
  return (
    <AlertsProvider>
      <AdminShell />
    </AlertsProvider>
  );
}

export default AdminLayout;
