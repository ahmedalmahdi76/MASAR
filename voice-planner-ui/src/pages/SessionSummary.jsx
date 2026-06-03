import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { exportSessionPDF } from '../utils/generatePDF';

/*
 * STAGE 5 — Session Summary
 * Reads real session data passed from Workspace via router state.
 * Falls back to an empty state if navigated to directly.
 */

function formatDuration(startTime) {
  const secs = Math.round((Date.now() - startTime) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}m ${s}s`;
}

function sessionId(startTime) {
  const d = new Date(startTime);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const n = String(d.getTime()).slice(-3);
  return `MSR-${yy}${mm}${dd}-${n}`;
}

export default function SessionSummary() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const state     = location.state ?? {};

  const {
    turns         = [],
    masarResponses = {},
    solutions      = {},
    service        = { label: 'Unknown', id: 'fiber' },
    techLevel      = 'Professional',
    startTime      = Date.now(),
  } = state;

  // Only turns that have actual text
  const filledTurns = turns.filter(t => t.text);
  const duration    = startTime ? Math.floor((Date.now() - startTime) / 1000) : null;
  const [pdfLoading, setPdfLoading] = useState(false);

  const handleExportPDF = async () => {
    setPdfLoading(true);
    try {
      await exportSessionPDF({ turns: filledTurns, masarResponses, solutions, service, techLevel, startTime, duration });
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('حصل خطأ في تصدير الـ PDF، حاول تاني');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', position: 'relative', padding: '0 2rem 4rem' }}>
      <div className="grid-bg" />

      {/* Header */}
      <header style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1.25rem 0',
        borderBottom: '1px solid var(--masar-border)',
        marginBottom: '2.5rem',
      }}>
        <span className="heading-md" style={{ fontFamily: 'var(--font-display)' }}>
          Masar <span style={{ color: 'var(--masar-amber)', fontFamily: 'Cairo, sans-serif' }}>مسار</span>
        </span>
        <button
          onClick={() => navigate('/services')}
          style={{
            background: 'var(--masar-amber)',
            border: 'none',
            color: '#080C14',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '0.875rem',
            padding: '0.5rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            transition: 'opacity var(--duration-fast)',
          }}
          onMouseEnter={e => e.target.style.opacity = '0.88'}
          onMouseLeave={e => e.target.style.opacity = '1'}
        >
          + Start New Session
        </button>
      </header>

      <div className="page-enter" style={{ position: 'relative', zIndex: 5, maxWidth: '760px', margin: '0 auto' }}>

        {/* Title */}
        <p className="mono-sm text-amber" style={{ marginBottom: '0.5rem' }}>◈ Session Report</p>
        <h1 className="display-lg" style={{ marginBottom: '2rem' }}>Technical Brief</h1>

        {/* Meta strip */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0.75rem',
          marginBottom: '2rem',
        }}>
          {[
            { label: 'Session ID',  value: sessionId(startTime) },
            { label: 'Duration',    value: formatDuration(startTime) },
            { label: 'Tech Level',  value: techLevel },
            { label: 'Service',     value: service.label },
          ].map(m => (
            <div key={m.label} style={{
              background: 'var(--masar-surface)',
              border: '1px solid var(--masar-border)',
              borderRadius: 'var(--radius-md)',
              padding: '0.875rem',
            }}>
              <p className="mono-sm text-muted" style={{ marginBottom: '0.25rem' }}>{m.label}</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: '#E2E8F0' }}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* No turns fallback */}
        {filledTurns.length === 0 && (
          <div style={{
            background: 'var(--masar-surface)', border: '1px solid var(--masar-border)',
            borderRadius: 'var(--radius-lg)', padding: '2rem', textAlign: 'center',
          }}>
            <p className="mono-sm" style={{ color: 'var(--masar-muted)' }}>No speech recorded in this session.</p>
          </div>
        )}

        {/* One section per turn */}
        {filledTurns.map((turn, i) => (
          <div key={turn.id} style={{ marginBottom: '2rem' }}>
            {filledTurns.length > 1 && (
              <p className="mono-sm" style={{ color: 'var(--masar-muted)', marginBottom: '0.5rem' }}>
                Turn {i + 1} · {turn.time}
              </p>
            )}

            <SummarySection label="Raw Transcript (Egyptian Arabic)" color="var(--masar-amber)">
              <p style={{ fontFamily: 'var(--font-body)', direction: 'rtl', textAlign: 'right', lineHeight: 1.8, color: '#CBD5E1' }}>
                {turn.text || <em style={{ color: 'var(--masar-muted)' }}>No transcript</em>}
              </p>
            </SummarySection>

            <SummarySection
              label={service.id === 'general' ? 'Masar (Cleaned)' : 'Refined Engineering Prompt'}
              color="var(--masar-cyan)"
            >
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', lineHeight: 1.7, color: '#CBD5E1', whiteSpace: 'pre-wrap' }}>
                {masarResponses[turn.id] || <em style={{ color: 'var(--masar-muted)' }}>Not generated</em>}
              </p>
            </SummarySection>

            {solutions[turn.id] !== undefined && (
              <SummarySection
                label={service.id === 'general' ? 'Response' : 'Network Planning Solution'}
                color="var(--masar-success)"
              >
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', lineHeight: 1.7, color: '#CBD5E1', whiteSpace: 'pre-wrap' }}>
                  {solutions[turn.id] || <em style={{ color: 'var(--masar-muted)' }}>Empty</em>}
                </p>
              </SummarySection>
            )}
          </div>
        ))}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
          <button
            className="mono-sm"
            onClick={() => {
              const text = filledTurns.map((t, i) => [
                `--- Turn ${i + 1} ---`,
                `Transcript: ${t.text}`,
                `Refined: ${masarResponses[t.id] ?? 'N/A'}`,
                solutions[t.id] !== undefined ? `Solution: ${solutions[t.id]}` : null,
              ].filter(Boolean).join('\n')).join('\n\n');
              navigator.clipboard.writeText(text);
            }}
            style={{
              background: 'var(--masar-surface)',
              border: '1px solid var(--masar-border)',
              color: 'var(--masar-muted)',
              padding: '0.625rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Copy to Clipboard
          </button>

          <button
            onClick={handleExportPDF}
            disabled={pdfLoading || filledTurns.length === 0}
            style={{
              background: pdfLoading ? 'rgba(245,158,11,0.06)' : 'rgba(245,158,11,0.10)',
              border: '1px solid rgba(245,158,11,0.45)',
              color: 'var(--masar-amber)',
              fontFamily: 'Cairo, sans-serif',
              fontSize: '0.9rem',
              padding: '0.625rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              cursor: pdfLoading || filledTurns.length === 0 ? 'not-allowed' : 'pointer',
              opacity: filledTurns.length === 0 ? 0.45 : 1,
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              transition: 'background 200ms',
            }}
            onMouseEnter={e => { if (!pdfLoading) e.currentTarget.style.background = 'rgba(245,158,11,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = pdfLoading ? 'rgba(245,158,11,0.06)' : 'rgba(245,158,11,0.10)'; }}
          >
            {pdfLoading ? 'جاري التصدير...' : '📄 تصدير PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummarySection({ label, color, children }) {
  return (
    <div style={{
      background: 'var(--masar-surface)',
      border: '1px solid var(--masar-border)',
      borderLeft: `3px solid ${color}`,
      borderRadius: 'var(--radius-lg)',
      padding: '1.25rem 1.5rem',
      marginBottom: '1rem',
    }}>
      <p className="mono-sm" style={{ color, marginBottom: '0.75rem' }}>{label}</p>
      {children}
    </div>
  );
}
