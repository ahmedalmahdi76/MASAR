import { useState, useEffect } from 'react';

const ARABIC = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
const toAr = n => String(n).split('').map(d => ARABIC[+d]).join('');

const TOOLTIP_W  = 288;
const TOOLTIP_H  = 190; // conservative estimate for clamping
const GAP        = 14;

function computePos(rect, position) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top, left;

  switch (position) {
    case 'top':
      top  = rect.top - TOOLTIP_H - GAP;
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
      break;
    case 'left':
      top  = rect.top + rect.height / 2 - TOOLTIP_H / 2;
      left = rect.left - TOOLTIP_W - GAP;
      break;
    case 'right':
      top  = rect.top + rect.height / 2 - TOOLTIP_H / 2;
      left = rect.right + GAP;
      break;
    case 'bottom':
    default:
      top  = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
      break;
  }

  // Clamp to viewport with 12px margin
  left = Math.max(12, Math.min(left, vw - TOOLTIP_W - 12));
  top  = Math.max(12, Math.min(top,  vh - TOOLTIP_H - 12));
  return { top, left };
}

export default function OnboardingTour({ steps, onComplete, onSkip }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [rect,    setRect]    = useState(null);
  const [ttPos,   setTtPos]   = useState({ top: 0, left: 0 });

  const step   = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  // Measure target element whenever step changes
  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => {
      if (!step.targetId) {
        setRect(null);
      } else {
        const el = document.getElementById(step.targetId);
        if (el) {
          const r = el.getBoundingClientRect();
          setRect(r);
          setTtPos(computePos(r, step.position));
        } else {
          setRect(null);
        }
      }
      setVisible(true);
    }, 120);
    return () => clearTimeout(t);
  }, [stepIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  function advance() {
    setVisible(false);
    setTimeout(() => {
      if (isLast) onComplete();
      else setStepIdx(i => i + 1);
    }, 200);
  }

  function skip() {
    setVisible(false);
    setTimeout(onSkip, 200);
  }

  const overlayStyle = {
    opacity:    visible ? 1 : 0,
    transition: 'opacity 200ms ease',
  };

  const tooltipStyle = {
    opacity:   visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(8px)',
    transition: 'opacity 250ms ease, transform 250ms ease',
    pointerEvents: 'auto',
    position: rect ? 'absolute' : 'fixed',
    ...(rect
      ? { top: ttPos.top, left: ttPos.left }
      : { top: '50%', left: '50%', transform: visible ? 'translate(-50%,-50%)' : 'translate(-50%,-42%)' }
    ),
    width:        TOOLTIP_W,
    background:   'var(--masar-surface)',
    border:       '1px solid var(--masar-border)',
    borderRadius: 12,
    padding:      '1.25rem',
    boxShadow:    '0 16px 48px rgba(0,0,0,0.5)',
    zIndex:       2,
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>

      {/* ── Spotlight or full overlay ── */}
      {rect ? (
        <div style={{
          position:     'absolute',
          top:          rect.top    - 5,
          left:         rect.left   - 5,
          width:        rect.width  + 10,
          height:       rect.height + 10,
          borderRadius: 10,
          boxShadow:    '0 0 0 9999px rgba(0,0,0,0.75)',
          ...overlayStyle,
        }} />
      ) : (
        <div style={{
          position:   'absolute', inset: 0,
          background: 'rgba(0,0,0,0.75)',
          pointerEvents: 'auto',
          ...overlayStyle,
        }} />
      )}

      {/* ── Tooltip card ── */}
      <div style={tooltipStyle}>

        {/* Step counter */}
        <p style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize:   '0.6875rem',
          color:      'var(--masar-muted)',
          textAlign:  'right',
          margin:     '0 0 0.5rem 0',
          letterSpacing: '0.04em',
        }}>
          {toAr(stepIdx + 1)} من {toAr(steps.length)}
        </p>

        {/* Title */}
        <p style={{
          fontFamily: 'Cairo, sans-serif',
          fontWeight: 700,
          fontSize:   '0.9375rem',
          color:      'var(--masar-amber)',
          direction:  'rtl',
          textAlign:  'right',
          margin:     '0 0 0.5rem 0',
          lineHeight: 1.4,
        }}>
          {step.title}
        </p>

        {/* Description */}
        <p style={{
          fontFamily: 'Cairo, sans-serif',
          fontSize:   '0.875rem',
          color:      'var(--masar-muted)',
          direction:  'rtl',
          textAlign:  'right',
          lineHeight: 1.75,
          margin:     '0 0 1.125rem 0',
        }}>
          {step.description}
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={skip}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--masar-muted)',
              fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem',
              cursor: 'pointer', padding: '0.25rem 0',
              transition: 'color 150ms',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#E2E8F0'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--masar-muted)'}
          >
            تخطي
          </button>

          <button
            onClick={advance}
            style={{
              background:   'rgba(245,158,11,0.12)',
              border:       '1px solid rgba(245,158,11,0.40)',
              borderRadius: 8,
              color:        'var(--masar-amber)',
              fontFamily:   'Cairo, sans-serif',
              fontSize:     '0.875rem',
              fontWeight:   600,
              padding:      '0.4375rem 1rem',
              cursor:       'pointer',
              transition:   'background 150ms, border-color 150ms',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background    = 'rgba(245,158,11,0.20)';
              e.currentTarget.style.borderColor   = 'rgba(245,158,11,0.65)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background    = 'rgba(245,158,11,0.12)';
              e.currentTarget.style.borderColor   = 'rgba(245,158,11,0.40)';
            }}
          >
            {isLast ? 'ابدأ دلوقتي ✓' : 'التالي ←'}
          </button>
        </div>

      </div>
    </div>
  );
}
