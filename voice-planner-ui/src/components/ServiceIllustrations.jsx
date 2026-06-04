/**
 * ServiceIllustrations — pure SVG/CSS decorative backgrounds for service cards.
 * Each component: position absolute, fills parent, opacity 0.08, pointer-events none.
 * Animations are self-contained in inline <style> blocks.
 * All animations respect prefers-reduced-motion via global index.css rule.
 */

const BASE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  overflow: 'hidden',
  opacity: 0.08,
};

/* ── 1. Fiber Optic ─────────────────────────────────────────────────────── */
function FiberIllustration() {
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 300 160" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes fiber-dot-1 { 0%{stroke-dashoffset:520} 100%{stroke-dashoffset:0} }
        @keyframes fiber-dot-2 { 0%{stroke-dashoffset:480} 100%{stroke-dashoffset:0} }
        @keyframes fiber-dot-3 { 0%{stroke-dashoffset:440} 100%{stroke-dashoffset:0} }
        .fd1{animation:fiber-dot-1 3s linear infinite}
        .fd2{animation:fiber-dot-2 3.7s linear infinite 0.9s}
        .fd3{animation:fiber-dot-3 4.2s linear infinite 1.8s}
      `}</style>
      {/* Fiber cable paths */}
      <path d="M-10,130 Q60,90 120,110 T280,80" fill="none" stroke="#F59E0B" strokeWidth="1" opacity="0.3" />
      <path d="M-10,80 Q80,40 160,70 T310,50" fill="none" stroke="#F59E0B" strokeWidth="1" opacity="0.3" />
      <path d="M-10,160 Q70,120 150,140 T310,120" fill="none" stroke="#F59E0B" strokeWidth="0.8" opacity="0.2" />
      {/* Traveling dots via stroke-dashoffset */}
      <path className="fd1" d="M-10,130 Q60,90 120,110 T280,80" fill="none" stroke="#F59E0B" strokeWidth="3" strokeDasharray="8 520" strokeLinecap="round" />
      <path className="fd2" d="M-10,80 Q80,40 160,70 T310,50" fill="none" stroke="#F59E0B" strokeWidth="3" strokeDasharray="8 480" strokeLinecap="round" />
      <path className="fd3" d="M-10,160 Q70,120 150,140 T310,120" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeDasharray="6 440" strokeLinecap="round" />
    </svg>
  );
}

/* ── 2. Network Topology ─────────────────────────────────────────────────── */
function TopologyIllustration() {
  const nodes = [
    [40,30], [130,25], [220,40], [270,90],
    [200,130], [100,140], [30,100], [160,80],
  ];
  const edges = [
    [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0],[7,1],[7,4],[7,6],
  ];
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 300 160" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes np-pulse { 0%,100%{r:3;opacity:0.9} 50%{r:5;opacity:1} }
        @keyframes nl-fade  { 0%,100%{opacity:0.2} 50%{opacity:0.6} }
        .np{animation:np-pulse 3s ease-in-out infinite}
        .nl{animation:nl-fade 4s ease-in-out infinite}
        .nl:nth-child(odd){animation-delay:1s}
        .nl:nth-child(3n){animation-delay:2s}
      `}</style>
      {edges.map(([a,b],i) => (
        <line key={i} className="nl" x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="#22D3EE" strokeWidth="1" />
      ))}
      {nodes.map(([cx,cy],i) => (
        <circle key={i} className="np" cx={cx} cy={cy} r="3" fill="#22D3EE"
          style={{ animationDelay: `${i * 0.35}s` }} />
      ))}
    </svg>
  );
}

