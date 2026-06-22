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
      .catch((err) => {
        console.warn('[DIAGRAM] render failed:', err.message);
        const errorEl = document.getElementById(id);
        if (errorEl) errorEl.remove();
        if (containerRef.current) containerRef.current.innerHTML = '';
      });
  }, [diagramCode]);

  const handleDownload = () => {
    try {
      const svgElement = containerRef.current?.querySelector('svg');
      if (!svgElement) return;

      let svgStr = new XMLSerializer().serializeToString(svgElement);
      svgStr = svgStr.replace(/<br>/g, '<br/>');

      // Strip external font references that taint the canvas
      svgStr = svgStr.replace(/@import[^;]+;/g, '');
      svgStr = svgStr.replace(/url\(['"]?https?:\/\/[^)]+\)/g, '');

      // Resolve dimensions — fall back to viewBox when width is "100%"
      let w = svgElement.width?.baseVal?.value;
      let h = svgElement.height?.baseVal?.value;
      if (!w || !h) {
        const vb = svgElement.getAttribute('viewBox');
        if (vb) {
          const parts = vb.split(' ');
          w = parseFloat(parts[2]);
          h = parseFloat(parts[3]);
        }
      }
      if (!w) w = 800;
      if (!h) h = 600;

      // Encode as base64 data URI to avoid canvas taint
      const svgBase64 = btoa(unescape(encodeURIComponent(svgStr)));
      const url = 'data:image/svg+xml;base64,' + svgBase64;
      const img = new Image();

      img.onload = () => {
        const scale = 2;
        const pad = 40;
        const canvas = document.createElement('canvas');
        canvas.width  = w * scale + pad * 2;
        canvas.height = h * scale + pad * 2;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0D1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, pad, pad, w * scale, h * scale);

        canvas.toBlob((blob) => {
          const pngUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = 'masar-diagram.png';
          a.click();
          URL.revokeObjectURL(pngUrl);
        }, 'image/png');
      };

      img.onerror = () => {
        console.warn('[DIAGRAM] PNG export failed — img load error');
      };

      img.crossOrigin = 'anonymous';
      img.src = url;
    } catch (err) {
      console.warn('[DIAGRAM] PNG export failed:', err.message);
    }
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
            تحميل صورة المخطط ↓
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
