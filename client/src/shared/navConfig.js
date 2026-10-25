import {
  Activity, BarChart3, Sparkles, CalendarClock, ClipboardCheck, ClipboardList, Home, LayoutDashboard, LifeBuoy, Link2, MapPin, Radar, Shapes, Siren, User, Users, UsersRound, Watch,
} from 'lucide-react';

/**
 * One navigation source for the whole app. AppShell picks NAV[user.role].
 *  - `mobile: true`  → shown in the mobile bottom tab bar (max 5 incl. "More").
 *    If no item is flagged, all items are shown (tourist has exactly 5).
 *  - `labelKey`      → i18n key (tourist area); `label` is the English fallback.
 */
export const NAV = {
  admin: [
    { to: '/admin',            label: 'Dashboard',    icon: LayoutDashboard, end: true, mobile: true },
    { to: '/admin/map',        label: 'Live map',     icon: Radar,           mobile: true },
    { to: '/admin/incidents',  label: 'Incidents',    icon: Siren,           mobile: true },
    { to: '/admin/tourists',   label: 'Tourists',     icon: Users,           mobile: true },
    { to: '/admin/zones',      label: 'Zones',        icon: Shapes },
    { to: '/admin/devices',    label: 'Devices',      icon: Watch },
    { to: '/admin/trips',      label: 'Trips',        icon: CalendarClock },
    { to: '/admin/analytics',  label: 'Analytics',    icon: BarChart3 },
    { to: '/admin/blockchain', label: 'Audit proofs', icon: Link2 },
    { to: '/admin/help-centers', label: 'Help centers', icon: LifeBuoy },
    { to: '/admin/groups',     label: 'Tour groups',  icon: Users },
    { to: '/admin/team',       label: 'Team',         icon: UsersRound },
    { to: '/admin/health',     label: 'System health', icon: Activity },
    { to: '/admin/copilot',    label: 'AI Copilot',   icon: Sparkles },
  ],
  // Responders see only the incidents assigned to them (the server enforces this).
  responder: [
    { to: '/responder', label: 'My assignments', icon: ClipboardList, end: true },
  ],
  // Order matters: SOS sits in the centre slot of the 5-item mobile tab bar.
  tourist: [
    { to: '/tourist',          label: 'Home',      labelKey: 'nav.home',    icon: Home, end: true, mobile: true },
    { to: '/tourist/map',      label: 'Map',       labelKey: 'nav.map',     icon: MapPin, mobile: true },
    { to: '/tourist/sos',      label: 'SOS',       labelKey: 'nav.sos',     icon: Siren, sos: true, mobile: true },
    { to: '/tourist/checks',   label: 'Check-ins', labelKey: 'nav.checks',  icon: ClipboardCheck, mobile: true },
    { to: '/tourist/trips',    label: 'Trips',     icon: CalendarClock },
    { to: '/tourist/copilot',  label: 'AI Copilot', labelKey: 'nav.copilot', icon: Sparkles },
    { to: '/tourist/profile',  label: 'Profile',   labelKey: 'nav.profile', icon: User, mobile: true },
  ],
};

export const ROLE_HOME = { admin: '/admin', tourist: '/tourist', responder: '/responder' };
export const ROLE_TITLE = { admin: 'STS Admin', tourist: 'Smart Tourist Safety', responder: 'STS Responder' };