/* ── 3. IP Scheme ────────────────────────────────────────────────────────── */
function IpIllustration() {
  const cols = [
    { x: 20,  chars: ['0A','1F','B2','3C','FF','0E','9D','5A','2B','C1','7E','04'], delay: '0s',   dur: '8s'  },
    { x: 70,  chars: ['FF','00','A3','1C','8B','2D','F0','6E','3A','B5','C2','91'], delay: '2s',   dur: '10s' },
    { x: 120, chars: ['10','2A','C3','5F','0B','7D','E1','4A','93','B0','2E','F8'], delay: '1s',   dur: '9s'  },
    { x: 170, chars: ['00','AB','3D','FC','81','6E','2B','D4','08','5C','A7','3F'], delay: '3s',   dur: '11s' },
  ];
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 200 160" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes data-fall { from{transform:translateY(-80px)} to{transform:translateY(80px)} }
        .df{animation:data-fall linear infinite}
      `}</style>
      {cols.map(({ x, chars, delay, dur }) => (
        <g key={x} className="df" style={{ animationDuration: dur, animationDelay: delay }}>
          {chars.map((ch, i) => (
            <text key={i} x={x} y={i * 14} fontFamily="IBM Plex Mono, monospace" fontSize="10"
              fill="#10B981" opacity={0.5 - i * 0.03} textAnchor="middle">
              {ch}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ── 4. Network Monitoring ───────────────────────────────────────────────── */
function MonitoringIllustration() {
  const ekg = 'M0,80 L40,80 L55,80 L60,40 L65,110 L70,70 L80,80 L140,80 L155,80 L160,35 L165,115 L170,70 L180,80 L300,80';
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 300 160" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes hb-sweep { 0%{stroke-dashoffset:700} 100%{stroke-dashoffset:0} }
        .hb{animation:hb-sweep 2.5s linear infinite}
        @keyframes hb-glow  { 0%,100%{opacity:0.15} 50%{opacity:0.35} }
        .hg{animation:hb-glow 2.5s ease-in-out infinite}
      `}</style>
      {/* Dim ghost line */}
      <path d={ekg} fill="none" stroke="#F59E0B" strokeWidth="1" opacity="0.2" />
      {/* Sweeping bright line */}
      <path className="hb" d={ekg} fill="none" stroke="#F59E0B" strokeWidth="2"
        strokeDasharray="700 700" strokeLinecap="round" opacity="0.9" />
      {/* Subtle glow behind */}
      <path className="hg" d={ekg} fill="none" stroke="#F59E0B" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

/* ── 5. Capacity Planning ────────────────────────────────────────────────── */
function CapacityIllustration() {
  const bars = [
    { x: 30,  h: 90, delay: '0s'    },
    { x: 80,  h: 60, delay: '0.4s'  },
    { x: 130, h: 110,delay: '0.8s'  },
    { x: 180, h: 75, delay: '0.2s'  },
    { x: 230, h: 95, delay: '0.6s'  },
    { x: 280, h: 55, delay: '1s'    },
  ];
  const base = 140;
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 320 160" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes bar-grow {
          0%,100% { transform: scaleY(0.25); opacity: 0.4; }
          50%      { transform: scaleY(1);    opacity: 0.9; }
        }
        .bg-bar { animation: bar-grow ease-in-out infinite; transform-box: fill-box; transform-origin: bottom; }
      `}</style>
      {bars.map(({ x, h, delay }) => (
        <rect key={x} className="bg-bar" x={x - 14} y={base - h} width="28" height={h} rx="3"
          fill="#22D3EE" opacity="0.5"
          style={{ animationDuration: `${2 + parseFloat(delay) * 0.5 + 2}s`, animationDelay: delay }} />
      ))}
      {/* Baseline */}
      <line x1="10" y1={base} x2="310" y2={base} stroke="#22D3EE" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

/* ── 6. Redundancy Design ────────────────────────────────────────────────── */
function RedundancyIllustration() {
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 300 160" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes rd-dot-1 { 0%{stroke-dashoffset:380} 100%{stroke-dashoffset:0} }
        @keyframes rd-dot-2 { 0%{stroke-dashoffset:380} 100%{stroke-dashoffset:0} }
        @keyframes rd-dash   { 0%,100%{opacity:0.2} 50%{opacity:0.5} }
        .rd1{animation:rd-dot-1 3s linear infinite}
        .rd2{animation:rd-dot-2 3s linear infinite 1.5s}
        .rdash{animation:rd-dash 2s ease-in-out infinite}
      `}</style>
      {/* Primary path */}
      <path d="M10,65 Q80,50 150,65 T290,65" fill="none" stroke="#A78BFA" strokeWidth="1.5" opacity="0.35" />
      {/* Backup dashed path */}
      <path className="rdash" d="M10,100 Q80,115 150,100 T290,100"
        fill="none" stroke="#A78BFA" strokeWidth="1.5" strokeDasharray="8 6" />
      {/* Dot on primary */}
      <path className="rd1" d="M10,65 Q80,50 150,65 T290,65"
        fill="none" stroke="#A78BFA" strokeWidth="4" strokeDasharray="8 380" strokeLinecap="round" />
      {/* Dot on backup */}
      <path className="rd2" d="M10,100 Q80,115 150,100 T290,100"
        fill="none" stroke="#A78BFA" strokeWidth="4" strokeDasharray="8 380" strokeLinecap="round" />
      {/* Node circles */}
      {[[10,65],[10,100],[290,65],[290,100],[150,65],[150,100]].map(([cx,cy],i)=>(
        <circle key={i} cx={cx} cy={cy} r="4" fill="#A78BFA" opacity="0.6" />
      ))}
    </svg>
  );
}

