import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── CSS keyframes + utility classes ─────────────────────────────────────────
const LANDING_CSS = `
  @keyframes tsg-sway {
    0%, 100% { transform: rotateY(-20deg) rotateX(7deg);  }
    50%       { transform: rotateY( 20deg) rotateX(-5deg); }
  }
  @keyframes tsg-float {
    0%, 100% { transform: translateY(0px);   }
    50%       { transform: translateY(-14px); }
  }
  @keyframes tsg-glow-pulse {
    0%, 100% { opacity: 0.7; transform: scale(1);    }
    50%       { opacity: 1.0; transform: scale(1.06); }
  }
  @keyframes tsg-shine-sweep {
    0%   { transform: skewX(-15deg) translateX(-220%); }
    100% { transform: skewX(-15deg) translateX(520%);  }
  }
  @keyframes lp-fade-up {
    from { opacity: 0; transform: translateY(32px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes lp-scale-in {
    from { opacity: 0; transform: scale(0.84); }
    to   { opacity: 1; transform: scale(1);    }
  }
  @keyframes lp-grid-in {
    from { opacity: 0; } to { opacity: 1; }
  }
  @keyframes lp-scroll-pulse {
    0%, 100% { opacity: 0.3; height: 40px; }
    50%       { opacity: 0.7; height: 52px; }
  }
  .lp-btn-primary {
    position: relative; overflow: hidden; cursor: pointer;
    transition: transform 0.22s ease, box-shadow 0.22s ease;
  }
  .lp-btn-primary::after {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
    transform: skewX(-15deg) translateX(-220%);
    transition: transform 0.65s ease;
  }
  .lp-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(61,214,92,0.40) !important; }
  .lp-btn-primary:hover::after { transform: skewX(-15deg) translateX(440%); }
  .lp-btn-ghost {
    cursor: pointer;
    transition: background 0.2s, color 0.2s, transform 0.2s;
  }
  .lp-btn-ghost:hover {
    background: rgba(61,214,92,0.12) !important;
    color: #3dd65c !important;
    transform: translateY(-1px);
  }
  .lp-stat-card { transition: transform 0.22s, box-shadow 0.22s; }
  .lp-stat-card:hover { transform: translateY(-6px); box-shadow: 0 18px 52px rgba(61,214,92,0.13) !important; }
  .lp-feat-card { transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s; }
  .lp-feat-card:hover {
    transform: translateY(-7px);
    border-color: rgba(61,214,92,0.38) !important;
    box-shadow: 0 22px 60px rgba(61,214,92,0.13) !important;
  }
`;

