import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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

export default function Settings() {
  const navigate = useNavigate();
  const [vad,  setVad]  = useState(() => localStorage.getItem('masar_vad')        ?? 'medium');
  const [tech, setTech] = useState(() => localStorage.getItem('masar_tech_level') ?? 'Professional');

  const saveVad  = v => { setVad(v);  localStorage.setItem('masar_vad', v); };
  const saveTech = v => { setTech(v); localStorage.setItem('masar_tech_level', v); };

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
        <span style={{ color: 'var(--masar-amber)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Settings</span>
      </div>

      <div style={{ flex: 1, padding: '2rem 1.5rem', maxWidth: 480, margin: '0 auto', width: '100%' }}>

        <section style={{ marginBottom: '2.5rem' }}>
          <p style={{ fontFamily: 'Cairo, sans-serif', direction: 'rtl', textAlign: 'right', color: 'var(--masar-muted)', fontSize: '0.8rem', letterSpacing: '0.04em', marginBottom: '1rem' }}>
            حساسية الميكروفون
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {VAD_OPTIONS.map(o => (
              <button key={o.value} onClick={() => saveVad(o.value)} style={optionStyle(vad === o.value)}>{o.ar}</button>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: '2.5rem' }}>
          <p style={{ fontFamily: 'Cairo, sans-serif', direction: 'rtl', textAlign: 'right', color: 'var(--masar-muted)', fontSize: '0.8rem', letterSpacing: '0.04em', marginBottom: '1rem' }}>
            مستوى التفاصيل
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {TECH_OPTIONS.map(o => (
              <button key={o.value} onClick={() => saveTech(o.value)} style={optionStyle(tech === o.value)}>{o.ar}</button>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