/* ── 7. Network Security ─────────────────────────────────────────────────── */
function SecurityIllustration() {
  const shield = 'M150,10 L220,35 L220,95 Q220,140 150,160 Q80,140 80,95 L80,35 Z';
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes sh-scan { 0%{transform:translateY(0px)} 80%,100%{transform:translateY(120px)} }
        @keyframes sh-pulse { 0%,100%{opacity:0.5} 50%{opacity:0.9} }
        .sh-scan{animation:sh-scan 2.8s ease-in-out infinite}
        .sh-pulse{animation:sh-pulse 3s ease-in-out infinite}
        .sh-scan-line{animation:sh-scan 2.8s ease-in-out infinite; transform-box:fill-box}
      `}</style>
      {/* Shield outline */}
      <path className="sh-pulse" d={shield} fill="none" stroke="#EF4444" strokeWidth="2" />
      {/* Inner glow */}
      <path d={shield} fill="#EF4444" opacity="0.06" />
      {/* Clipping mask for scan line */}
      <defs>
        <clipPath id="shield-clip">
          <path d={shield} />
        </clipPath>
      </defs>
      {/* Scan line */}
      <g clipPath="url(#shield-clip)">
        <rect className="sh-scan-line" x="70" y="20" width="160" height="3" fill="#EF4444" opacity="0.7" rx="1" />
      </g>
    </svg>
  );
}

/* ── 8. QoS Design ───────────────────────────────────────────────────────── */
function QosIllustration() {
  const lanes = [
    { y: 35,  h: 22, speed: '2s',   label: 'HIGH',  color: '#10B981', count: 3 },
    { y: 75,  h: 18, speed: '3.5s', label: 'MED',   color: '#10B981', count: 2 },
    { y: 108, h: 14, speed: '5.5s', label: 'LOW',   color: '#10B981', count: 1 },
  ];
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 300 155" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes pkt-flow { from{transform:translateX(-60px)} to{transform:translateX(320px)} }
        .pkt{animation:pkt-flow linear infinite}
      `}</style>
      {lanes.map(({ y, h, speed, color }, li) => (
        <g key={li}>
          {/* Lane background */}
          <rect x="10" y={y} width="280" height={h} rx="3" fill={color} opacity="0.07" />
          {/* Lane border lines */}
          <line x1="10" y1={y} x2="290" y2={y} stroke={color} strokeWidth="0.5" opacity="0.3" />
          <line x1="10" y1={y + h} x2="290" y2={y + h} stroke={color} strokeWidth="0.5" opacity="0.3" />
          {/* Packets */}
          {Array.from({ length: 3 }).map((_, pi) => (
            <rect key={pi} className="pkt" x={-60 + pi * 90} y={y + h * 0.2} width={h * 1.4} height={h * 0.6}
              rx="2" fill={color} opacity="0.6"
              style={{ animationDuration: speed, animationDelay: `${pi * (parseFloat(speed) / 3)}s` }} />
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ── 9. General Conversation ─────────────────────────────────────────────── */
function GeneralIllustration() {
  return (
    <svg className="service-illus" style={BASE} viewBox="0 0 300 160" preserveAspectRatio="xMidYMid slice">
      <style>{`
        @keyframes wave-ripple {
          0%   { r: 12; opacity: 0.8; }
          100% { r: 90; opacity: 0;   }
        }
        .wr1{animation:wave-ripple 3.5s ease-out infinite}
        .wr2{animation:wave-ripple 3.5s ease-out infinite 1.1s}
        .wr3{animation:wave-ripple 3.5s ease-out infinite 2.2s}
      `}</style>
      <circle className="wr1" cx="150" cy="80" r="12" fill="none" stroke="#6366F1" strokeWidth="2" />
      <circle className="wr2" cx="150" cy="80" r="12" fill="none" stroke="#6366F1" strokeWidth="1.5" />
      <circle className="wr3" cx="150" cy="80" r="12" fill="none" stroke="#6366F1" strokeWidth="1" />
      {/* Center dot */}
      <circle cx="150" cy="80" r="5" fill="#6366F1" opacity="0.7" />
    </svg>
  );
}

/* ── Export map ──────────────────────────────────────────────────────────── */
export const ILLUSTRATIONS = {
  fiber:      FiberIllustration,
  topology:   TopologyIllustration,
  ip:         IpIllustration,
  monitoring: MonitoringIllustration,
  capacity:   CapacityIllustration,
  redundancy: RedundancyIllustration,
  security:   SecurityIllustration,
  qos:        QosIllustration,
  general:    GeneralIllustration,
};
