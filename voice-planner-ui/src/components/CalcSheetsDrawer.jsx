import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import CalcSheetPanel from './CalcSheetPanel';

export default function CalcSheetsDrawer({ open, onClose }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!open) { setSelected(null); return; }
    setLoading(true);
    (async () => {
      try {
        const { data: turns, error: turnsErr } = await supabase
          .from('turns')
          .select('id, calc_json, created_at, session_id')
          .not('calc_json', 'is', null)
          .order('created_at', { ascending: false });
        if (turnsErr) { console.warn('[CalcSheetsDrawer] turns query error:', turnsErr.message); setItems([]); return; }
        console.log('[CalcSheetsDrawer] query returned', turns?.length ?? 0, 'items');
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
        console.warn('[CalcSheetsDrawer] fetch:', e.message);
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

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
          }}>جداول الحسابات</span>
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid var(--masar-border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--masar-muted)',
            width: 28, height: 28, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.875rem',
          }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
          {loading ? (
            <p style={{
              fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem',
              color: 'var(--masar-muted)', textAlign: 'center', paddingTop: '3rem',
            }}>جاري التحميل...</p>
          ) : items.length === 0 ? (
            <p style={{
              fontFamily: 'Cairo, sans-serif', fontSize: '0.9rem',
              color: 'var(--masar-muted)', textAlign: 'center',
              paddingTop: '3rem', direction: 'rtl',
            }}>لسه مفيش جداول</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {items.map(item => {
                const cj = item.calc_json ?? {};
                const sectionCount = cj.sections?.length ?? 0;
                let rowCount = 0;
                (cj.sections ?? []).forEach(s => { rowCount += s.calculations?.length ?? 0; });
                return (
                  <div key={item.id} onClick={() => setSelected(item)} style={{
                    background: 'var(--masar-surface, #0D1117)',
                    border: '1px solid var(--masar-border)',
                    borderRadius: 10, padding: '0.75rem 1rem',
                    cursor: 'pointer', transition: 'border-color 200ms',
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(245,158,11,0.5)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--masar-border)'}
                  >
                    <p style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.8125rem',
                      color: 'var(--masar-amber)', margin: 0,
                    }}>{cj.title ?? 'Calculation Sheet'}</p>
                    <p style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
                      color: '#CBD5E1', margin: '0.25rem 0 0',
                    }}>
                      {item.session_title ?? 'Untitled'} · {new Date(item.created_at).toLocaleDateString('en-GB')}
                    </p>
                    <p style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
                      color: 'var(--masar-muted)', margin: '0.25rem 0 0',
                    }}>
                      {sectionCount} sections · {rowCount} parameters
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <CalcSheetPanel
          data={selected.calc_json}
          onClose={() => setSelected(null)}
          turnId={selected.id}
        />
      )}
    </>
  );
}
