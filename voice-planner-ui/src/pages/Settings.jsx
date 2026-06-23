import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import Spinner from '../components/Spinner';
import ThemeToggle from '../components/ThemeToggle';

const VAD_OPTIONS = [
  { value: 'low',          ar: 'منخفض' },
  { value: 'medium',       ar: 'متوسط' },
  { value: 'high',         ar: 'عالي'  },
];
const TECH_OPTIONS = [
  { value: 'Beginner',     ar: 'مبتدئ' },
  { value: 'Professional', ar: 'محترف' },
  { value: 'Expert',       ar: 'خبير'  },
];

const arLabel = {
  fontFamily: 'Cairo, sans-serif', direction: 'rtl',
  textAlign: 'right', color: 'var(--masar-muted)',
  fontSize: '0.8rem', letterSpacing: '0.04em', marginBottom: '1rem',
};

export default function Settings() {
  const navigate = useNavigate();
  const [vad,  setVad]  = useState(() => localStorage.getItem('masar_vad')        ?? 'medium');
  const [tech, setTech] = useState(() => localStorage.getItem('masar_tech_level') ?? 'Professional');
  const [bargeIn, setBargeIn] = useState(() => (localStorage.getItem('masar_bargein') ?? 'true') === 'true');

  // Account
  const [user,          setUser]          = useState(undefined);
  const [currentPw,     setCurrentPw]     = useState('');
  const [newPw,         setNewPw]         = useState('');
  const [confirmPw,     setConfirmPw]     = useState('');
  const [showCurPw,     setShowCurPw]     = useState(false);
  const [showNewPw,     setShowNewPw]     = useState(false);
  const [showConPw,     setShowConPw]     = useState(false);
  const [pwMsg,         setPwMsg]         = useState('');
  const [pwLoading,     setPwLoading]     = useState(false);
  const [signoutLoading,setSignoutLoading]= useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));
  }, []);

  const isGuest     = user === null && !!localStorage.getItem('masar_guest');
  const provider    = user?.app_metadata?.provider ?? 'email';
  const isEmailUser = provider === 'email';

  const saveVad  = v => { setVad(v);  localStorage.setItem('masar_vad', v); };
  const saveTech = v => { setTech(v); localStorage.setItem('masar_tech_level', v); };
  const saveBargeIn = v => { setBargeIn(v); localStorage.setItem('masar_bargein', String(v)); };

  const handleChangePassword = async () => {
    setPwMsg('');
    if (!currentPw)          { setPwMsg('اكتب كلمة المرور الحالية الأول'); return; }
    if (newPw !== confirmPw) { setPwMsg('كلمة المرور الجديدة مش متطابقة'); return; }
    if (newPw.length < 6)    { setPwMsg('كلمة المرور لازم تكون ٦ حروف على الأقل'); return; }
    setPwLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email, password: currentPw,
      });
      if (verifyError) { setPwMsg('كلمة المرور الحالية غلط'); return; }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPw });
      if (updateError) { setPwMsg('حصل خطأ، حاول تاني'); return; }
      setPwMsg('تم تغيير كلمة المرور بنجاح');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch {
      setPwMsg('في مشكلة في الاتصال، حاول تاني');
    } finally {
      setPwLoading(false);
    }
  };

  const handleSignOut = async () => {
    setSignoutLoading(true);
    await supabase.auth.signOut();
    localStorage.removeItem('masar_guest');
    localStorage.removeItem('masar_token');
    navigate('/auth');
  };

  const optionStyle = (active) => ({
    flex: 1, padding: '0.625rem 0',
    borderRadius: 'var(--radius-md)',
    border: active ? '1px solid rgba(245,158,11,0.5)' : '1px solid var(--masar-border)',
    background: active ? 'rgba(245,158,11,0.1)' : 'var(--masar-surface)',
    color: active ? 'var(--masar-amber)' : 'var(--masar-muted)',
    fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer', transition: 'all var(--duration-base)',
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--masar-bg)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.5rem', borderBottom: '1px solid var(--masar-border)' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'transparent', border: '1px solid var(--masar-border)', color: 'var(--masar-muted)', borderRadius: 'var(--radius-md)', padding: '0.375rem 0.75rem', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
          ← Back
        </button>
        <span style={{ color: 'var(--masar-amber)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', flex: 1 }}>Settings</span>
        <ThemeToggle />
      </div>

      <div className="page-enter" style={{ flex: 1, padding: '2rem 1.5rem', maxWidth: 480, margin: '0 auto', width: '100%' }}>

        {/* Account info — real users only */}
        {user && !isGuest && (
          <section className="settings-section" style={{ marginBottom: '2.5rem' }}>
            <p style={arLabel}>معلومات الحساب</p>
            <div style={{ background: 'var(--masar-surface)', border: '1px solid var(--masar-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <InfoRow label="الإيميل" value={user.email} />
              <InfoRow label="تاريخ الإنشاء" value={new Date(user.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })} />
              <InfoRow label="طريقة الدخول" value={provider === 'google' ? 'Google' : provider === 'github' ? 'GitHub' : 'إيميل'} last />
            </div>
          </section>
        )}

        {/* VAD */}
        <section className="settings-section" style={{ marginBottom: '2.5rem' }}>
          <p style={arLabel}>حساسية الميكروفون</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {VAD_OPTIONS.map(o => (
              <button key={o.value} onClick={() => saveVad(o.value)} style={optionStyle(vad === o.value)}>{o.ar}</button>
            ))}
          </div>
        </section>

        {/* Tech level */}
        <section className="settings-section" style={{ marginBottom: '2.5rem' }}>
          <p style={arLabel}>مستوى التفاصيل</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {TECH_OPTIONS.map(o => (
              <button key={o.value} onClick={() => saveTech(o.value)} style={optionStyle(tech === o.value)}>{o.ar}</button>
            ))}
          </div>
        </section>

        {/* Barge-in */}
        <section className="settings-section" style={{ marginBottom: '2.5rem' }}>
          <p style={arLabel}>المقاطعة أثناء الكلام</p>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--masar-surface)', border: '1px solid var(--masar-border)',
            borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem',
          }}>
            <label style={{
              position: 'relative', display: 'inline-block',
              width: 44, height: 24, flexShrink: 0, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={bargeIn} onChange={e => saveBargeIn(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }} />
              <span style={{
                position: 'absolute', inset: 0, borderRadius: 12,
                background: bargeIn ? 'rgba(245,158,11,0.5)' : 'rgba(100,116,139,0.3)',
                transition: 'background 200ms',
              }} />
              <span style={{
                position: 'absolute', top: 2, left: bargeIn ? 22 : 2,
                width: 20, height: 20, borderRadius: '50%',
                background: bargeIn ? '#F59E0B' : '#64748B',
                transition: 'left 200ms, background 200ms',
              }} />
            </label>
            <p style={{
              fontFamily: 'Cairo, sans-serif', fontSize: '0.8125rem',
              color: 'var(--masar-muted)', direction: 'rtl', textAlign: 'right',
              margin: 0, flex: 1, paddingRight: '0.75rem',
            }}>
              لو مفعّل، تقدر تقاطع مسار وهو بيتكلم بإنك تتكلم. لو مقفول، مسار هيكمل كلامه لحد ما يخلص.
            </p>
          </div>
        </section>

        {/* Change password — email users only */}
        {user && isEmailUser && !isGuest && (
          <section className="settings-section" style={{ marginBottom: '2.5rem' }}>
            <p style={arLabel}>تغيير كلمة المرور</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <PwField placeholder="كلمة المرور الحالية"    value={currentPw} onChange={e => setCurrentPw(e.target.value)} show={showCurPw} onToggle={() => setShowCurPw(v => !v)} />
              <PwField placeholder="كلمة المرور الجديدة"   value={newPw}     onChange={e => setNewPw(e.target.value)}     show={showNewPw} onToggle={() => setShowNewPw(v => !v)} />
              <PwField placeholder="تأكيد كلمة المرور"     value={confirmPw} onChange={e => setConfirmPw(e.target.value)} show={showConPw} onToggle={() => setShowConPw(v => !v)} />
              {pwMsg && (
                <p style={{ fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem', color: pwMsg.includes('بنجاح') ? '#22D3EE' : '#EF4444', textAlign: 'right', direction: 'rtl', margin: 0 }}>
                  {pwMsg}
                </p>
              )}
              <button
                onClick={handleChangePassword}
                disabled={pwLoading}
                style={{ width: '100%', padding: '0.75rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 'var(--radius-md)', color: 'var(--masar-amber)', fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem', cursor: pwLoading ? 'wait' : 'pointer', opacity: pwLoading ? 0.7 : 1, transition: 'opacity var(--duration-fast)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {pwLoading ? <><Spinner size={14} /> جاري التغيير...</> : 'تغيير كلمة المرور'}
              </button>
            </div>
          </section>
        )}

        {/* Tour replay */}
        <section className="settings-section" style={{ marginBottom: '2.5rem' }}>
          <p style={arLabel}>الجولة التعريفية</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            <button
              onClick={() => { localStorage.removeItem('masar_tour_services'); navigate('/services'); }}
              style={{ width: '100%', padding: '0.75rem', background: 'rgba(34,211,238,0.07)', border: '1px solid rgba(34,211,238,0.35)', borderRadius: 'var(--radius-md)', color: '#22D3EE', fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem', cursor: 'pointer', transition: 'border-color var(--duration-base), background var(--duration-base)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,211,238,0.13)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.65)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,211,238,0.07)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.35)'; }}
            >
              إعادة جولة اختيار الخدمة
            </button>
            <button
              onClick={() => { localStorage.removeItem('masar_tour_workspace'); navigate(-1); }}
              style={{ width: '100%', padding: '0.75rem', background: 'rgba(34,211,238,0.07)', border: '1px solid rgba(34,211,238,0.35)', borderRadius: 'var(--radius-md)', color: '#22D3EE', fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem', cursor: 'pointer', transition: 'border-color var(--duration-base), background var(--duration-base)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,211,238,0.13)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.65)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,211,238,0.07)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.35)'; }}
            >
              إعادة جولة مساحة العمل
            </button>
          </div>
        </section>

        {/* Sign out / Create account */}
        <section className="settings-section">
          {isGuest ? (
            <button
              onClick={() => navigate('/auth')}
              style={{ width: '100%', padding: '0.75rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 'var(--radius-md)', color: 'var(--masar-amber)', fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem', cursor: 'pointer', transition: 'border-color var(--duration-base), background var(--duration-base)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.18)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.8)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.1)';  e.currentTarget.style.borderColor = 'rgba(245,158,11,0.5)'; }}
            >
              إنشاء حساب
            </button>
          ) : (
            <button
              onClick={handleSignOut}
              disabled={signoutLoading}
              style={{ width: '100%', padding: '0.75rem', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 'var(--radius-md)', color: '#EF4444', fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem', cursor: signoutLoading ? 'wait' : 'pointer', opacity: signoutLoading ? 0.7 : 1, transition: 'border-color var(--duration-base), background var(--duration-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              onMouseEnter={e => { if (!signoutLoading) { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.7)'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; }}
            >
              {signoutLoading ? <><Spinner size={14} /> جاري الخروج...</> : 'تسجيل الخروج'}
            </button>
          )}
        </section>

      </div>
    </div>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.625rem 1rem', borderBottom: last ? 'none' : '1px solid var(--masar-border)' }}>
      <span style={{ fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem', color: '#E2E8F0' }}>{value}</span>
      <span style={{ fontFamily: 'Cairo, sans-serif', fontSize: '0.8rem',   color: 'var(--masar-muted)' }}>{label}</span>
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
