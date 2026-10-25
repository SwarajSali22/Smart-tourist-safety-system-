import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, MoreHorizontal, ShieldCheck, Siren, TriangleAlert, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { AlertsProvider, useAlerts } from '../alerts/AlertsContext.jsx';
import AlertBell from '../alerts/AlertBell.jsx';
import SyncStatus from '../offline/SyncStatus.jsx';
import ConnectionStatus from '../components/ConnectionStatus.jsx';
import { ThemeToggle } from '../theme/ThemeContext.jsx';
import { NAV, ROLE_HOME, ROLE_TITLE } from '../navConfig.js';
import UserMenu from './UserMenu.jsx';
import { LocationSharingProvider } from '../location/LocationSharingContext.jsx';
import { I18nProvider, LanguageSwitcher, useI18n } from '../i18n/I18nContext.jsx';

/** Red banner while an SOS is open: admins see all active SOS, a tourist sees their own. */
function SosBanner({ role }) {
  const { activeSos } = useAlerts();
  const { t } = useI18n();
  if (activeSos.length === 0) return null;

  if (role === 'tourist') {
    const sos = activeSos[0];
    return (
      <div className="sos-banner" role="alert">
        <Siren size={18} aria-hidden="true" />
        <span>
          <strong>{sos.status === 'acknowledged' ? t('shell.sos.acknowledged') : t('shell.sos.active')}</strong>{' '}
          {sos.status === 'acknowledged' ? t('shell.sos.responding') : t('shell.sos.alerted')}
        </span>
        <Link to="/tourist/sos" className="btn btn--sm sos-banner__btn">{t('shell.sos.view')}</Link>
      </div>
    );
  }

  const unacked = activeSos.filter((e) => e.status === 'active');
  return (
    <div className="sos-banner" role="alert">
      <Siren size={18} aria-hidden="true" />
      <span>
        <strong>{activeSos.length} active SOS</strong>
        {' — '}
        {activeSos[0].tourist?.name || 'A tourist'}
        {activeSos.length > 1 ? ` and ${activeSos.length - 1} more` : ''}
        {unacked.length > 0 ? ` (${unacked.length} awaiting acknowledgement)` : ' (all acknowledged)'}
      </span>
      <Link to={activeSos.length === 1 && activeSos[0].incident ? `/admin/incidents/${activeSos[0].incident._id || activeSos[0].incident}` : '/admin/incidents?type=sos&active=1'} className="btn btn--sm sos-banner__btn">Respond</Link>
    </div>
  );
}

/** Persistent notice after a tourist enters a restricted/danger zone. */
function ZoneBanner() {
  const { zoneNotice, dismissZoneNotice } = useAlerts();
  const { t } = useI18n();
  if (!zoneNotice) return null;
  return (
    <div className={`zone-banner${zoneNotice.danger ? ' zone-banner--danger' : ''}`} role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <span>{zoneNotice.danger ? t('shell.zone.enterDanger', { zone: zoneNotice.name }) : t('shell.zone.enter', { zone: zoneNotice.name })}</span>
      <button type="button" className="icon-btn" onClick={dismissZoneNotice} aria-label={t('shell.zone.dismiss')}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function ShellInner() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const role = user.role;
  const { t } = useI18n();
  const items = NAV[role];
  const text = (item) => (item.labelKey ? t(item.labelKey) : item.label);
  const [menuOpen, setMenuOpen] = useState(false);

  // Mobile tab bar: items flagged `mobile` (admin: 4 + "More"), or all of them (tourist: 5).
  const flagged = items.filter((i) => i.mobile);
  const tabs = flagged.length ? flagged : items;
  const hasMore = flagged.length > 0 && flagged.length < items.length;

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

  const linkClass = ({ isActive }) => 'app-link' + (isActive ? ' app-link--active' : '');

  return (
    <div className={`app app--${role}`}>
      <a href="#main" className="skip-link">Skip to content</a>

      {menuOpen && <div className="app-overlay" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <aside className={`app-sidebar${menuOpen ? ' app-sidebar--open' : ''}`} id="app-sidebar" aria-label="Navigation">
        <div className="app-brand">
          <Link to={ROLE_HOME[role]} className="app-brand__link">
            <span className="app-brand__logo"><ShieldCheck size={18} aria-hidden="true" /></span>
            <span>{ROLE_TITLE[role]}</span>
          </Link>
          <button type="button" className="icon-btn app-sidebar__close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav className="app-nav" aria-label={role === 'admin' ? 'Admin' : 'Main'}>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} onClick={() => setMenuOpen(false)}>
              <item.icon size={18} aria-hidden="true" />
              {text(item)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="app-col">
        <header className="app-topbar">
          <button
            type="button"
            className="icon-btn app-topbar__menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link to={ROLE_HOME[role]} className="app-topbar__brand">{ROLE_TITLE[role]}</Link>
          <div className="app-topbar__tools">
            {role === 'tourist' && <LanguageSwitcher />}
            <SyncStatus />
            <ConnectionStatus />
            <AlertBell />
            <ThemeToggle />
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>

        <SosBanner role={role} />
        <ZoneBanner />

        <main className="app-main" id="main" tabIndex={-1}>
          <div key={pathname} className="page-transition"><Outlet /></div>
        </main>
      </div>

      <nav className="app-bottom" aria-label="Main (mobile)" style={{ '--tabs': tabs.length + (hasMore ? 1 : 0) }}>
        {tabs.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => 'app-tab' + (isActive ? ' app-tab--active' : '') + (item.sos ? ' app-tab--sos' : '')}
          >
            <span className="app-tab__icon"><item.icon size={item.sos ? 22 : 20} aria-hidden="true" /></span>
            <span>{text(item)}</span>
          </NavLink>
        ))}
        {hasMore && (
          <button type="button" className="app-tab" onClick={() => setMenuOpen(true)} aria-label="More pages" aria-expanded={menuOpen} aria-controls="app-sidebar">
            <span className="app-tab__icon"><MoreHorizontal size={20} aria-hidden="true" /></span>
            <span>More</span>
          </button>
        )}
      </nav>
    </div>
  );
}

/** The one layout for both roles. Route guards (ProtectedRoute) stay in App.jsx. */
function AppShell() {
  const { user } = useAuth();
  const shell = (
    <AlertsProvider>
      <ShellInner />
    </AlertsProvider>
  );
  // Tourists' phones report their GPS app-wide while signed in (unmounts on logout).
  // The tourist area also gets i18n (English / हिन्दी / मराठी); the admin area stays English.
  return user?.role === 'tourist' ? (
    <I18nProvider>
      <LocationSharingProvider>{shell}</LocationSharingProvider>
    </I18nProvider>
  ) : shell;
}

export default AppShell;
