import { useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

function exportCSV(data) {
  const header = 'Parameter,Symbol,Value,Unit,Formula,Standard';
  const rows = [];
  (data.sections ?? []).forEach(section => {
    rows.push(`\n# ${section.name}`);
    (section.calculations ?? []).forEach(c => {
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      rows.push([esc(c.parameter), esc(c.symbol), esc(c.value), esc(c.unit), esc(c.formula), esc(c.standard)].join(','));
    });
  });
  const csv = header + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `MASAR-Calculations-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildSheetHTML(data) {
  const sectionBlocks = (data.sections ?? []).map(section => {
    const rows = (section.calculations ?? []).map((c, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9f9f9' : '#ffffff'}">
        <td style="padding:7px 10px;font-size:11px;color:#111;">${c.parameter ?? ''}</td>
        <td style="padding:7px 10px;font-size:11px;font-family:'Courier New',monospace;color:#0891B2;text-align:center;">${c.symbol ?? ''}</td>
        <td style="padding:7px 10px;font-size:11px;font-family:'Courier New',monospace;font-weight:700;color:#111;text-align:right;">${c.value ?? ''}</td>
        <td style="padding:7px 10px;font-size:11px;color:#555;text-align:center;">${c.unit ?? ''}</td>
        <td style="padding:7px 10px;font-size:10px;font-family:'Courier New',monospace;color:#555;">${c.formula ?? ''}</td>
        <td style="padding:7px 10px;font-size:10px;color:#888;">${c.standard ?? ''}</td>
      </tr>`).join('');

    return `
      <div style="margin-bottom:20px;">
        <div style="background:#F59E0B;color:#111;padding:5px 10px;font-size:11px;font-weight:700;font-family:Arial,sans-serif;letter-spacing:0.5px;text-transform:uppercase;">
          ${section.name}
        </div>
        <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;">
          <thead>
            <tr style="background:#f0f0f0;">
              <th style="padding:6px 10px;font-size:10px;text-align:left;border-bottom:1px solid #ddd;color:#555;">Parameter</th>
              <th style="padding:6px 10px;font-size:10px;text-align:center;border-bottom:1px solid #ddd;color:#555;">Symbol</th>
              <th style="padding:6px 10px;font-size:10px;text-align:right;border-bottom:1px solid #ddd;color:#555;">Value</th>
              <th style="padding:6px 10px;font-size:10px;text-align:center;border-bottom:1px solid #ddd;color:#555;">Unit</th>
              <th style="padding:6px 10px;font-size:10px;text-align:left;border-bottom:1px solid #ddd;color:#555;">Formula</th>
              <th style="padding:6px 10px;font-size:10px;text-align:left;border-bottom:1px solid #ddd;color:#555;">Standard</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  return `
    <div style="background:#fff;padding:40px 48px;font-family:Arial,Helvetica,sans-serif;color:#111;width:760px;box-sizing:border-box;">
      <div style="border-bottom:2px solid #F59E0B;padding-bottom:12px;margin-bottom:16px;">
        <p style="font-size:9px;font-family:'Courier New',monospace;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">MASAR — Engineering Calculation Sheet</p>
        <h1 style="font-size:20px;font-weight:700;margin:0 0 4px;color:#111;">${data.title ?? 'Calculation Sheet'}</h1>
        <p style="font-size:11px;color:#555;margin:0;">${data.service ?? ''}</p>
      </div>
      ${data.summary ? `<p style="font-size:11px;color:#555;margin:0 0 20px;padding:10px 14px;background:#FFF8E7;border-left:3px solid #F59E0B;">${data.summary}</p>` : ''}
      ${sectionBlocks}
      <div style="border-top:1px solid #ddd;margin-top:24px;padding-top:8px;display:flex;justify-content:space-between;font-size:8px;color:#aaa;">
        <span>MASAR — Confidential Engineering Report</span>
        <span>Generated: ${new Date().toLocaleString('en-GB')}</span>
      </div>
    </div>`;
}

async function exportPDF(data) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
  container.innerHTML = buildSheetHTML(data);
  document.body.appendChild(container);
  try {
    await document.fonts.ready;
    const canvas = await html2canvas(container.firstElementChild, {
      scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
    });
    const imgData     = canvas.toDataURL('image/png');
    const pdf         = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pdfW        = pdf.internal.pageSize.getWidth();
    const pdfH        = pdf.internal.pageSize.getHeight();
    const imgHeightMm = (canvas.height / canvas.width) * pdfW;
    const numPages    = Math.ceil(imgHeightMm / pdfH);
    for (let p = 0; p < numPages; p++) {
      if (p > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, -p * pdfH, pdfW, imgHeightMm);
      pdf.setFontSize(7); pdf.setTextColor(160, 160, 160);
      pdf.text('MASAR — Engineering Calculation Sheet', 10, pdfH - 5);
      pdf.text(`Page ${p + 1} of ${numPages}`, pdfW - 10, pdfH - 5, { align: 'right' });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    pdf.save(`MASAR-Calculations-${stamp}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

export default function CalcSheetPanel({ data, onClose }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const COL_WIDTHS = ['28%', '8%', '10%', '10%', '26%', '18%'];
  const COL_HEADS  = ['Parameter', 'Symbol', 'Value', 'Unit', 'Formula', 'Standard'];
  const COL_ALIGN  = ['left', 'center', 'right', 'center', 'left', 'left'];
  const COL_MONO   = [false, true, true, false, true, true];

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position:   'fixed',
        inset:       0,
        zIndex:      9999,
        background: 'rgba(0,0,0,0.65)',
        display:    'flex',
        alignItems:  'center',
        justifyContent: 'center',
        padding:    '1rem',
      }}
    >
      <div style={{
        width:      'min(720px, 95vw)',
        maxHeight:  '82vh',
        overflowY:  'auto',
        background: 'var(--masar-surface)',
        border:     '1px solid rgba(245,158,11,0.30)',
        borderRadius: 16,
        boxShadow:  '0 24px 64px rgba(0,0,0,0.5)',
        display:    'flex',
        flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{
          padding:      '1.125rem 1.375rem 0.875rem',
          borderBottom: '1px solid var(--masar-border)',
          display:      'flex',
          alignItems:   'flex-start',
          justifyContent: 'space-between',
          flexShrink:   0,
          gap:          '1rem',
        }}>
          <div>
            <p style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      '0.625rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color:         'var(--masar-amber)',
              margin:        '0 0 0.3rem',
            }}>
              Engineering Calculation Sheet
            </p>
            <h2 style={{
              fontFamily:    'Syne, sans-serif',
              fontSize:      '1.0625rem',
              fontWeight:    700,
              color:         '#E2E8F0',
              margin:        '0 0 0.2rem',
              lineHeight:    1.3,
            }}>
              {data.title ?? 'Calculation Sheet'}
            </h2>
            {data.summary && (
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize:   '0.725rem',
                color:      'var(--masar-muted)',
                margin:     0,
                lineHeight: 1.5,
              }}>
                {data.summary}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border:     '1px solid var(--masar-border)',
              borderRadius: 8,
              color:      'var(--masar-muted)',
              width:      28, height: 28,
              cursor:     'pointer',
              fontSize:   '1rem',
              lineHeight: 1,
              flexShrink: 0,
              display:    'flex',
              alignItems:  'center',
              justifyContent: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#E2E8F0'; e.currentTarget.style.borderColor = 'var(--masar-border-mid)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--masar-muted)'; e.currentTarget.style.borderColor = 'var(--masar-border)'; }}
          >
            ×
          </button>
        </div>

        {/* Body — sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.375rem' }}>
          {(data.sections ?? []).length === 0 && (
            <p style={{ fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem', color: 'var(--masar-muted)', direction: 'rtl', textAlign: 'right' }}>
              لم يتم العثور على قيم قابلة للحساب في هذا الحل.
            </p>
          )}

          {(data.sections ?? []).map((section, si) => (
            <div key={si} style={{ marginBottom: '1.25rem' }}>
              {/* Section header */}
              <div style={{
                fontFamily:    'var(--font-mono)',
                fontSize:      '0.6875rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color:         'var(--masar-amber)',
                borderBottom:  '1px solid rgba(245,158,11,0.25)',
                paddingBottom: '0.375rem',
                marginBottom:  '0.5rem',
              }}>
                {section.name}
              </div>

              {/* Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width:           '100%',
                  borderCollapse:  'collapse',
                  fontSize:        '0.8rem',
                  tableLayout:     'fixed',
                }}>
                  <colgroup>
                    {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      {COL_HEADS.map((h, i) => (
                        <th key={i} style={{
                          padding:       '0.375rem 0.5rem',
                          textAlign:      COL_ALIGN[i],
                          fontFamily:    'var(--font-mono)',
                          fontSize:      '0.625rem',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color:         'var(--masar-muted)',
                          borderBottom:  '1px solid var(--masar-border)',
                          fontWeight:    400,
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(section.calculations ?? []).map((c, ci) => (
                      <tr
                        key={ci}
                        style={{ background: ci % 2 === 0 ? 'transparent' : 'var(--masar-elevated)' }}
                      >
                        {[c.parameter, c.symbol, c.value, c.unit, c.formula, c.standard].map((val, fi) => (
                          <td key={fi} style={{
                            padding:    '0.45rem 0.5rem',
                            textAlign:   COL_ALIGN[fi],
                            fontFamily: COL_MONO[fi] ? 'var(--font-mono)' : 'inherit',
                            fontSize:   fi === 0 ? '0.8125rem' : '0.775rem',
                            color:      fi === 2
                              ? 'var(--masar-amber)'     // value column — amber
                              : fi === 1
                                ? 'var(--masar-cyan)'    // symbol — cyan
                                : '#CBD5E1',
                            borderBottom: '1px solid rgba(30,45,69,0.5)',
                            whiteSpace:  fi >= 4 ? 'normal' : 'nowrap',
                            overflow:    fi >= 4 ? 'visible' : 'hidden',
                            textOverflow: fi >= 4 ? 'unset' : 'ellipsis',
                            wordBreak:   fi >= 4 ? 'break-word' : 'normal',
                          }}>
                            {val ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding:     '0.875rem 1.375rem',
          borderTop:   '1px solid var(--masar-border)',
          display:     'flex',
          gap:         '0.625rem',
          justifyContent: 'flex-end',
          flexShrink:  0,
        }}>
          {/* CSV */}
          <button
            onClick={() => exportCSV(data)}
            style={{
              background:   'transparent',
              border:       '1px solid rgba(245,158,11,0.35)',
              borderRadius:  8,
              color:        'var(--masar-amber)',
              fontFamily:   'Cairo, sans-serif',
              fontSize:     '0.875rem',
              padding:      '0.4rem 0.9rem',
              cursor:       'pointer',
              transition:   'background 150ms',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,158,11,0.10)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            تحميل CSV
          </button>

          {/* PDF */}
          <button
            onClick={() => exportPDF(data)}
            style={{
              background:   'rgba(245,158,11,0.12)',
              border:       '1px solid rgba(245,158,11,0.45)',
              borderRadius:  8,
              color:        'var(--masar-amber)',
              fontFamily:   'Cairo, sans-serif',
              fontSize:     '0.875rem',
              fontWeight:   600,
              padding:      '0.4rem 0.9rem',
              cursor:       'pointer',
              transition:   'background 150ms',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,158,11,0.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(245,158,11,0.12)'}
          >
            تحميل PDF
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            style={{
              background:   'transparent',
              border:       '1px solid rgba(226,232,240,0.15)',
              borderRadius:  8,
              color:        'rgba(148,163,184,0.75)',
              fontFamily:   'Cairo, sans-serif',
              fontSize:     '0.875rem',
              padding:      '0.4rem 0.9rem',
              cursor:       'pointer',
              transition:   'border-color 150ms, color 150ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(226,232,240,0.35)'; e.currentTarget.style.color = '#E2E8F0'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(226,232,240,0.15)'; e.currentTarget.style.color = 'rgba(148,163,184,0.75)'; }}
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
