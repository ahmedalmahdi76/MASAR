import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/*
 * STAGE 2 — Authentication
 * Build order:
 *   [x] Scaffold with design tokens
 *   [x] Sign in / Sign up tab toggle
 *   [x] Guest entry (sets masar_guest flag → bypasses auth)
 *   [ ] Form validation
 *   [ ] OAuth buttons (Google / GitHub) — UI only for now
 *   [ ] Region selector dropdown
 *   [ ] Wire to Zustand auth store
 */

export default function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'

  const handleGuest = () => {
    localStorage.setItem('masar_guest', 'true');
    navigate('/services');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    /* TODO: real auth — for now just pass through */
    localStorage.setItem('masar_token', 'mock_token');
    navigate('/services');
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      padding: '2rem',
    }}>
      <div className="grid-bg" />

      <div className="page-enter" style={{
        position: 'relative',
        zIndex: 5,
        width: '100%',
        maxWidth: '420px',
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <span className="heading-md" style={{ fontFamily: 'var(--font-display)' }}>
            Masar <span style={{ color: 'var(--masar-amber)' , fontFamily: 'Cairo, sans-serif' }}>مسار</span>
          </span>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--masar-surface)',
          border: '1px solid var(--masar-border)',
          borderRadius: 'var(--radius-xl)',
          padding: '2rem',
        }}>

          {/* Tab Toggle */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: 'var(--masar-elevated)',
            borderRadius: 'var(--radius-md)',
            padding: '3px',
            marginBottom: '1.75rem',
          }}>
            {['signin', 'signup'].map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="mono-sm"
                style={{
                  background: mode === m ? 'var(--masar-border-mid)' : 'transparent',
                  border: 'none',
                  color: mode === m ? '#E2E8F0' : 'var(--masar-muted)',
                  padding: '0.5rem',
                  borderRadius: 'calc(var(--radius-md) - 2px)',
                  cursor: 'pointer',
                  transition: 'all var(--duration-base)',
                }}
              >
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          {/* Form — PLACEHOLDER fields, wire in Step 3 */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

            {mode === 'signup' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <AuthInput placeholder="First name" />
                <AuthInput placeholder="Last name" />
              </div>
            )}

            <AuthInput placeholder="Email address" type="email" />
            <AuthInput placeholder="Password" type="password" />

            {mode === 'signup' && (
              <AuthInput placeholder="Region (e.g. Cairo)" />
            )}

            <button
              type="submit"
              style={{
                marginTop: '0.25rem',
                background: 'var(--masar-amber)',
                border: 'none',
                color: '#080C14',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '0.9375rem',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                width: '100%',
                transition: 'opacity var(--duration-fast)',
              }}
              onMouseEnter={e => e.target.style.opacity = '0.88'}
              onMouseLeave={e => e.target.style.opacity = '1'}
            >
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            margin: '1.25rem 0',
          }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--masar-border)' }} />
            <span className="mono-sm" style={{ color: 'var(--masar-muted)' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--masar-border)' }} />
          </div>

          {/* OAuth — UI only */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            <OAuthButton label="Continue with Google" icon="G" />
            <OAuthButton label="Continue with GitHub" icon="⌥" />
          </div>

          {/* Guest */}
          <button
            onClick={handleGuest}
            className="mono-sm"
            style={{
              marginTop: '1.25rem',
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--masar-muted)',
              cursor: 'pointer',
              padding: '0.5rem',
              transition: 'color var(--duration-fast)',
            }}
            onMouseEnter={e => e.target.style.color = 'var(--masar-amber)'}
            onMouseLeave={e => e.target.style.color = 'var(--masar-muted)'}
          >
            Join as Guest →
          </button>

        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function AuthInput({ placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      style={{
        width: '100%',
        background: 'var(--masar-elevated)',
        border: '1px solid var(--masar-border)',
        borderRadius: 'var(--radius-md)',
        color: '#E2E8F0',
        fontFamily: 'var(--font-body)',
        fontSize: '0.9375rem',
        padding: '0.6875rem 0.875rem',
        outline: 'none',
        transition: 'border-color var(--duration-fast)',
      }}
      onFocus={e => e.target.style.borderColor = 'var(--masar-amber-line)'}
      onBlur={e => e.target.style.borderColor = 'var(--masar-border)'}
    />
  );
}

function OAuthButton({ label, icon }) {
  return (
    <button
      type="button"
      className="mono-sm"
      style={{
        width: '100%',
        background: 'var(--masar-elevated)',
        border: '1px solid var(--masar-border)',
        borderRadius: 'var(--radius-md)',
        color: '#E2E8F0',
        padding: '0.6875rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.625rem',
        transition: 'border-color var(--duration-fast)',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--masar-border-mid)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--masar-border)'}
    >
      <span style={{ fontWeight: 600 }}>{icon}</span>
      {label}
    </button>
  );
}
