import { Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider } from './shared/auth/AuthContext.jsx';
import { ThemeProvider } from './shared/theme/ThemeContext.jsx';
import { ToastProvider } from './shared/components/ui/Toast.jsx';
import ProtectedRoute  from './shared/components/ProtectedRoute.jsx';
import AppShell        from './shared/layouts/AppShell.jsx';

import Home             from './pages/Home.jsx';
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

import TouristHome       from './features/tourist/TouristHome.jsx';
import TouristProfile    from './features/tourist/TouristProfile.jsx';
import TouristMap        from './features/tourist/TouristMap.jsx';
import TouristSOS        from './features/tourist/TouristSOS.jsx';
import TouristChecks     from './features/tourist/TouristChecks.jsx';

import './App.css';

function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/"         element={<Home />} />
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
          <Route path="devices"   element={<Devices />} />
          <Route path="zones"     element={<Zones />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="map"       element={<AdminMap />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="blockchain" element={<Blockchain />} />
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
