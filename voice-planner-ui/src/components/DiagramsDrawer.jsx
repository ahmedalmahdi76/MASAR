import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { supabase } from '../supabase';

const DARK_THEME = {
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#22D3EE', primaryTextColor: '#E2E8F0',
    primaryBorderColor: '#22D3EE', lineColor: '#64748B',
    secondaryColor: '#1E293B', background: '#080C14',
    mainBkg: '#111827', nodeBorder: '#22D3EE',
  },
};

function exportPNG(svgElement) {
  try {
    let svgStr = new XMLSerializer().serializeToString(svgElement);
    svgStr = svgStr.replace(/<br>/g, '<br/>');
    svgStr = svgStr.replace(/@import[^;]+;/g, '');
    svgStr = svgStr.replace(/url\(['"]?https?:\/\/[^)]+\)/g, '');

    let w = svgElement.width?.baseVal?.value;
    let h = svgElement.height?.baseVal?.value;
    if (!w || !h) {
      const vb = svgElement.getAttribute('viewBox');
      if (vb) { const p = vb.split(' '); w = parseFloat(p[2]); h = parseFloat(p[3]); }
    }
    if (!w) w = 800;
    if (!h) h = 600;

    const b64 = btoa(unescape(encodeURIComponent(svgStr)));
    const url = 'data:image/svg+xml;base64,' + b64;
    const img = new Image();
    img.onload = () => {
      const scale = 2, pad = 40;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale + pad * 2;
      canvas.height = h * scale + pad * 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0D1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, pad, pad, w * scale, h * scale);
      canvas.toBlob(blob => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u; a.download = 'masar-diagram.png'; a.click();
        URL.revokeObjectURL(u);
      }, 'image/png');
    };
    img.onerror = () => console.warn('[DIAGRAM] PNG export failed');
    img.crossOrigin = 'anonymous';
    img.src = url;
  } catch (e) {
    console.warn('[DIAGRAM] PNG export failed:', e.message);
  }
}

export default function DiagramsDrawer({ open, onClose }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState(null);
  const fullRef = useRef(null);

  useEffect(() => {
    if (!open) { setSelected(null); return; }
    setLoading(true);
    (async () => {
      try {
        const { data: turns, error: turnsErr } = await supabase
          .from('turns')
          .select('id, diagram_mermaid, created_at, session_id')
          .not('diagram_mermaid', 'is', null)
          .order('created_at', { ascending: false });
        if (turnsErr) { console.warn('[DiagramsDrawer] turns query error:', turnsErr.message); setItems([]); return; }
        console.log('[DiagramsDrawer] query returned', turns?.length ?? 0, 'items');
        if (!turns || turns.length === 0) { setItems([]); return; }
        const sessionIds = [...new Set(turns.map(t => t.session_id).filter(Boolean))];
        const { data: sessions } = await supabase
          .from('sessions')
          .select('id, title')
          .in('id', sessionIds);
        const titleMap = {};
        (sessions ?? []).forEach(s => { titleMap[s.id] = s.title; });
        setItems(turns.map(t => ({ ...t, session_title: titleMap[t.session_id] ?? null })));
      } catch (e) {
        console.warn('[DiagramsDrawer] fetch:', e.message);
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!selected || !fullRef.current) return;
    mermaid.initialize(DARK_THEME);
    const id = 'drawer-full-' + Date.now();
    mermaid.render(id, selected.diagram_mermaid)
      .then(({ svg }) => { if (fullRef.current) fullRef.current.innerHTML = svg; })
      .catch(err => {
        const el = document.getElementById(id); if (el) el.remove();
        if (fullRef.current) fullRef.current.innerHTML = '';
        console.warn('[DiagramsDrawer] render:', err.message);
      });
  }, [selected]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.4)',
      }} />

      <div style={{
        position: 'fixed', top: 0, right: 0, height: '100%',
        width: 'min(500px, 92vw)',
        background: 'rgba(8,12,20,0.97)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderLeft: '1px solid var(--masar-border)',
        zIndex: 70, display: 'flex', flexDirection: 'column',
        animation: 'masar-slide-right 280ms ease forwards',
      }}>
        <style>{`
          @keyframes masar-slide-right {
            from { transform: translateX(100%); opacity: 0.5; }
            to   { transform: translateX(0);    opacity: 1; }
          }
        `}</style>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--masar-border)',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.8125rem',
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--masar-amber)',
          }}>المخططات</span>
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--masar-border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--masar-muted)',
            width: 28, height: 28, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.875rem',
          }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {selected ? (
            <div>
              <button onClick={() => setSelected(null)} style={{
                background: 'transparent', border: 'none',
                color: 'var(--masar-cyan)', fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem', cursor: 'pointer', marginBottom: '0.75rem',
              }}>← Back</button>
              <div ref={fullRef} style={{
                background: '#010508', border: '1px solid rgba(34,211,238,0.2)',
                borderRadius: 12, padding: '1rem', minHeight: 200,
              }} />
              <button onClick={() => {
                const svg = fullRef.current?.querySelector('svg');
                if (svg) exportPNG(svg);
              }} style={{
                marginTop: '0.75rem', width: '100%', padding: '0.5rem',
                background: 'rgba(34,211,238,0.08)',
                border: '1px solid rgba(34,211,238,0.3)',
                borderRadius: 8, color: 'var(--masar-cyan)',
                fontFamily: 'Cairo, sans-serif', fontSize: '0.8125rem',
                cursor: 'pointer',
              }}>تحميل صورة المخطط ↓</button>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
                color: 'var(--masar-muted)', marginTop: '0.5rem',
              }}>
                {selected.session_title ?? 'Untitled'} · {new Date(selected.created_at).toLocaleDateString('en-GB')}
              </p>
            </div>
          ) : loading ? (
            <p style={{
              fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem',
              color: 'var(--masar-muted)', textAlign: 'center', paddingTop: '3rem',
            }}>جاري التحميل...</p>
          ) : items.length === 0 ? (
            <p style={{
              fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem',
              color: 'var(--masar-muted)', textAlign: 'center',
              paddingTop: '3rem', direction: 'rtl',
            }}>لسه مفيش مخططات</p>
          ) : (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.75rem',
            }}>
              {items.map(item => (
                <ThumbCard key={item.id} item={item} onClick={() => setSelected(item)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ThumbCard({ item, onClick }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    mermaid.initialize(DARK_THEME);
    const id = 'thumb-' + item.id.toString().slice(-8) + '-' + Date.now();
    mermaid.render(id, item.diagram_mermaid)
      .then(({ svg }) => { if (ref.current) ref.current.innerHTML = svg; })
      .catch(() => {
        const el = document.getElementById(id); if (el) el.remove();
        if (ref.current) ref.current.innerHTML = '';
      });
  }, [item.diagram_mermaid, item.id]);

  return (
    <div onClick={onClick} style={{
      background: 'var(--masar-surface, #0D1117)',
      border: '1px solid var(--masar-border)',
      borderRadius: 10, overflow: 'hidden',
      cursor: 'pointer', transition: 'border-color 200ms',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(34,211,238,0.5)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--masar-border)'}
    >
      <div ref={ref} style={{
        height: 120, overflow: 'hidden', padding: '0.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }} />
      <div style={{ padding: '0.5rem 0.625rem', borderTop: '1px solid var(--masar-border)' }}>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
          color: '#CBD5E1', margin: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{item.session_title ?? 'Untitled'}</p>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
          color: 'var(--masar-muted)', margin: '0.125rem 0 0',
        }}>{new Date(item.created_at).toLocaleDateString('en-GB')}</p>
      </div>
    </div>
  );
}
