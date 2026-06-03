import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import Spinner from '../components/Spinner';
import ThemeToggle from '../components/ThemeToggle';
import OnboardingTour from '../components/OnboardingTour';

const TOUR_STEPS_SERVICES = [
  {
    targetId:    null,
    title:       'أهلاً في مسار 🔶',
    description: 'مسار هو مساعدك الذكي لتخطيط شبكات الاتصالات. خليني أريك كيف تستخدمه.',
    position:    'bottom',
  },
  {
    targetId:    'service-grid',
    title:       'اختار خدمتك',
    description: 'كل كارت بيمثل تخصص هندسي مختلف. اختار الخدمة اللي محتاجها وابدأ المحادثة.',
    position:    'bottom',
  },
  {
    targetId:    'user-menu-btn',
    title:       'حسابك',
    description: 'من هنا تقدر توصل لإعداداتك، تغير كلمة المرور، أو تسجل الخروج.',
    position:    'bottom',
  },
  {
    targetId:    'theme-toggle-btn',
    title:       'الوضع الليلي والنهاري',
    description: 'غير المظهر حسب راحتك — وضع مظلم أو فاتح.',
    position:    'bottom',
  },
];

/*
 * STAGE 3 — Service Selection (Bento Grid v2)
 *
 * Grid blueprint (6-column × 3-row system):
 *
 *  ┌──────────────────┬───────────┬───────────┐
 *  │  Fiber Optic     │  Topology │  IP Scheme│  ROW 1
 *  │  (col 1-4)       │  (col 4-6)│  (col 6-7)│
 *  ├───────────┬──────┴─────┬─────┴───────────┤
 *  │  Monitoring│  Capacity  │  Redundancy    │  ROW 2
 *  │  (col 1-3) │  (col 3-5) │  (col 5-7)     │
 *  ├────────────┴─────┬──────┴─────────────────┤
 *  │  Security        │  QoS     │  General    │  ROW 3
 *  │  (col 1-3)       │  (col 3-5)│  (col 5-7) │
 *  └──────────────────┴──────────┴─────────────┘
 */

