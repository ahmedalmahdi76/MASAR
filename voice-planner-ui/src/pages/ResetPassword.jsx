import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import Spinner from '../components/Spinner';

export default function ResetPassword() {
  const navigate = useNavigate();

  const [ready,       setReady]       = useState(false);
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [msg,         setMsg]         = useState('');
  const [success,     setSuccess]     = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => { if (event === 'PASSWORD_RECOVERY') setReady(true); }
    );
    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async () => {
    setMsg('');
    if (!newPw)              { setMsg('اكتب كلمة المرور الجديدة'); return; }
    if (newPw.length < 6)   { setMsg('كلمة المرور لازم تكون ٦ حروف على الأقل'); return; }
    if (newPw !== confirmPw) { setMsg('كلمتا المرور مش متطابقتين'); return; }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) { setMsg('حصل خطأ، حاول تاني'); return; }
      setSuccess(true);
      setMsg('تم تغيير كلمة المرور، يمكنك تسجيل الدخول الآن');
      setTimeout(() => navigate('/auth'), 2500);
    } catch {
      setMsg('في مشكلة في الاتصال، حاول تاني');
    } finally {
      setLoading(false);
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
          <p style={{
            fontFamily: 'Cairo, sans-serif', fontSize: '1rem',
            color: '#E2E8F0', textAlign: 'right', direction: 'rtl',
            marginBottom: '1.5rem', fontWeight: 600,
          }}>
            تعيين كلمة مرور جديدة
          </p>

          {!ready ? (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <p style={{
                fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem',
                color: 'var(--masar-muted)', direction: 'rtl', textAlign: 'right',
                marginBottom: '1rem',
              }}>
                جاري التحقق من الرابط...
              </p>
              <Spinner size={24} />
            </div>
          ) : success ? (
            <p style={{
              fontFamily: 'Cairo, sans-serif', fontSize: '0.9375rem',
              color: '#22D3EE', textAlign: 'right', direction: 'rtl',
              lineHeight: 1.7, margin: 0,
            }}>
              {msg}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <PwField
                placeholder="كلمة المرور الجديدة"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                show={showNew}
                onToggle={() => setShowNew(v => !v)}
              />
              <PwField
                placeholder="تأكيد كلمة المرور"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                show={showConfirm}
                onToggle={() => setShowConfirm(v => !v)}
              />

              {msg && (
                <p style={{
                  fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem',
                  color: '#EF4444', textAlign: 'right', direction: 'rtl',
                  margin: 0,
                }}>
                  {msg}
                </p>
              )}

              <button
                onClick={handleReset}
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
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '0.5rem',
                }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88'; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = '1'; }}
              >
                {loading ? <><Spinner size={14} /> جاري التغيير...</> : 'تعيين كلمة المرور'}
              </button>
            </div>
          )}

          <button
            onClick={() => navigate('/auth')}
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
            ← العودة لتسجيل الدخول
          </button>
        </div>
      </div>
    </div>
  );
}

function PwField({ placeholder, value, onChange, show, onToggle }) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        style={{
          width: '100%', background: 'var(--masar-elevated)',
          border: '1px solid var(--masar-border)',
          borderRadius: 'var(--radius-md)', color: '#E2E8F0',
          fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem',
          padding: '0.6875rem 2.75rem 0.6875rem 0.875rem',
          outline: 'none', boxSizing: 'border-box',
          direction: 'rtl', textAlign: 'right',
          transition: 'border-color var(--duration-fast)',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--masar-amber-line)'}
        onBlur={e => e.target.style.borderColor = 'var(--masar-border)'}
      />
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', left: '0.875rem', top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent', border: 'none',
          color: 'var(--masar-muted)', cursor: 'pointer',
          fontSize: '0.9rem', lineHeight: 1, padding: 0,
        }}
      >
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}
