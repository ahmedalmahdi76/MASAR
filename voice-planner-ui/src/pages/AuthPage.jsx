import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

function translateError(error) {
  const msg = error?.message?.toLowerCase() ?? '';
  if (msg.includes('invalid login') || msg.includes('invalid credentials'))
    return 'الإيميل أو كلمة المرور غلط';
  if (msg.includes('already registered') || msg.includes('already in use') || msg.includes('already exists'))
    return 'الإيميل ده مسجل قبل كده';
  if (msg.includes('password') && (msg.includes('6') || msg.includes('weak')))
    return 'كلمة المرور لازم تكون ٦ حروف على الأقل';
  if (msg.includes('invalid email') || msg.includes('valid email'))
    return 'الإيميل مش صح';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed'))
    return 'في مشكلة في الاتصال، حاول تاني';
  if (msg.includes('email not confirmed'))
    return 'لازم تأكد الإيميل الأول';
  return 'حصل خطأ، حاول تاني';
}

export default function AuthPage() {
  const navigate = useNavigate();
  const [mode,         setMode]         = useState('signin');
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [authError,    setAuthError]    = useState('');

  // Forgot password
  const [forgotMode,   setForgotMode]   = useState(false);
  const [resetEmail,   setResetEmail]   = useState('');
  const [resetMsg,     setResetMsg]     = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const handleGuest = () => {
    localStorage.setItem('masar_guest', 'true');
    navigate('/services');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) { setAuthError(translateError(error)); return; }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setAuthError(translateError(error)); return; }
      }
      navigate('/services');
    } catch {
      setAuthError('في مشكلة في الاتصال، حاول تاني');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setAuthError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/services' },
    });
    if (error) setAuthError(translateError(error));
  };

  const handleGitHub = async () => {
    setAuthError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin + '/services' },
    });
    if (error) setAuthError(translateError(error));
  };

  const handleForgotPassword = async () => {
    setResetMsg('');
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail || email, {
        redirectTo: window.location.origin + '/reset-password',
      });
      if (error) setResetMsg(translateError(error));
      else setResetMsg('تم إرسال رابط إعادة تعيين كلمة المرور على إيميلك');
    } catch {
      setResetMsg('في مشكلة في الاتصال، حاول تاني');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', padding: '2rem',
    }}>
      <div className="grid-bg" />

      <div className="page-enter" style={{ position: 'relative', zIndex: 5, width: '100%', maxWidth: '420px' }}>

        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <span className="heading-md" style={{ fontFamily: 'var(--font-display)' }}>
            Masar <span style={{ color: 'var(--masar-amber)', fontFamily: 'Cairo, sans-serif' }}>مسار</span>
          </span>
        </div>

        <div style={{
          background: 'var(--masar-surface)',
          border: '1px solid var(--masar-border)',
          borderRadius: 'var(--radius-xl)',
          padding: '2rem',
        }}>

          {/* Tab toggle */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            background: 'var(--masar-elevated)',
            borderRadius: 'var(--radius-md)', padding: '3px',
            marginBottom: '1.75rem',
          }}>
            {['signin', 'signup'].map(m => (
              <button key={m}
                onClick={() => { setMode(m); setAuthError(''); setForgotMode(false); setResetMsg(''); }}
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

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>

            {mode === 'signup' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <AuthInput placeholder="First name" />
                <AuthInput placeholder="Last name" />
              </div>
            )}

            <AuthInput
              placeholder="Email address" type="email"
              value={email} onChange={e => setEmail(e.target.value)}
            />

            {/* Password with visibility toggle */}
            <PasswordField
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              showPw={showPassword}
              onToggle={() => setShowPassword(v => !v)}
            />

            {mode === 'signup' && <AuthInput placeholder="Region (e.g. Cairo)" />}

            {/* Forgot Password — signin only */}
            {mode === 'signin' && (
              forgotMode ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '0.625rem',
                  padding: '0.875rem',
                  background: 'var(--masar-elevated)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--masar-border)',
                }}>
                  <span className="mono-sm" style={{ color: 'var(--masar-muted)', fontSize: '0.7rem' }}>
                    RESET PASSWORD
                  </span>
                  <AuthInput
                    placeholder="Email address" type="email"
                    value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                  />
                  {resetMsg && (
                    <p style={{
                      fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem',
                      color: resetMsg.includes('تم') ? '#22D3EE' : '#EF4444',
                      textAlign: 'right', direction: 'rtl', margin: 0,
                    }}>
                      {resetMsg}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={resetLoading}
                      style={{
                        flex: 1, padding: '0.625rem',
                        background: 'var(--masar-amber)', border: 'none',
                        color: '#080C14', fontFamily: 'var(--font-display)',
                        fontWeight: 700, fontSize: '0.8rem',
                        borderRadius: 'var(--radius-md)',
                        cursor: resetLoading ? 'wait' : 'pointer',
                        opacity: resetLoading ? 0.7 : 1,
                      }}
                    >
                      {resetLoading ? '...' : 'Send Reset Link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setForgotMode(false); setResetMsg(''); }}
                      className="mono-sm"
                      style={{
                        padding: '0.625rem 0.875rem',
                        background: 'transparent',
                        border: '1px solid var(--masar-border)',
                        color: 'var(--masar-muted)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setForgotMode(true); setResetEmail(email); setResetMsg(''); }}
                  className="mono-sm"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--masar-muted)', cursor: 'pointer',
                    padding: '0.125rem 0', fontSize: '0.75rem',
                    textAlign: 'right', alignSelf: 'flex-end',
                    transition: 'color var(--duration-fast)',
                  }}
                  onMouseEnter={e => e.target.style.color = 'var(--masar-amber)'}
                  onMouseLeave={e => e.target.style.color = 'var(--masar-muted)'}
                >
                  Forgot Password?
                </button>
              )
            )}

            {authError && (
              <p style={{
                fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem',
                color: '#EF4444', textAlign: 'right', direction: 'rtl', margin: 0,
              }}>
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: '0.25rem',
                background: 'var(--masar-amber)', border: 'none',
                color: '#080C14', fontFamily: 'var(--font-display)',
                fontWeight: 700, fontSize: '0.9375rem', padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                cursor: loading ? 'wait' : 'pointer',
                width: '100%', opacity: loading ? 0.7 : 1,
                transition: 'opacity var(--duration-fast)',
              }}
              onMouseEnter={e => { if (!loading) e.target.style.opacity = '0.88'; }}
              onMouseLeave={e => { if (!loading) e.target.style.opacity = '1'; }}
            >
              {loading ? '...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0' }}>
            <div style={{ flex: 1, height: '1px', background: 'var(--masar-border)' }} />
            <span className="mono-sm" style={{ color: 'var(--masar-muted)' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--masar-border)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            <OAuthButton label="Continue with Google" icon="G" onClick={handleGoogle} />
            <OAuthButton label="Continue with GitHub" icon="⌥" onClick={handleGitHub} />
          </div>

          <button
            onClick={handleGuest}
            className="mono-sm"
            style={{
              marginTop: '1.25rem', width: '100%',
              background: 'transparent', border: 'none',
              color: 'var(--masar-muted)', cursor: 'pointer',
              padding: '0.5rem', transition: 'color var(--duration-fast)',
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

function PasswordField({ placeholder, value, onChange, showPw, onToggle }) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={showPw ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        style={{
          width: '100%', background: 'var(--masar-elevated)',
          border: '1px solid var(--masar-border)',
          borderRadius: 'var(--radius-md)', color: '#E2E8F0',
          fontFamily: 'var(--font-body)', fontSize: '0.9375rem',
          padding: '0.6875rem 2.75rem 0.6875rem 0.875rem',
          outline: 'none', boxSizing: 'border-box',
          transition: 'border-color var(--duration-fast)',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--masar-amber-line)'}
        onBlur={e => e.target.style.borderColor = 'var(--masar-border)'}
      />
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', right: '0.875rem', top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent', border: 'none',
          color: 'var(--masar-muted)', cursor: 'pointer',
          fontSize: '0.9rem', lineHeight: 1, padding: 0,
        }}
      >
        {showPw ? '🙈' : '👁'}
      </button>
    </div>
  );
}

function AuthInput({ placeholder, type = 'text', value, onChange }) {
  return (
    <input
      type={type} placeholder={placeholder}
      value={value} onChange={onChange}
      style={{
        width: '100%', background: 'var(--masar-elevated)',
        border: '1px solid var(--masar-border)',
        borderRadius: 'var(--radius-md)', color: '#E2E8F0',
        fontFamily: 'var(--font-body)', fontSize: '0.9375rem',
        padding: '0.6875rem 0.875rem', outline: 'none',
        transition: 'border-color var(--duration-fast)',
      }}
      onFocus={e => e.target.style.borderColor = 'var(--masar-amber-line)'}
      onBlur={e => e.target.style.borderColor = 'var(--masar-border)'}
    />
  );
}

function OAuthButton({ label, icon, onClick }) {
  return (
    <button type="button" className="mono-sm" onClick={onClick}
      style={{
        width: '100%', background: 'var(--masar-elevated)',
        border: '1px solid var(--masar-border)',
        borderRadius: 'var(--radius-md)', color: '#E2E8F0',
        padding: '0.6875rem', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '0.625rem', transition: 'border-color var(--duration-fast)',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--masar-border-mid)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--masar-border)'}
    >
      <span style={{ fontWeight: 600 }}>{icon}</span>
      {label}
    </button>
  );
}
