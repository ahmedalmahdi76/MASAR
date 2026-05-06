import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabase';
import { ThemeProvider } from './contexts/ThemeContext';
import Spinner from './components/Spinner';
import LandingPage    from './pages/LandingPage';
import AuthPage       from './pages/AuthPage';
import ServiceSelect  from './pages/ServiceSelect';
import Workspace      from './pages/Workspace';
import SessionSummary from './pages/SessionSummary';
import Settings       from './pages/Settings';

function ProtectedRoute({ children }) {
  const [checking, setChecking] = useState(true);
  const [allowed,  setAllowed]  = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const isGuest = localStorage.getItem('masar_guest');
      setAllowed(!!session || !!isGuest);
      setChecking(false);
    };
    check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAllowed(!!session || !!localStorage.getItem('masar_guest'));
    });

    return () => subscription.unsubscribe();
  }, []);

  if (checking) return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--masar-void)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '1.25rem',
    }}>
      <span style={{
        fontFamily: 'Syne, sans-serif', fontWeight: 700,
        fontSize: '1.25rem', color: '#E2E8F0',
        letterSpacing: '-0.01em',
      }}>
        Masar <span style={{ color: 'var(--masar-amber)', fontFamily: 'Cairo, sans-serif' }}>مسار</span>
      </span>
      <Spinner size={28} />
    </div>
  );

  return allowed ? children : <Navigate to="/auth" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"     element={<LandingPage />} />
          <Route path="/auth" element={<AuthPage />} />

          <Route path="/services"  element={<ProtectedRoute><ServiceSelect /></ProtectedRoute>} />
          <Route path="/workspace" element={<ProtectedRoute><Workspace /></ProtectedRoute>} />
          <Route path="/summary"   element={<ProtectedRoute><SessionSummary /></ProtectedRoute>} />
          <Route path="/settings"  element={<ProtectedRoute><Settings /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
