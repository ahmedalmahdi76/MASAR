import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import mermaid from 'mermaid';

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function sessionId(ts) {
  const d = new Date(ts);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `MSR-${yy}${mm}${dd}-${String(d.getTime()).slice(-3)}`;
}

function fmtDuration(secs) {
  if (!secs) return null;
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function esc(str) {
  return (str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

function buildHTML({ turns, masarResponses, solutions, service, techLevel, startTime, duration, diagramSVGs = {} }) {
  const filledTurns = turns.filter(t => t.text);
  const sid         = sessionId(startTime);
  const date        = fmtDate(startTime);
  const dur         = fmtDuration(duration);
  const abstract    = `This report documents a network planning session conducted using MASAR, an AI-powered voice assistant for telecommunications engineers. The engineer communicated in Egyptian Arabic dialect, and MASAR provided ${filledTurns.length} technical planning recommendation${filledTurns.length !== 1 ? 's' : ''} across the ${service.label} domain.`;

  const metaRows = [
    `<tr>
       <td style="padding:5px 10px;font-size:11px;width:50%;"><b>Date:</b> ${date}</td>
       <td style="padding:5px 10px;font-size:11px;"><b>Session ID:</b> ${sid}</td>
     </tr>`,
    `<tr>
       <td style="padding:5px 10px;font-size:11px;"><b>Service:</b> ${esc(service.label)}</td>
       <td style="padding:5px 10px;font-size:11px;"><b>Tech Level:</b> ${esc(techLevel)}</td>
     </tr>`,
    dur ? `<tr><td colspan="2" style="padding:5px 10px;font-size:11px;"><b>Duration:</b> ${dur}</td></tr>` : '',
  ].join('');

  const turnBlocks = filledTurns.map((t, i) => {
    const isLast    = i === filledTurns.length - 1;
    const arabic    = esc(t.text);
    const refined   = esc(masarResponses[t.id] ?? '');
    const solution  = esc(solutions[t.id] ?? '');
    const divider   = isLast ? '' : '<div style="border-top:1px dashed #ccc;margin-top:24px;"></div>';

    return `
      <div style="margin-bottom:28px;">
        <h2 style="font-size:14px;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #ddd;color:#111;">
          ${i + 1}. Engineer Query
          ${t.time ? `<span style="font-size:10px;color:#999;font-weight:400;margin-left:8px;">· ${t.time}</span>` : ''}
        </h2>

        <p style="font-size:10px;color:#888;margin:0 0 5px;text-transform:uppercase;letter-spacing:0.6px;">Original (Arabic)</p>
        <div style="font-family:'Cairo',sans-serif;direction:rtl;text-align:right;font-size:12.5px;color:#222;background:#fafafa;padding:10px 14px;border-radius:4px;margin-bottom:14px;line-height:2;border:1px solid #eee;">
          ${arabic || '<em style="color:#aaa;">No transcript</em>'}
        </div>

        <p style="font-size:10px;color:#888;margin:0 0 5px;text-transform:uppercase;letter-spacing:0.6px;">Refined Engineering Request</p>
        <div style="font-family:'Courier New',monospace;font-size:11px;color:#333;background:#f0f4f8;padding:10px 14px;border-radius:4px;margin-bottom:14px;line-height:1.75;border:1px solid #e2e8f0;">
          ${refined || '<em style="color:#aaa;">Not generated</em>'}
        </div>

        <p style="font-size:10px;color:#888;margin:0 0 5px;text-transform:uppercase;letter-spacing:0.6px;">MASAR Response</p>
        <div style="font-family:'Cairo',sans-serif;direction:rtl;text-align:right;font-size:12.5px;color:#111;background:#f8fdf8;padding:12px 14px;border-radius:4px;border-left:3px solid #555;line-height:2;">
          ${solution || '<em style="color:#aaa;">Empty</em>'}
        </div>

        ${diagramSVGs[t.id] ? `
        <p style="font-size:10px;color:#888;margin:14px 0 5px;text-transform:uppercase;letter-spacing:0.6px;">Network Diagram</p>
        <div style="border:1px solid #e2e8f0;border-radius:4px;padding:12px;background:#fafafa;overflow:hidden;">
          ${diagramSVGs[t.id]}
        </div>` : ''}

        ${divider}
      </div>`;
  }).join('');

  return `
    <div style="background:#fff;padding:48px 64px;font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;width:794px;box-sizing:border-box;">

      <!-- HEADER -->
      <div style="text-align:center;padding-bottom:18px;margin-bottom:20px;border-bottom:2px solid #111;">
        <h1 style="font-size:24px;margin:0 0 4px;letter-spacing:1px;font-family:Arial,sans-serif;">
          MASAR &mdash; <span style="font-family:'Cairo',sans-serif;">مسار</span>
        </h1>
        <p style="font-size:12px;margin:4px 0 2px;color:#444;">AI-Powered Network Planning Assistant</p>
        <p style="font-size:11px;margin:2px 0;color:#666;">MTI University &mdash; Faculty of Engineering</p>
        <p style="font-size:11px;margin:0;color:#666;">Electronics &amp; Communications Department</p>
      </div>

      <!-- META TABLE -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;background:#f9f9f9;border:1px solid #e2e8f0;border-radius:4px;">
        ${metaRows}
      </table>

      <!-- ABSTRACT -->
      <div style="margin-bottom:28px;padding:14px 18px;background:#f5f5f5;border-left:3px solid #555;">
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 7px;color:#444;">Abstract</p>
        <p style="font-size:11.5px;color:#333;margin:0;line-height:1.75;">${abstract}</p>
      </div>

      <!-- TURNS -->
      ${filledTurns.length === 0
        ? '<p style="font-size:12px;color:#999;text-align:center;padding:32px 0;">No speech recorded in this session.</p>'
        : turnBlocks}

      <!-- FOOTER -->
      <div style="border-top:1px solid #ccc;margin-top:32px;padding-top:10px;display:flex;justify-content:space-between;font-size:9px;color:#aaa;">
        <span>MASAR &mdash; Confidential Technical Report</span>
        <span>Generated: ${new Date().toLocaleString('en-GB')}</span>
      </div>

    </div>`;
}

export async function exportSessionPDF(params) {
  // Pre-render any Mermaid diagrams to SVG using a light theme for the white PDF background
  const diagramSVGs = {};
  if (params.diagrams && Object.keys(params.diagrams).length > 0) {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
    for (const [turnId, code] of Object.entries(params.diagrams)) {
      try {
        const { svg } = await mermaid.render(`pdf-diag-${turnId}`, code);
        diagramSVGs[turnId] = svg;
      } catch (e) {
        console.warn('[PDF] Diagram render failed for turn', turnId, e);
      }
    }
  }

  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
  container.innerHTML = buildHTML({ ...params, diagramSVGs });
  document.body.appendChild(container);

  try {
    await document.fonts.ready;
    const canvas = await html2canvas(container.firstElementChild, {
      scale:      2,
      useCORS:    true,
      logging:    false,
      backgroundColor: '#ffffff',
    });
    if (canvas.height > 15000) {
      console.warn('[PDF] Large canvas detected:', canvas.height, 'px — may be slow');
    }

    const imgData    = canvas.toDataURL('image/png');
    const pdf        = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pdfW       = pdf.internal.pageSize.getWidth();   // 210mm
    const pdfH       = pdf.internal.pageSize.getHeight();  // 297mm
    const imgHeightMm = (canvas.height / canvas.width) * pdfW;
    const numPages   = Math.ceil(imgHeightMm / pdfH);

    for (let p = 0; p < numPages; p++) {
      if (p > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, -p * pdfH, pdfW, imgHeightMm);

      // Footer overlay
      pdf.setFontSize(7.5);
      pdf.setTextColor(160, 160, 160);
      pdf.text('MASAR — Confidential Technical Report', 10, pdfH - 6);
      pdf.text(`Page ${p + 1} of ${numPages}`, pdfW / 2, pdfH - 6, { align: 'center' });
      pdf.text(new Date().toLocaleString('en-GB'), pdfW - 10, pdfH - 6, { align: 'right' });
    }

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('') + '-' + [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('');
    pdf.save(`MASAR-Report-${stamp}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