const SERVICES = [
  /* ── ROW 1 ── */
  {
    id: 'fiber',
    col: '1 / 4', row: '1 / 2',
    label: 'Fiber Optic Routing',
    arabic: 'توجيه الألياف الضوئية',
    desc: 'Design backbone fiber routes with OSNR budgets and splicing intervals.',
    accent: '#F59E0B',
    icon: '◈',
    large: true,
    // Diagonal traces (optical fibers) + amber bloom at exit point (top-right)
    cardBg: [
      'radial-gradient(ellipse 70% 80% at 95% 0%, rgba(245,158,11,0.13) 0%, transparent 55%)',
      'repeating-linear-gradient(135deg, transparent 0px, transparent 18px, rgba(245,158,11,0.035) 18px, rgba(245,158,11,0.035) 19px)',
      'var(--masar-surface)',
    ].join(', '),
  },
  {
    id: 'topology',
    col: '4 / 6', row: '1 / 2',
    label: 'Network Topology',
    arabic: 'طبولوجيا الشبكة',
    desc: 'Ring, mesh, and star topology generation.',
    accent: '#22D3EE',
    icon: '⬡',
    large: false,
    // Grid-dot matrix (nodes) + cyan center glow
    cardBg: [
      'radial-gradient(circle at 65% 35%, rgba(34,211,238,0.11) 0%, transparent 55%)',
      'repeating-linear-gradient(0deg,   transparent 0, transparent 14px, rgba(34,211,238,0.04) 14px, rgba(34,211,238,0.04) 15px)',
      'repeating-linear-gradient(90deg,  transparent 0, transparent 14px, rgba(34,211,238,0.04) 14px, rgba(34,211,238,0.04) 15px)',
      'var(--masar-surface)',
    ].join(', '),
  },
  {
    id: 'ip',
    col: '6 / 7', row: '1 / 2',
    label: 'IP Scheme',
    arabic: 'مخطط IP',
    desc: 'VLSM, subnetting, and addressing plans.',
    accent: '#10B981',
    icon: '⊞',
    large: false,
    compact: true,
    // Address columns (vertical grid) + green corner bloom
    cardBg: [
      'radial-gradient(ellipse at 100% 100%, rgba(16,185,129,0.13) 0%, transparent 55%)',
      'repeating-linear-gradient(90deg, transparent 0, transparent 8px, rgba(16,185,129,0.045) 8px, rgba(16,185,129,0.045) 9px)',
      'var(--masar-surface)',
    ].join(', '),
  },

  /* ── ROW 2 ── */
  {
    id: 'monitoring',
    col: '1 / 3', row: '2 / 3',
    label: 'Network Monitoring',
    arabic: 'مراقبة الشبكة',
    desc: 'SNMP, NetFlow, and real-time alerting schemas.',
    accent: '#F59E0B',
    icon: '◎',
    large: false,
    // Radar pulse rings + amber center glow
    cardBg: [
      'radial-gradient(circle at 50% 50%, transparent 28%, rgba(245,158,11,0.06) 29%, transparent 31%, transparent 52%, rgba(245,158,11,0.04) 53%, transparent 55%)',
      'radial-gradient(ellipse at 50% 50%, rgba(245,158,11,0.10) 0%, transparent 65%)',
      'var(--masar-surface)',
    ].join(', '),
  },
  {
    id: 'capacity',
    col: '3 / 5', row: '2 / 3',
    label: 'Capacity Planning',
    arabic: 'تخطيط السعة',
    desc: 'Bandwidth estimation and growth projection.',
    accent: '#22D3EE',
    icon: '◱',
    large: false,
    // Rising vertical bars (bandwidth chart) + top-fade gradient
    cardBg: [
      'linear-gradient(180deg, var(--masar-surface) 0%, rgba(34,211,238,0.055) 100%)',
      'repeating-linear-gradient(90deg, transparent 0, transparent 10px, rgba(34,211,238,0.04) 10px, rgba(34,211,238,0.04) 11px)',
      'var(--masar-surface)',
    ].join(', '),
  },
  {
    id: 'redundancy',
    col: '5 / 7', row: '2 / 3',
    label: 'Redundancy Design',
    arabic: 'تصميم التكرار',
    desc: 'Failover paths, hot standby, and STP planning.',
    accent: '#A78BFA',
    icon: '⇄',
    large: false,
    // Crosshatch (dual redundant paths) + violet top glow
    cardBg: [
      'radial-gradient(ellipse at 50% 0%, rgba(167,139,250,0.12) 0%, transparent 55%)',
      'repeating-linear-gradient( 45deg, transparent 0, transparent 14px, rgba(167,139,250,0.03) 14px, rgba(167,139,250,0.03) 15px)',
      'repeating-linear-gradient(-45deg, transparent 0, transparent 14px, rgba(167,139,250,0.03) 14px, rgba(167,139,250,0.03) 15px)',
      'var(--masar-surface)',
    ].join(', '),
  },

  /* ── ROW 3 ── */
  {
    id: 'security',
    col: '1 / 3', row: '3 / 4',
    label: 'Network Security',
    arabic: 'أمن الشبكة',
    desc: 'Firewall zoning, ACLs, and DMZ architecture.',
    accent: '#EF4444',
    icon: '⬡',
    large: false,
    // Diagonal hatching (ACL chains) + red corner ember
    cardBg: [
      'radial-gradient(circle at 15% 85%, rgba(239,68,68,0.13) 0%, transparent 50%)',
      'repeating-linear-gradient(45deg, transparent 0, transparent 9px, rgba(239,68,68,0.035) 9px, rgba(239,68,68,0.035) 10px)',
      'var(--masar-surface)',
    ].join(', '),
  },
  {
    id: 'qos',
    col: '3 / 5', row: '3 / 4',
    label: 'QoS Design',
    arabic: 'جودة الخدمة',
    desc: 'Traffic shaping, DSCP marking, and priority queuing.',
    accent: '#10B981',
    icon: '≋',
    large: false,
    // Horizontal priority bands (traffic lanes) + green bottom bloom
    cardBg: [
      'radial-gradient(ellipse at 50% 110%, rgba(16,185,129,0.11) 0%, transparent 55%)',
      'repeating-linear-gradient(0deg, transparent 0, transparent 5px, rgba(16,185,129,0.035) 5px, rgba(16,185,129,0.035) 6px)',
      'var(--masar-surface)',
    ].join(', '),
  },
  {
    id: 'general',
    col: '5 / 7', row: '3 / 4',
    label: 'General Conversation',
    arabic: 'محادثة عامة',
    desc: 'Free-form discussion on any engineering topic without a specific task.',
    accent: '#6366F1',
    icon: '⊙',
    large: false,
    // Soft dual-tone organic glow — open-ended, no hard pattern
    cardBg: [
      'radial-gradient(ellipse 75% 65% at 25% 70%, rgba(99,102,241,0.13) 0%, transparent 60%)',
      'radial-gradient(ellipse 50% 50% at 85% 20%, rgba(139,92,246,0.08) 0%, transparent 55%)',
      'var(--masar-surface)',
    ].join(', '),
  },
];

