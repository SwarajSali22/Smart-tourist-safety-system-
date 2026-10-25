import { Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './shared/auth/AuthContext.jsx';
import { ThemeProvider } from './shared/theme/ThemeContext.jsx';
import { ToastProvider } from './shared/components/ui/Toast.jsx';
import ProtectedRoute  from './shared/components/ProtectedRoute.jsx';
import AppShell        from './shared/layouts/AppShell.jsx';

import Login            from './pages/Login.jsx';
import Register         from './pages/Register.jsx';
import NotFound         from './pages/NotFound.jsx';

import AdminHome         from './features/admin/AdminHome.jsx';
import TouristDirectory  from './features/admin/TouristDirectory.jsx';
import Devices           from './features/admin/Devices.jsx';
import Zones             from './features/admin/Zones.jsx';
import Incidents         from './features/admin/Incidents.jsx';
import AdminMap          from './features/admin/AdminMap.jsx';
import Analytics         from './features/admin/Analytics.jsx';
import Blockchain        from './features/admin/Blockchain.jsx';
import IncidentDetail    from './features/admin/IncidentDetail.jsx';
import NotificationsPage from './features/shared/NotificationsPage.jsx';
import ResponderHome     from './features/responder/ResponderHome.jsx';
import TouristDetail     from './features/admin/TouristDetail.jsx';
import Team              from './features/admin/Team.jsx';
import HelpCenters       from './features/admin/HelpCenters.jsx';
import Trips             from './features/admin/Trips.jsx';
import SystemHealth      from './features/admin/SystemHealth.jsx';
import Copilot           from './features/copilot/Copilot.jsx';

import TouristHome       from './features/tourist/TouristHome.jsx';
import TouristProfile    from './features/tourist/TouristProfile.jsx';
import TouristMap        from './features/tourist/TouristMap.jsx';
import TouristSOS        from './features/tourist/TouristSOS.jsx';
import TouristChecks     from './features/tourist/TouristChecks.jsx';
import TouristTrips      from './features/tourist/TouristTrips.jsx';

import './App.css';
import './styles/screens.css';
import './styles/features.css';
import './styles/motion.css';
import './styles/redesign.css';
import './styles/responsive.css';

function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/"         element={<Login />} />
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Admin — requires role=admin */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index            element={<AdminHome />} />
          <Route path="tourists"  element={<TouristDirectory />} />
          <Route path="tourists/:id" element={<TouristDetail />} />
          <Route path="team" element={<Team />} />
          <Route path="help-centers" element={<HelpCenters />} />
          <Route path="trips" element={<Trips />} />
          <Route path="devices"   element={<Devices />} />
          <Route path="zones"     element={<Zones />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="incidents/:id" element={<IncidentDetail />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="map"       element={<AdminMap />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="blockchain" element={<Blockchain />} />
          <Route path="health" element={<SystemHealth />} />
          <Route path="copilot" element={<Copilot />} />
        </Route>

        {/* Responder — only the incidents assigned to them */}
        <Route
          path="/responder"
          element={
            <ProtectedRoute role="responder">
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<ResponderHome />} />
          <Route path="incidents/:id" element={<IncidentDetail />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        {/* Tourist — requires role=tourist */}
        <Route
          path="/tourist"
          element={
            <ProtectedRoute role="tourist">
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index           element={<TouristHome />} />
          <Route path="profile"  element={<TouristProfile />} />
          <Route path="map"      element={<TouristMap />} />
          <Route path="sos"      element={<TouristSOS />} />
          <Route path="checks"   element={<TouristChecks />} />
          <Route path="trips"    element={<TouristTrips />} />
          <Route path="copilot"  element={<Copilot />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
