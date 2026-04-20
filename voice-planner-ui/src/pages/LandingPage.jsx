import { useNavigate } from 'react-router-dom';

/*
 * STAGE 1 — Landing Page
 * Build order:
 *   [x] Scaffold with design tokens
 *   [ ] Hero copy + animated headline
 *   [ ] Demo GIF / video embed
 *   [ ] "Get Started" CTA → /auth
 *   [ ] Feature callout strip
 */

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>

      {/* Ambient grid */}
      <div className="grid-bg" />

      {/* Amber radial bloom — top center */}
      <div style={{
        position: 'fixed',
        top: '-20%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '800px',
        height: '500px',
        background: 'radial-gradient(ellipse, rgba(245,158,11,0.07) 0%, transparent 70%)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* ── Nav ── */}
      <nav style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1.25rem 2.5rem',
        borderBottom: '1px solid var(--masar-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span className="mono-sm text-amber">◈</span>
          <span className="heading-md" style={{ fontFamily: 'var(--font-display)' }}>
            Plan Networks <span style={{ color: 'var(--masar-amber)', fontWeight: 400, fontFamily: 'var(--font-display)' }}>Speak Arabic</span>
          </span>
        </div>
        <button
          onClick={() => navigate('/auth')}
          className="mono-sm"
          style={{
            background: 'transparent',
            border: '1px solid var(--masar-border-mid)',
            color: 'var(--masar-muted)',
            padding: '0.5rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            transition: 'all var(--duration-base) var(--ease-in-out)',
          }}
          onMouseEnter={e => {
            e.target.style.borderColor = 'var(--masar-amber-line)';
            e.target.style.color = 'var(--masar-amber)';
          }}
          onMouseLeave={e => {
            e.target.style.borderColor = 'var(--masar-border-mid)';
            e.target.style.color = 'var(--masar-muted)';
          }}
        >
          Sign in
        </button>
      </nav>

      {/* ── Hero ── */}
      <main className="page-enter" style={{
        position: 'relative',
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '8rem 2rem 4rem',
        gap: '2rem',
      }}>

        {/* Status badge */}
        <div className="mono-sm" style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'var(--masar-amber-glow)',
          border: '1px solid var(--masar-amber-line)',
          color: 'var(--masar-amber)',
          padding: '0.375rem 1rem',
          borderRadius: '999px',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--masar-amber)', display: 'inline-block' }} />
          Egyptian Voice AI for Network Planning
        </div>

        {/* Headline — PLACEHOLDER, replace with animated version */}
        <h1 className="display-xl" style={{ maxWidth: '820px' }}>
          Masar.<br />
          <span style={{ color: 'var(--masar-amber)', fontFamily: 'Cairo, sans-serif' }}>مسار</span>
        </h1>

        {/* Subheadline */}
        <p style={{
          fontFamily: 'CaviarDreams, sans-serif',
          fontSize: '1.125rem',
          color: 'var(--masar-muted)',
          maxWidth: '540px',
          lineHeight: 1.7,
        }}>
          A real-time voice AI agent that listens to Egyptian Arabic network engineering commands and generates expert topology solutions instantly.
        </p>

        {/* CTA */}
        <button
          onClick={() => navigate('/auth')}
          style={{
            marginTop: '0.5rem',
            background: 'var(--masar-amber)',
            border: 'none',
            color: '#080C14',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
            padding: '0.875rem 2.5rem',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            letterSpacing: '-0.01em',
            transition: 'opacity var(--duration-fast)',
          }}
          onMouseEnter={e => e.target.style.opacity = '0.88'}
          onMouseLeave={e => e.target.style.opacity = '1'}
        >
          Get Started →
        </button>
      </main>
    </div>
  );
}
