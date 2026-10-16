import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Home, LogOut, MapPin, Siren, User, X, TriangleAlert } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { tokens } from '../../api/client.js';
import { connectSocket } from '../socket/socket.js';
import { ThemeToggle } from '../theme/ThemeContext.jsx';
import { useToast } from './ui/Toast.jsx';
import { label, RISK_RANK } from '../utils/format.js';

const NAV_ITEMS = [
  { to: '/tourist',          label: 'Home',      icon: Home, end: true },
  { to: '/tourist/map',      label: 'Map',       icon: MapPin },
  { to: '/tourist/sos',      label: 'SOS',       icon: Siren },
  { to: '/tourist/checks',   label: 'Check-ins', icon: ClipboardCheck },
  { to: '/tourist/profile',  label: 'Profile',   icon: User },
];

/**
 * App-wide live safety notices for tourists, regardless of the page they're on:
 * entering a restricted/danger zone, a new check-in, SOS progress, rising risk.
 */
function useTouristAlerts(setZoneNotice) {
  const toast = useToast();

  useEffect(() => {
    const socket = connectSocket(tokens.getAccess());
    let lastRank = 0;

    function onViolation(p) {
      const name = p.zone?.name || 'a restricted area';
      const danger = p.zone?.type === 'danger';
      setZoneNotice({ name, danger });
      toast[danger ? 'danger' : 'warning'](`You have entered ${name}. ${danger ? 'This is a danger zone — move to safety.' : 'Please check the area rules.'}`, { title: 'Zone alert' });
    }
    function onPrompt() { toast.info('Please open Check-ins and tell us you are safe.', { title: 'Safety check-in', duration: 10000 }); }
    function onSos(sos) {
      if (sos?.status === 'acknowledged') toast.success('An admin has acknowledged your SOS and is responding.', { title: 'Help is on the way' });
      if (sos?.status === 'resolved') toast.success('Your SOS has been marked resolved.', { title: 'SOS resolved' });
    }
    function onRisk(r) {
      const rank = RISK_RANK[r.level];
      if (rank >= RISK_RANK.high && rank > lastRank) {
        toast.warning(`Your risk level is now ${label(r.level)}. Stay alert and consider moving to a safer area.`, { title: 'Risk rising' });
      }
      lastRank = rank;
    }

    socket.on('geofence:violation', onViolation);
    socket.on('safetycheck:prompt', onPrompt);
    socket.on('sos:updated', onSos);
    socket.on('risk:updated', onRisk);
    return () => {
      socket.off('geofence:violation', onViolation);
      socket.off('safetycheck:prompt', onPrompt);
      socket.off('sos:updated', onSos);
      socket.off('risk:updated', onRisk);
    };
  }, [toast, setZoneNotice]);
}

function TouristLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [zoneNotice, setZoneNotice] = useState(null);

  useTouristAlerts(setZoneNotice);
  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="tourist-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <span className="topbar__brand"><MapPin size={16} aria-hidden="true" /> Smart Tourist Safety</span>
        <nav className="topbar__nav" aria-label="Main">
          {NAV_ITEMS.map(({ to, label: text, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => 'topbar__link' + (isActive ? ' topbar__link--active' : '')}
            >
              <Icon size={16} aria-hidden="true" />
              {text}
            </NavLink>
          ))}
        </nav>
        <div className="topbar__right">
          <span className="topbar__user">{user?.name}</span>
          <ThemeToggle />
          <button className="btn btn--ghost btn--sm" onClick={handleLogout} aria-label="Log out">
            <LogOut size={14} aria-hidden="true" /> <span className="hide-sm">Logout</span>
          </button>
        </div>
      </header>

      {zoneNotice && (
        <div className={`zone-banner${zoneNotice.danger ? ' zone-banner--danger' : ''}`} role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <span>You entered <strong>{zoneNotice.name}</strong>{zoneNotice.danger ? ' — a danger zone. Move to safety or press SOS.' : '.'}</span>
          <button type="button" className="icon-btn" onClick={() => setZoneNotice(null)} aria-label="Dismiss zone alert">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <main className="tourist-shell__main" id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Main (mobile)">
        {NAV_ITEMS.map(({ to, label: text, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => 'bottom-nav__link' + (isActive ? ' bottom-nav__link--active' : '') + (to === '/tourist/sos' ? ' bottom-nav__link--sos' : '')}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{text}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default TouristLayout;
