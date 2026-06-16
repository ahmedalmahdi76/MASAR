import { useRef, useState } from 'react';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export default function FileUploadButton({ attachedFile, onFileAttached, onRemove }) {
  const inputRef    = useRef(null);
  const [processing, setProcessing] = useState(false);

  const handleClick = () => {
    if (attachedFile) return; // clicking when file attached does nothing (use × to remove)
    inputRef.current?.click();
  };

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      alert('حجم الملف كبير جداً، الحد الأقصى 5MB');
      e.target.value = '';
      return;
    }

    setProcessing(true);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        // Strip the "data:<mime>;base64," prefix
        const raw    = evt.target.result;
        const base64 = raw.split(',')[1] ?? raw;
        const isImage = file.type.startsWith('image/');
        onFileAttached({
          data: base64,
          type: isImage ? 'image' : 'pdf',
          mime: isImage ? file.type : 'application/pdf',
          name: file.name,
        });
      } catch (err) {
        console.warn('[FILE] processing error:', err.message);
      } finally {
        setProcessing(false);
      }
    };

    reader.onerror = () => {
      console.warn('[FILE] FileReader error');
      setProcessing(false);
    };

    reader.readAsDataURL(file);
    e.target.value = ''; // reset so same file can be re-selected
  };

  const truncateName = (name) => name.length > 18 ? name.slice(0, 16) + '…' : name;

  const hasFile = !!attachedFile && !processing;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleChange}
      />

      <div
        style={{
          display:     'flex',
          alignItems:  'center',
          gap:         '0.25rem',
          height:       36,
          minWidth:     40,
          maxWidth:     hasFile ? 180 : 40,
          background:   hasFile ? 'rgba(245,158,11,0.08)' : 'transparent',
          border:       `1px solid ${hasFile ? 'rgba(245,158,11,0.45)' : 'rgba(226,232,240,0.18)'}`,
          borderRadius: 10,
          padding:      hasFile ? '0 0.5rem 0 0.625rem' : '0',
          transition:   'max-width 300ms ease, border-color 200ms, background 200ms',
          overflow:     'hidden',
          flexShrink:   0,
          cursor:       processing ? 'default' : hasFile ? 'default' : 'pointer',
        }}
        onClick={!hasFile && !processing ? handleClick : undefined}
        onMouseEnter={e => {
          if (!hasFile && !processing) {
            e.currentTarget.style.borderColor = 'rgba(226,232,240,0.40)';
          }
        }}
        onMouseLeave={e => {
          if (!hasFile) {
            e.currentTarget.style.borderColor = 'rgba(226,232,240,0.18)';
          }
        }}
        title={hasFile ? attachedFile.name : 'أرفق ملف'}
      >
        {processing ? (
          /* Spinner fills the 40px slot */
          <span style={{
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            width:         40,
            flexShrink:    0,
          }}>
            <span style={{
              width:        14, height: 14,
              border:       '2px solid rgba(226,232,240,0.2)',
              borderTop:    '2px solid rgba(226,232,240,0.7)',
              borderRadius: '50%',
              animation:    'spin 0.7s linear infinite',
              display:      'block',
            }} />
          </span>
        ) : hasFile ? (
          /* File attached state */
          <>
            <span style={{ fontSize: '0.875rem', flexShrink: 0 }}>📎</span>
            <span style={{
              fontFamily:  'var(--font-mono)',
              fontSize:    '0.625rem',
              color:       'var(--masar-amber)',
              letterSpacing: '0.03em',
              whiteSpace:  'nowrap',
              overflow:    'hidden',
              textOverflow: 'ellipsis',
              flex:         1,
            }}>
              {truncateName(attachedFile.name)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              style={{
                background:   'transparent',
                border:       'none',
                color:        'rgba(245,158,11,0.65)',
                cursor:       'pointer',
                fontSize:     '0.875rem',
                lineHeight:   1,
                padding:      '0 0.125rem',
                flexShrink:   0,
                display:      'flex',
                alignItems:   'center',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(245,158,11,0.65)'}
              title="إزالة الملف"
            >
              ×
            </button>
          </>
        ) : (
          /* Idle state — just the paperclip icon centered in 40px */
          <span style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            width:           40,
            flexShrink:      0,
            fontSize:        '1rem',
            color:           'rgba(148,163,184,0.65)',
          }}>
            📎
          </span>
        )}
      </div>
    </>
  );
}