export default function ServiceSelect() {
  const navigate = useNavigate();
  const [user,      setUser]      = useState(undefined);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [clickedId, setClickedId] = useState(null);
  const [showTour,  setShowTour]  = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));
  }, []);

  useEffect(() => {
    const done = localStorage.getItem('masar_tour_services');
    if (!done) setShowTour(true);
  }, []);

  const completeTour = () => {
    localStorage.setItem('masar_tour_services', 'done');
    setShowTour(false);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const isGuest = user === null && !!localStorage.getItem('masar_guest');

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('masar_guest');
    localStorage.removeItem('masar_token');
    navigate('/auth');
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--masar-void)',
      overflow: 'hidden',
      position: 'relative',
    }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');

        .arabic-cairo {
          font-family: 'Cairo', sans-serif;
          direction: rtl;
          unicode-bidi: isolate;
        }

        .bento-card {
          position: relative;
          overflow: hidden;
          cursor: pointer;
          border: 1px solid var(--masar-border);
          border-radius: 14px;
          padding: 1.25rem 1.375rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition:
            border-color 220ms ease,
            transform 220ms ease,
            box-shadow 220ms ease;
          text-align: left;
        }

        .bento-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.35);
        }

        .bento-card .card-arrow {
          opacity: 0;
          transform: translateX(-4px);
          transition: opacity 200ms ease, transform 200ms ease;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.75rem;
        }

        .bento-card:hover .card-arrow {
          opacity: 1;
          transform: translateX(0);
        }

        @media (max-width: 900px) {
          .bento-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            grid-template-rows: none !important;
          }
          .bento-grid > * {
            grid-column: auto !important;
            grid-row: auto !important;
          }
        }

        @media (max-width: 540px) {
          .bento-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <div className="grid-bg" style={{ opacity: 0.18 }} />

      {/* ── Header ── */}
      <header style={{
        position: 'relative',
        zIndex: 10,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.75rem',
        borderBottom: '1px solid var(--masar-border)',
        background: 'var(--masar-deep)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="mono-sm text-amber">◈</span>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '1.0625rem', color: '#E2E8F0' }}>
            Masar{' '}
            <span style={{ fontFamily: 'Cairo, sans-serif', fontWeight: 700, color: 'var(--masar-amber)' }}>مسار</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span className="mono-sm text-muted">Select a service to begin</span>
          <span id="theme-toggle-btn"><ThemeToggle /></span>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <div
              id="user-menu-btn"
              onClick={() => setMenuOpen(v => !v)}
              style={{
                width: 30, height: 30, borderRadius: '50%',
                background: menuOpen ? 'var(--masar-border-mid)' : 'var(--masar-elevated)',
                border: '1px solid var(--masar-border-mid)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: isGuest ? 'Cairo, sans-serif' : 'Syne, sans-serif',
                fontWeight: 700, fontSize: '0.8125rem',
                color: 'var(--masar-amber)', cursor: 'pointer',
                transition: 'background var(--duration-fast)', userSelect: 'none',
              }}
            >
              {isGuest ? 'ض' : (user?.email?.[0] ?? '?').toUpperCase()}
            </div>

            {menuOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                width: 220, zIndex: 100,
                background: 'var(--masar-surface)',
                border: '1px solid var(--masar-border)',
                borderRadius: 'var(--radius-md)', overflow: 'hidden',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--masar-border)' }}>
                  <p style={{
                    fontFamily: 'Cairo, sans-serif', fontSize: '0.8rem',
                    color: 'var(--masar-muted)', direction: 'rtl', textAlign: 'right',
                    margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {isGuest ? 'ضيف' : (user?.email ?? '')}
                  </p>
                </div>

                <MenuBtn onClick={() => { setMenuOpen(false); navigate('/settings'); }}>
                  <span style={{ fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem', color: '#E2E8F0' }}>الإعدادات</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--masar-muted)' }}>⚙</span>
                </MenuBtn>

                {isGuest ? (
                  <MenuBtn onClick={() => { setMenuOpen(false); navigate('/auth'); }}>
                    <span style={{ fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem', color: 'var(--masar-amber)' }}>إنشاء حساب</span>
                  </MenuBtn>
                ) : (
                  <>
                    <div style={{ height: '1px', background: 'var(--masar-border)' }} />
                    <MenuBtn onClick={() => { setMenuOpen(false); handleSignOut(); }} danger>
                      <span style={{ fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem', color: '#EF4444' }}>تسجيل الخروج</span>
                    </MenuBtn>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Title strip ── */}
      <div style={{
        position: 'relative', zIndex: 5, flexShrink: 0,
        padding: '1.125rem 1.75rem 0.75rem',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      }}>
        <div>
          <p className="mono-sm text-amber" style={{ marginBottom: '0.3rem' }}>◈ Network Planning Services</p>
          <h1 style={{
            fontFamily: 'Syne, sans-serif',
            fontSize: 'clamp(1.25rem, 2.5vw, 1.625rem)',
            fontWeight: 700, color: '#E2E8F0',
            letterSpacing: '-0.02em', lineHeight: 1.2,
          }}>
            What are we designing today?
          </h1>
        </div>
        <p style={{
          fontFamily: 'Cairo, sans-serif', fontSize: '0.9375rem',
          color: 'var(--masar-muted)', textAlign: 'right', lineHeight: 1.5,
        }}>
          تحدث بالعربية المصرية — النظام يتولى الباقي
        </p>
      </div>

      {/* ── Bento Grid ── */}
      <div style={{ position: 'relative', zIndex: 5, flex: 1, padding: '0.75rem 1.75rem 1.25rem', overflow: 'hidden' }}>
        <div
          id="service-grid"
          className="bento-grid page-enter"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gridTemplateRows: 'repeat(3, 1fr)',
            gap: '0.75rem',
            height: '100%',
          }}
        >
          {SERVICES.map(service => (
            <BentoCard
              key={service.id}
              service={service}
              loading={clickedId === service.id}
              onClick={() => {
                if (clickedId) return;
                setClickedId(service.id);
                setTimeout(() => navigate('/workspace', { state: { service } }), 260);
              }}
            />
          ))}
        </div>
      </div>
      {showTour && (
        <OnboardingTour
          steps={TOUR_STEPS_SERVICES}
          onComplete={completeTour}
          onSkip={completeTour}
        />
      )}
    </div>
  );
}

/* ── Menu Button ── */

function MenuBtn({ children, onClick, danger }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        width: '100%', padding: '0.7rem 1rem',
        background: 'transparent', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: '0.5rem', cursor: 'pointer',
        transition: 'background var(--duration-fast)',
      }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.07)' : 'var(--masar-elevated)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {children}
    </button>
  );
}

/* ── Bento Card ── */

function BentoCard({ service, onClick, loading }) {
  return (
    <button
      onClick={onClick}
      className="bento-card"
      disabled={loading}
      style={{
        gridColumn: service.col,
        gridRow: service.row,
        background: service.cardBg,
        border: '1px solid var(--masar-border)',
        font: 'inherit',
        textAlign: 'left',
        opacity: loading ? 0.6 : 1,
        transition: 'opacity 200ms ease, border-color 220ms ease, transform 220ms ease, box-shadow 220ms ease',
      }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.borderColor = service.accent; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--masar-border)'; }}
    >
      {/* Top row — icon + arrow/spinner */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: service.large ? '1.75rem' : '1.375rem',
          color: service.accent,
          lineHeight: 1,
        }}>
          {service.icon}
        </span>
        {loading
          ? <Spinner size={14} />
          : <span className="card-arrow" style={{ color: service.accent }}>↗</span>
        }
      </div>

      {/* Bottom — labels */}
      <div>
        <p className="arabic-cairo" style={{
          fontSize: service.compact ? '0.8125rem' : '0.875rem',
          fontWeight: 600, color: service.accent,
          marginBottom: '0.2rem', lineHeight: 1.4,
        }}>
          {service.arabic}
        </p>
        <p style={{
          fontFamily: 'Syne, sans-serif',
          fontSize: service.compact ? '0.8125rem' : '0.9375rem',
          fontWeight: 600, color: '#E2E8F0',
          marginBottom: '0.3rem', lineHeight: 1.3,
          letterSpacing: '-0.01em',
        }}>
          {service.label}
        </p>
        {!service.compact && (
          <p style={{
            fontFamily: 'IBM Plex Sans, sans-serif',
            fontSize: '0.775rem', color: 'var(--masar-muted)', lineHeight: 1.55,
          }}>
            {service.desc}
          </p>
        )}
      </div>
    </button>
  );
}