// ─── Animated particle canvas ─────────────────────────────────────────────────
function Particles() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let raf;
    const pts = [];
    const COUNT = 85;
    const W = () => canvas.offsetWidth;
    const H = () => canvas.offsetHeight;

    const resize = () => {
      canvas.width  = W() * dpr;
      canvas.height = H() * dpr;
    };
    const spawn = () => {
      pts.length = 0;
      for (let i = 0; i < COUNT; i++) {
        pts.push({
          x: Math.random() * W(), y: Math.random() * H(),
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
          r: Math.random() * 1.7 + 0.25,
          a: Math.random() * 0.45 + 0.07,
        });
      }
    };

    resize(); spawn();
    const onResize = () => { resize(); spawn(); };
    window.addEventListener('resize', onResize);

    const tick = () => {
      const w = W(), h = H();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      pts.forEach(p => {
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fillStyle = `rgba(74,222,128,${p.a})`;
        ctx.fill();
      });

      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          if (d < 110) {
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = `rgba(74,222,128,${0.065 * (1 - d / 110)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <canvas ref={ref}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}

// ─── Logo SVG face — Thai Summit Group TS monogram ───────────────────────────
function LogoFace({ lit }) {
  const white = lit ? '#ffffff' : '#3a1004';
  const bg    = lit ? null      : '#5a1c08';
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block' }}>
      {lit && (
        <defs>
          <linearGradient id="ts-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#f57c28" />
            <stop offset="100%" stopColor="#c84010" />
          </linearGradient>
        </defs>
      )}

      {/* Orange rounded-square background */}
      <rect width="100" height="100" rx="14"
        fill={lit ? 'url(#ts-bg)' : bg}
      />

      {/* ── T — full-width crossbar + left stem ── */}
      <rect x="7"  y="7" width="86" height="20" rx="2" fill={white} />
      <rect x="7"  y="7" width="20" height="86" rx="2" fill={white} />

      {/* ── S — interlocks with T ── */}
      {/* S right upper vertical */}
      <rect x="74" y="7"  width="19" height="42" rx="2" fill={white} />
      {/* S middle crossbar */}
      <rect x="40" y="40" width="53" height="20" rx="2" fill={white} />
      {/* S left lower vertical */}
      <rect x="40" y="40" width="19" height="53" rx="2" fill={white} />
      {/* S bottom bar */}
      <rect x="40" y="74" width="53" height="19" rx="2" fill={white} />
    </svg>
  );
}

// ─── 3D stacked logo ──────────────────────────────────────────────────────────
const EXTRUDE = 22;

function Logo3D() {
  return (
    <div style={{ position: 'relative', width: 288, height: 288 }}>
      {/* Glow halo */}
      <div style={{
        position: 'absolute', inset: -32, borderRadius: '18%', zIndex: 0,
        background: 'radial-gradient(circle, rgba(230,100,20,0.32) 0%, transparent 68%)',
        animation: 'tsg-glow-pulse 8s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      {/* Float envelope */}
      <div style={{
        width: '100%', height: '100%',
        position: 'relative', zIndex: 1,
        animation: 'tsg-float 6.5s ease-in-out infinite',
      }}>
        {/* Perspective container */}
        <div style={{ width: '100%', height: '100%', perspective: 840, perspectiveOrigin: '50% 46%' }}>
          {/* Rotating group */}
          <div style={{
            width: '100%', height: '100%',
            transformStyle: 'preserve-3d',
            animation: 'tsg-sway 9s ease-in-out infinite',
            position: 'relative',
          }}>
            {/* Extrusion layers */}
            {Array.from({ length: EXTRUDE }, (_, i) => (
              <div key={i} style={{
                position: 'absolute', inset: 0,
                transform: `translateZ(${-(EXTRUDE - i) * 1.3}px)`,
                opacity: 0.10 + (i / EXTRUDE) * 0.55,
              }}>
                <LogoFace lit={false} />
              </div>
            ))}

            {/* Front face */}
            <div style={{ position: 'absolute', inset: 0, transform: 'translateZ(0.5px)' }}>
              <LogoFace lit />
            </div>

            {/* Specular sweep */}
            <div style={{
              position: 'absolute', inset: 0, transform: 'translateZ(1.5px)',
              borderRadius: '14%', overflow: 'hidden', pointerEvents: 'none',
            }}>
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: 0, width: '44%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)',
                animation: 'tsg-shine-sweep 5.5s ease-in-out 2s infinite',
              }} />
              {/* Fresnel highlight (static) */}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'radial-gradient(ellipse 56% 36% at 36% 28%, rgba(255,255,255,0.10), transparent 66%)',
              }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const STATS = [
  { num: '35+', tag: 'ปี',     label: 'ประสบการณ์',   icon: '🏆' },
  { num: '3',   tag: 'Plants', label: 'โรงงานผลิต',    icon: '🏭' },
  { num: '100+',tag: 'KPI',   label: 'ตัวชี้วัด',       icon: '📊' },
  { num: '12',  tag: 'Month', label: 'ติดตามรายเดือน', icon: '📅' },
];

const FEATURES = [
  {
    icon: '📊', title: 'Real-time Dashboard', titleTH: 'ติดตามผลแบบเรียลไทม์',
    desc: 'ภาพรวม KPI ทุกแผนก — PD3, PD4, JIG — บนหน้าจอเดียว พร้อมสถานะ ON TRACK / MONITOR / AT RISK',
  },
  {
    icon: '🎯', title: 'Target Management', titleTH: 'บริหารจัดการเป้าหมาย',
    desc: 'กำหนด Target รายปีหรือรายเดือนสำหรับทุก KPI เปรียบเทียบ Actual vs Commitment ได้ทันที',
  },
  {
    icon: '📈', title: 'Trend Analysis', titleTH: 'วิเคราะห์แนวโน้ม 12 เดือน',
    desc: 'กราฟแนวโน้มรายเดือน ระบุ Pattern และจุดเสี่ยงก่อนที่จะเกิดปัญหา พร้อม Mini Bar Chart ทุก KPI',
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh', background: '#050e06',
      color: '#e8f5ea', fontFamily: "'Inter','Sarabun',sans-serif",
      overflowX: 'hidden',
    }}>
      <style>{LANDING_CSS}</style>

      {/* ══ HERO ══════════════════════════════════════════════════════════════ */}
      <section style={{
        position: 'relative', minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '60px 24px 110px', textAlign: 'center', overflow: 'hidden',
      }}>
        {/* Perspective grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(rgba(61,214,92,0.038) 1px, transparent 1px),
            linear-gradient(90deg, rgba(61,214,92,0.038) 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          animation: 'lp-grid-in 3s ease both',
        }} />
        {/* Radial vignette */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 72% 56% at 50% 46%, rgba(13,61,20,0.30), transparent 76%)',
        }} />
        {/* Top corner accent */}
        <div style={{
          position: 'absolute', top: -120, right: -120, width: 400, height: 400,
          borderRadius: '50%', pointerEvents: 'none',
          background: 'radial-gradient(circle, rgba(26,109,46,0.12), transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: -80, left: -80, width: 320, height: 320,
          borderRadius: '50%', pointerEvents: 'none',
          background: 'radial-gradient(circle, rgba(232,124,30,0.07), transparent 70%)',
        }} />

        <Particles />

        {/* 3D Logo */}
        <div style={{
          position: 'relative', zIndex: 2, marginBottom: 38,
          animation: 'lp-scale-in 1.3s cubic-bezier(0.22,1,0.36,1) 0.1s both',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
        }}>
          <Logo3D />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{
              fontSize: 17, fontWeight: 900, letterSpacing: '0.22em',
              color: '#ffffff', textTransform: 'uppercase',
              textShadow: '0 0 28px rgba(230,100,20,0.55)',
            }}>
              THAI SUMMIT GROUP
            </div>
            <div style={{
              fontSize: 9, fontWeight: 600, letterSpacing: '0.32em',
              color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase',
            }}>
              Excellence in Manufacturing
            </div>
          </div>
        </div>

        {/* Eyebrow */}
        <div style={{
          position: 'relative', zIndex: 2, marginBottom: 20,
          animation: 'lp-fade-up 0.9s ease 0.55s both',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 18px', borderRadius: 100,
            border: '1px solid rgba(212,175,55,0.40)',
            background: 'rgba(212,175,55,0.07)',
            fontSize: 10, fontWeight: 700, letterSpacing: 3.5, color: '#d4af37',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#d4af37', opacity: 0.85 }} />
            PERFORMANCE INTELLIGENCE PLATFORM
          </span>
        </div>

        {/* Heading */}
        <h1 style={{
          position: 'relative', zIndex: 2, margin: '0 0 20px',
          fontSize: 'clamp(34px, 6.5vw, 68px)',
          fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.025em',
          background: 'linear-gradient(140deg, #ffffff 0%, #b2ecc4 50%, #3dd65c 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          maxWidth: 820,
          animation: 'lp-fade-up 1s ease 0.3s both',
        }}>
          Thai Summit Group<br />KPI Dashboard
        </h1>

        {/* Subtitle */}
        <p style={{
          position: 'relative', zIndex: 2, margin: '0 0 46px',
          fontSize: 'clamp(14px, 2vw, 18px)',
          color: 'rgba(232,245,234,0.56)', maxWidth: 480, lineHeight: 1.78,
          animation: 'lp-fade-up 1s ease 0.55s both',
        }}>
          ระบบบริหารจัดการ KPI สำหรับโรงงานผลิตชิ้นส่วนยานยนต์<br />
          ครอบคลุมทุกแผนก · ตรวจสอบได้แบบเรียลไทม์
        </p>

        {/* CTA row */}
        <div style={{
          position: 'relative', zIndex: 2,
          display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center',
          animation: 'lp-fade-up 1s ease 0.8s both',
        }}>
          <button className="lp-btn-primary" onClick={() => navigate('/login')} style={{
            padding: '14px 42px', borderRadius: 12, border: 'none',
            background: 'linear-gradient(138deg, #1a7a35 0%, #3dd65c 100%)',
            color: '#fff', fontSize: 15, fontWeight: 700, letterSpacing: '0.04em',
            boxShadow: '0 8px 32px rgba(61,214,92,0.28), 0 2px 8px rgba(0,0,0,0.38)',
          }}>
            เข้าสู่ระบบ →
          </button>
          <button
            className="lp-btn-ghost"
            onClick={() => document.getElementById('lp-features')?.scrollIntoView({ behavior: 'smooth' })}
            style={{
              padding: '14px 34px', borderRadius: 12,
              border: '1px solid rgba(61,214,92,0.22)', background: 'rgba(61,214,92,0.05)',
              color: 'rgba(232,245,234,0.70)', fontSize: 15, fontWeight: 600,
            }}
          >
            ดูฟีเจอร์ ↓
          </button>
        </div>

        {/* Scroll cue */}
        <div style={{
          position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          animation: 'lp-fade-up 1s ease 1.6s both', pointerEvents: 'none',
          color: 'rgba(232,245,234,0.22)', fontSize: 9.5, letterSpacing: 3,
        }}>
          <span>SCROLL</span>
          <div style={{
            width: 1,
            background: 'linear-gradient(to bottom, rgba(61,214,92,0.38), transparent)',
            animation: 'lp-scroll-pulse 2.2s ease-in-out infinite',
          }} />
        </div>
      </section>

      {/* ══ DIVIDER STRIP ═════════════════════════════════════════════════════ */}
      <div style={{
        padding: '0 28px',
        background: 'linear-gradient(90deg, transparent, rgba(61,214,92,0.08) 40%, rgba(61,214,92,0.08) 60%, transparent)',
        borderTop: '1px solid rgba(61,214,92,0.08)',
        borderBottom: '1px solid rgba(61,214,92,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 42, gap: 32, overflow: 'hidden',
      }}>
        {['PD3 Division', 'PD4 Division', 'JIG Division', 'Balanced Scorecard', 'OEE Monitoring'].map((t, i) => (
          <span key={i} style={{ fontSize: 10, fontWeight: 600, color: 'rgba(232,245,234,0.30)', letterSpacing: 2.5, whiteSpace: 'nowrap' }}>
            {t}
          </span>
        ))}
      </div>

      {/* ══ STATS ═════════════════════════════════════════════════════════════ */}
      <section style={{
        padding: '72px 24px',
        background: 'linear-gradient(180deg, #050e06 0%, #071409 100%)',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: 4.5,
              color: '#3dd65c', marginBottom: 12, textTransform: 'uppercase',
            }}>
              THAI SUMMIT AT A GLANCE
            </div>
            <h2 style={{
              fontSize: 'clamp(22px, 3.5vw, 38px)', fontWeight: 800,
              margin: 0, color: '#e8f5ea',
            }}>
              ตัวเลขที่บอกทุกอย่าง
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 16 }}>
            {STATS.map(({ num, tag, label, icon }, i) => (
              <div key={i} className="lp-stat-card" style={{
                padding: '32px 20px', borderRadius: 20, textAlign: 'center',
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.068)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
              }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>{icon}</div>
                <div style={{
                  fontSize: 46, fontWeight: 900, lineHeight: 1,
                  color: '#3dd65c', letterSpacing: '-1.5px',
                }}>{num}</div>
                <div style={{
                  fontSize: 9.5, color: 'rgba(232,245,234,0.35)',
                  letterSpacing: 2.8, marginTop: 6, textTransform: 'uppercase',
                }}>{tag}</div>
                <div style={{
                  fontSize: 13, color: 'rgba(232,245,234,0.62)',
                  marginTop: 10, lineHeight: 1.45,
                }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FEATURES ══════════════════════════════════════════════════════════ */}
      <section id="lp-features" style={{
        padding: '82px 24px',
        background: '#071409',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ maxWidth: 940, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 58 }}>
            <div style={{
              display: 'inline-block', padding: '4px 18px', borderRadius: 100,
              border: '1px solid rgba(61,214,92,0.24)', background: 'rgba(61,214,92,0.07)',
              fontSize: 9.5, fontWeight: 800, letterSpacing: 4, color: '#3dd65c', marginBottom: 18,
            }}>PLATFORM FEATURES</div>
            <h2 style={{
              fontSize: 'clamp(24px, 4vw, 44px)', fontWeight: 800, margin: 0,
              background: 'linear-gradient(135deg, #e8f5ea 0%, #3dd65c 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              ครบทุกมิติของ KPI
            </h2>
            <p style={{
              color: 'rgba(232,245,234,0.46)', marginTop: 16,
              fontSize: 14, lineHeight: 1.82, maxWidth: 480, margin: '16px auto 0',
            }}>
              ออกแบบมาเพื่อการบริหารจัดการผลการดำเนินงาน<br />
              ระดับโรงงานอุตสาหกรรมยานยนต์
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(256px, 1fr))', gap: 22 }}>
            {FEATURES.map(({ icon, title, titleTH, desc }, i) => (
              <div key={i} className="lp-feat-card" style={{
                padding: '36px 30px', borderRadius: 24,
                background: 'rgba(255,255,255,0.020)',
                border: '1px solid rgba(255,255,255,0.06)',
                boxShadow: '0 4px 28px rgba(0,0,0,0.20)',
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16, fontSize: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(61,214,92,0.08)',
                  border: '1px solid rgba(61,214,92,0.18)',
                  marginBottom: 24,
                }}>{icon}</div>
                <div style={{
                  fontSize: 16.5, fontWeight: 700, color: '#e8f5ea',
                  marginBottom: 5, lineHeight: 1.3,
                }}>{title}</div>
                <div style={{
                  fontSize: 12, color: '#3dd65c', fontWeight: 600,
                  marginBottom: 15, letterSpacing: '0.02em',
                }}>{titleTH}</div>
                <p style={{
                  fontSize: 13.5, color: 'rgba(232,245,234,0.50)',
                  lineHeight: 1.78, margin: 0,
                }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CTA ═══════════════════════════════════════════════════════════════ */}
      <section style={{
        padding: '90px 24px',
        background: 'linear-gradient(180deg, #071409, #050e06)',
        textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          {/* Mini emblem */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 14,
              background: 'linear-gradient(138deg, #f57c28, #c84010)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 40px rgba(230,100,20,0.30), 0 0 0 8px rgba(230,100,20,0.08)',
            }}>
              <svg viewBox="0 0 100 100" width="52" height="52">
                <rect x="7" y="7" width="86" height="20" rx="2" fill="#fff" />
                <rect x="7" y="7" width="20" height="86" rx="2" fill="#fff" />
                <rect x="74" y="7"  width="19" height="42" rx="2" fill="#fff" />
                <rect x="40" y="40" width="53" height="20" rx="2" fill="#fff" />
                <rect x="40" y="40" width="19" height="53" rx="2" fill="#fff" />
                <rect x="40" y="74" width="53" height="19" rx="2" fill="#fff" />
              </svg>
            </div>
          </div>

          <h2 style={{
            fontSize: 'clamp(22px, 4vw, 40px)', fontWeight: 800, marginBottom: 16,
            background: 'linear-gradient(135deg, #e8f5ea, #3dd65c)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            พร้อมเริ่มต้นแล้วหรือยัง?
          </h2>
          <p style={{
            color: 'rgba(232,245,234,0.46)', fontSize: 14.5,
            lineHeight: 1.88, marginBottom: 40,
          }}>
            เข้าสู่ระบบเพื่อดูภาพรวม KPI ล่าสุด<br />
            พร้อมข้อมูลเชิงลึกสำหรับการตัดสินใจอย่างแม่นยำ
          </p>
          <button className="lp-btn-primary" onClick={() => navigate('/login')} style={{
            padding: '16px 54px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(138deg, #1a7a35 0%, #3dd65c 100%)',
            color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: '0.04em',
            boxShadow: '0 10px 48px rgba(61,214,92,0.34), 0 2px 8px rgba(0,0,0,0.42)',
          }}>
            เข้าสู่ระบบ →
          </button>

          {/* Trust badges */}
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginTop: 40, flexWrap: 'wrap' }}>
            {['🔒 Secure Login', '⚡ Real-time Data', '📱 Responsive'].map((t, i) => (
              <span key={i} style={{
                fontSize: 11, color: 'rgba(232,245,234,0.34)', fontWeight: 500, letterSpacing: '0.02em',
              }}>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FOOTER ════════════════════════════════════════════════════════════ */}
      <footer style={{
        padding: '22px 28px',
        background: '#040c05',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6,
            background: 'linear-gradient(138deg, #f57c28, #c84010)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 100 100" width="18" height="18">
              <rect x="7" y="7" width="86" height="20" rx="2" fill="#fff" />
              <rect x="7" y="7" width="20" height="86" rx="2" fill="#fff" />
              <rect x="74" y="7"  width="19" height="42" rx="2" fill="#fff" />
              <rect x="40" y="40" width="53" height="20" rx="2" fill="#fff" />
              <rect x="40" y="40" width="19" height="53" rx="2" fill="#fff" />
              <rect x="40" y="74" width="53" height="19" rx="2" fill="#fff" />
            </svg>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#3dd65c', letterSpacing: '0.10em' }}>
            THAI SUMMIT GROUP
          </span>
        </div>
        <span style={{
          fontSize: 11, color: 'rgba(232,245,234,0.26)', letterSpacing: '0.04em',
        }}>
          KPI Performance Intelligence Platform
        </span>
      </footer>
    </div>
  );
}
