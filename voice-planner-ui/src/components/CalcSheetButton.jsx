import { useEffect, useRef } from 'react';

export default function CalcSheetButton({ visible, loading, hasSheet, onClick }) {
  const btnRef = useRef(null);

  // Escape key hides the button (without triggering calc)
  useEffect(() => {
    if (!visible) return;
    function onKey(e) {
      if (e.key === 'Escape' && btnRef.current) btnRef.current.style.opacity = '0';
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  const label = loading ? 'جاري الحساب...' : hasSheet ? 'عرض الجدول ✓' : 'جدول الحسابات ↗';

  return (
    <>
      <style>{`
        @keyframes masar-calc-in {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        ref={btnRef}
        style={{
          position:      'fixed',
          bottom:        '2rem',
          left:          '2rem',
          zIndex:        9998,
          pointerEvents: visible ? 'auto' : 'none',
          opacity:       visible ? 1 : 0,
          animation:     visible ? 'masar-calc-in 280ms ease forwards' : 'none',
          transition:    'opacity 200ms ease',
        }}
      >
        <button
          onClick={onClick}
          disabled={loading}
          style={{
            display:        'flex',
            alignItems:     'center',
            gap:            '0.5rem',
            background:     loading
              ? 'rgba(245,158,11,0.08)'
              : hasSheet
                ? 'rgba(245,158,11,0.20)'
                : 'rgba(245,158,11,0.12)',
            border:         `1px solid rgba(245,158,11,${loading ? '0.25' : '0.50'})`,
            borderRadius:   12,
            padding:        '0.5rem 1rem',
            color:          loading ? 'rgba(245,158,11,0.55)' : 'var(--masar-amber)',
            fontFamily:     'Cairo, sans-serif',
            fontSize:       '0.9375rem',
            fontWeight:     600,
            direction:      'rtl',
            cursor:         loading ? 'not-allowed' : 'pointer',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow:      '0 4px 20px rgba(0,0,0,0.3)',
            transition:     'background 150ms, border-color 150ms, color 150ms',
            whiteSpace:     'nowrap',
          }}
          onMouseEnter={e => {
            if (!loading) {
              e.currentTarget.style.background = 'rgba(245,158,11,0.22)';
              e.currentTarget.style.borderColor = 'rgba(245,158,11,0.75)';
            }
          }}
          onMouseLeave={e => {
            if (!loading) {
              e.currentTarget.style.background = hasSheet
                ? 'rgba(245,158,11,0.20)'
                : 'rgba(245,158,11,0.12)';
              e.currentTarget.style.borderColor = 'rgba(245,158,11,0.50)';
            }
          }}
        >
          {loading && (
            <span style={{
              display:      'inline-block',
              width:        14,
              height:       14,
              border:       '2px solid rgba(245,158,11,0.3)',
              borderTop:    '2px solid var(--masar-amber)',
              borderRadius: '50%',
              animation:    'spin 0.7s linear infinite',
              flexShrink:   0,
            }} />
          )}
          {!loading && (
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>🧮</span>
          )}
          <span>{label}</span>
        </button>
      </div>
    </>
  );
}
