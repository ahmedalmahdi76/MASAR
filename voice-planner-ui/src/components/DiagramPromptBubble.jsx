import { useEffect, useRef } from 'react';

const COUNTDOWN_S = 10;

export default function DiagramPromptBubble({ visible, onAccept, onDismiss }) {
  const bubbleRef   = useRef(null);
  const onDismissRef = useRef(onDismiss);
  // Keep ref current so the effect never needs onDismiss in its deps
  useEffect(() => { onDismissRef.current = onDismiss; });
  useEffect(() => {
    console.log('[BUBBLE] visible:', visible, 'has onAccept:', !!onAccept);
  }, [visible, onAccept]);

  // Auto-dismiss timer + Escape + click-outside
  // Depends only on `visible` — not on onDismiss — so it never re-runs mid-click
  useEffect(() => {
    if (!visible) return;

    const timer = setTimeout(() => onDismissRef.current(), COUNTDOWN_S * 1000);

    function onKey(e) {
      if (e.key === 'Escape') onDismissRef.current();
    }
    function onMouseDown(e) {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target)) onDismissRef.current();
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <style>{`
        @keyframes masar-countdown {
          from { width: 100%; }
          to   { width: 0%; }
        }
        @keyframes masar-bubble-in {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        ref={bubbleRef}
        style={{
          position:       'fixed',
          bottom:         '2rem',
          right:          '2rem',
          zIndex:         9998,
          width:          300,
          background:     'rgba(8,12,20,0.90)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border:         '1px solid rgba(34,211,238,0.3)',
          borderRadius:   16,
          padding:        '1rem 1.25rem 0',
          boxShadow:      '0 8px 32px rgba(0,0,0,0.4)',
          opacity:        visible ? 1 : 0,
          pointerEvents:  visible ? 'auto' : 'none',
          animation:      visible ? `masar-bubble-in 280ms ease forwards` : 'none',
          overflow:       'hidden',
        }}
      >
        {/* Label */}
        <p style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      '0.625rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color:         'var(--masar-cyan)',
          margin:        '0 0 0.5rem 0',
        }}>
          مخطط شبكي
        </p>

        {/* Question */}
        <p style={{
          fontFamily: 'Cairo, sans-serif',
          fontSize:   '0.9375rem',
          direction:  'rtl',
          textAlign:  'right',
          color:      '#E2E8F0',
          lineHeight: 1.75,
          margin:     '0 0 1rem 0',
        }}>
          عايز تشوف المخطط الشبكي للحل ده؟
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginBottom: '0.875rem' }}>
          <button
            onClick={onDismiss}
            style={{
              background:   'transparent',
              border:       '1px solid rgba(226,232,240,0.15)',
              borderRadius: 8,
              color:        'rgba(148,163,184,0.75)',
              fontFamily:   'Cairo, sans-serif',
              fontSize:     '0.875rem',
              padding:      '0.375rem 0.875rem',
              cursor:       'pointer',
              transition:   'border-color 150ms, color 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(226,232,240,0.35)'; e.currentTarget.style.color = '#E2E8F0'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(226,232,240,0.15)'; e.currentTarget.style.color = 'rgba(148,163,184,0.75)'; }}
          >
            لأ شكراً
          </button>

          <button
            onClick={() => { console.log('[BUBBLE] accept button clicked'); onAccept(); }}
            style={{
              background:   'rgba(34,211,238,0.15)',
              border:       '1px solid rgba(34,211,238,0.45)',
              borderRadius: 8,
              color:        'var(--masar-cyan)',
              fontFamily:   'Cairo, sans-serif',
              fontSize:     '0.875rem',
              fontWeight:   600,
              padding:      '0.375rem 0.875rem',
              cursor:       'pointer',
              transition:   'background 150ms, border-color 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,211,238,0.25)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.70)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,211,238,0.15)'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.45)'; }}
          >
            اعرض المخطط ←
          </button>
        </div>

        {/* Countdown bar */}
        {visible && (
          <div style={{ height: 3, background: 'rgba(34,211,238,0.15)', borderRadius: '0 0 16px 16px', overflow: 'hidden' }}>
            <div style={{
              height:    '100%',
              background: 'var(--masar-cyan)',
              animation: `masar-countdown ${COUNTDOWN_S}s linear forwards`,
            }} />
          </div>
        )}
      </div>
    </>
  );
}
