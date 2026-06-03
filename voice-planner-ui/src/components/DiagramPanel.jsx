import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

const DARK_THEME_CONFIG = {
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor:       '#22D3EE',
    primaryTextColor:   '#E2E8F0',
    primaryBorderColor: '#22D3EE',
    lineColor:          '#64748B',
    secondaryColor:     '#1E293B',
    background:         '#080C14',
    mainBkg:            '#111827',
    nodeBorder:         '#22D3EE',
  },
};

export default function DiagramPanel({ diagramCode, loading }) {
  const containerRef = useRef(null);

  useEffect(() => {
    console.log('[DIAGRAM PANEL] received code:', diagramCode?.substring(0, 100));
    if (!diagramCode || !containerRef.current) return;
    // Always initialize with dark theme — ensures PDF export can't leave a stale light theme
    mermaid.initialize(DARK_THEME_CONFIG);
    const id = 'masar-diagram-' + Date.now();
    mermaid.render(id, diagramCode)
      .then(({ svg }) => {
        if (containerRef.current) containerRef.current.innerHTML = svg;
      })
      .catch(() => {
        if (containerRef.current) containerRef.current.innerHTML = '';
      });
  }, [diagramCode]);

  const handleDownload = () => {
    if (!containerRef.current) return;
    const svg = containerRef.current.innerHTML;
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
        <p style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      '0.6875rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color:         'var(--masar-cyan)',
          margin:        0,
        }}>
          المخطط الشبكي
        </p>

        {diagramCode && !loading && (
          <button
            onClick={handleDownload}
            style={{
              background:   'transparent',
              border:       '1px solid rgba(34,211,238,0.3)',
              borderRadius: 6,
              color:        'var(--masar-cyan)',
              fontFamily:   'Cairo, sans-serif',
              fontSize:     '0.75rem',
              padding:      '0.2rem 0.6rem',
              cursor:       'pointer',
              transition:   'background 150ms',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,211,238,0.10)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            تحميل المخطط ↓
          </button>
        )}
      </div>

      <div style={{
        background:    'var(--masar-deep, #010508)',
        border:        '1px solid rgba(34,211,238,0.2)',
        borderRadius:  12,
        padding:       '1rem',
        maxHeight:     420,
        overflowY:     'auto',
        display:       'flex',
        alignItems:    'center',
        justifyContent: loading ? 'center' : 'flex-start',
        minHeight:     80,
      }}>
        {loading ? (
          <p style={{
            fontFamily: 'Cairo, sans-serif',
            fontSize:   '0.9rem',
            direction:  'rtl',
            color:      'var(--masar-muted)',
            margin:     0,
          }}>
            جاري رسم المخطط...
          </p>
        ) : (
          <div ref={containerRef} style={{ width: '100%' }} />
        )}
      </div>
    </div>
  );
}
