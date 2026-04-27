import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage     from './pages/LandingPage';
import AuthPage        from './pages/AuthPage';
import ServiceSelect   from './pages/ServiceSelect';
import Workspace       from './pages/Workspace';
import SessionSummary  from './pages/SessionSummary';
import Settings        from './pages/Settings';

/*
 * MASAR مسار — Router Engine
 *
 * Route Map:
 *   /                → LandingPage     (public)
 *   /auth            → AuthPage        (public)
 *   /services        → ServiceSelect   (protected — placeholder guard)
 *   /workspace       → Workspace       (protected — core cockpit)
 *   /summary         → SessionSummary  (protected — post-session)
 *   *                → redirect to /
 *
 * Auth guard is stubbed with `isAuthenticated`. Wire to Zustand
 * auth store in Phase 3, Step 3 (AuthPage build).
 */

const isAuthenticated = () => {
  return localStorage.getItem('masar_guest') === 'true'
    || localStorage.getItem('masar_token') !== null;
};

/* Protected route wrapper — swap for real auth in Step 3 */
function ProtectedRoute({ children }) {
  return isAuthenticated() ? children : <Navigate to="/auth" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* ── Public ── */}
        <Route path="/"     element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />

        {/* ── Protected ── */}
        <Route
          path="/services"
          element={
            <ProtectedRoute>
              <ServiceSelect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspace"
          element={
            <ProtectedRoute>
              <Workspace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/summary"
          element={
            <ProtectedRoute>
              <SessionSummary />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />

        {/* ── Fallback ── */}
        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </BrowserRouter>
  );
}
