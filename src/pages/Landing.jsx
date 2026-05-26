import { useRef, useState } from 'react';
import { motion, useScroll, useTransform, useReducedMotion, useInView } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

/* ── Design tokens ──────────────────────────────────────── */
const C = {
  bg:       '#F7F5F1',
  bg2:      '#EEEAE2',
  dark:     '#0A0908',
  dark2:    '#141210',
  text:     '#1A1A1A',
  muted:    '#5C5550',
  dimmed:   '#8A817A',
  inv:      '#F7F5F1',
  accent:   '#C8522C',
  bLight:   'rgba(26,26,26,0.08)',
  bDark:    'rgba(247,245,241,0.1)',
};

const ease = { outExpo: [0.16,1,0.3,1], outQuint: [0.22,1,0.36,1] };

const NOISE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

/* ── Motion helpers ─────────────────────────────────────── */
function MaskReveal({ children, delay = 0, duration = 1.2 }) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <span style={{ display: 'block', overflow: 'hidden' }}>
      <motion.span
        style={{ display: 'block' }}
        initial={{ y: '110%' }}
        animate={{ y: '0%' }}
        transition={{ duration, delay, ease: ease.outExpo }}
      >{children}</motion.span>
    </span>
  );
}

function Reveal({ children, delay = 0, y = 36 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -8% 0px' });
  const reduced = useReducedMotion();
  return (
    <motion.div ref={ref}
      initial={{ opacity: 0, y: reduced ? 0 : y }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 1.1, delay, ease: ease.outExpo }}
    >{children}</motion.div>
  );
}

/* ── Shared styles ──────────────────────────────────────── */
const px = { padding: '0 clamp(24px, 5vw, 80px)' };
const maxW = { maxWidth: '90rem', margin: '0 auto' };
const labelStyle = {
  fontSize: 11, fontWeight: 500, letterSpacing: '0.22em',
  textTransform: 'uppercase', color: C.muted,
};
const displayFont = {
  fontFamily: "'Fraunces', 'Georgia', serif",
  fontOpticalSizing: 'auto',
};

/* ════════════════════════════════════════════════════════
   NAV
═══════════════════════════════════════════════════════════ */
function Nav({ onLogin }) {
  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      background: 'rgba(247,245,241,0.88)', backdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${C.bLight}`,
    }}>
      <div style={{ ...maxW, ...px, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 64 }}>
        {/* Wordmark */}
        <span style={{ ...displayFont, fontSize: 18, fontWeight: 300, letterSpacing: '-0.02em', color: C.text }}>
          4<em>M</em>
        </span>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ ...labelStyle, marginRight: 8 }}>Management System</span>
          <button onClick={onLogin} style={{
            padding: '8px 20px', border: `1px solid ${C.text}`,
            background: C.text, color: C.inv,
            fontSize: 12, fontWeight: 500, letterSpacing: '0.08em',
            cursor: 'pointer', transition: 'all 300ms',
          }}>
            เข้าสู่ระบบ
          </button>
        </div>
      </div>
    </nav>
  );
}

/* ════════════════════════════════════════════════════════
   HERO — Kinetic Mask Hero (adapted)
═══════════════════════════════════════════════════════════ */
function Hero({ onLogin }) {
  const containerRef = useRef(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ['start start','end start'] });

  const decoY      = useTransform(scrollYProgress, [0,1], ['0%','-18%']);
  const decoOp     = useTransform(scrollYProgress, [0,0.6], [0.055, 0]);
  const headlineY  = useTransform(scrollYProgress, [0,0.5], ['0%','-6%']);
  const headlineOp = useTransform(scrollYProgress, [0,0.5], [1, 0.25]);

  return (
    <section ref={containerRef} style={{
      position: 'relative', minHeight: '100svh', overflow: 'hidden',
      background: C.bg, color: C.text,
    }}>
      {/* Noise */}
      <div aria-hidden style={{
        pointerEvents:'none', position:'absolute', inset:0, zIndex:0,
        opacity: 0.035, mixBlendMode:'multiply', backgroundImage: NOISE,
      }}/>

      {/* Accent gradient */}
      <div aria-hidden style={{
        pointerEvents:'none', position:'absolute', inset:0, zIndex:0,
        background: `radial-gradient(ellipse 80% 60% at 15% 25%, rgba(200,82,44,0.09) 0%, transparent 55%)`,
      }}/>

      {/* Giant decorative "4M" */}
      <motion.div aria-hidden style={{
        position:'absolute', right:'-2%', top:'8%', zIndex:0,
        pointerEvents:'none', userSelect:'none',
        y: reduced ? '0%' : decoY,
        opacity: reduced ? 0.055 : decoOp,
      }}>
        <span style={{
          ...displayFont,
          fontSize: 'clamp(18rem, 38vw, 52rem)',
          fontWeight: 300, lineHeight: 1,
          letterSpacing: '-0.06em', fontStyle: 'italic', color: C.text,
        }}>4M</span>
      </motion.div>

      {/* Content */}
      <motion.div style={{
        position:'relative', zIndex:10,
        ...maxW, ...px,
        display:'flex', flexDirection:'column', justifyContent:'space-between',
        minHeight:'100svh', paddingTop:'clamp(100px,14vw,160px)', paddingBottom: 80,
        y: reduced ? '0%' : headlineY,
        opacity: reduced ? 1 : headlineOp,
      }}>

        {/* Kicker */}
        <MaskReveal delay={0}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ height:1, width:32, background:`${C.text}44` }}/>
            <span style={labelStyle}>ระบบจัดการสายผลิต · 4M System</span>
          </div>
        </MaskReveal>

        {/* Headline */}
        <div style={{ marginTop:'auto', maxWidth:'58rem' }}>
          <h1 style={{
            ...displayFont,
            fontSize: 'clamp(3.2rem,9.5vw,9.5rem)',
            lineHeight: 0.92, letterSpacing: '-0.03em', fontWeight: 300,
            margin: 0,
          }}>
            <MaskReveal delay={0.2}><span style={{ display:'block' }}>ควบคุมสายผลิต</span></MaskReveal>
            <MaskReveal delay={0.35}><span style={{ display:'block', fontStyle:'italic', fontWeight:400 }}>อย่างแม่นยำ.</span></MaskReveal>
          </h1>

          <MaskReveal delay={0.55}>
            <p style={{
              marginTop: 36, maxWidth: 480,
              fontSize: 17, fontWeight: 300, lineHeight: 1.55, color: C.muted,
              fontFamily: 'Inter, system-ui, sans-serif',
            }}>
              บริหารจัดการ Man, Machine, Material และ Method ในสายผลิตของคุณ
              ด้วยระบบที่ออกแบบมาเพื่ออุตสาหกรรมการผลิตโดยเฉพาะ
            </p>
          </MaskReveal>
        </div>

        {/* CTAs + meta */}
        <div style={{
          marginTop: 80,
          display:'flex', flexWrap:'wrap', justifyContent:'space-between', alignItems:'flex-end', gap:32,
        }}>
          <MaskReveal delay={0.75}>
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:24 }}>
              {/* Primary CTA */}
              <button onClick={onLogin} style={{
                display:'flex', alignItems:'center', gap:12,
                padding:'16px 32px', border:`1px solid ${C.text}`,
                background: C.text, color: C.inv,
                fontSize: 13, fontWeight: 500, letterSpacing: '0.06em',
                cursor:'pointer',
              }}>
                เริ่มใช้งาน
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7h12M7 1l6 6-6 6" stroke="currentColor" strokeWidth="1" strokeLinecap="square"/>
                </svg>
              </button>

              {/* Secondary CTA — two-tone underline */}
              <a href="#features" style={{
                position:'relative', fontSize:13, fontWeight:500,
                letterSpacing:'0.06em', color:C.text, textDecoration:'none',
              }}
                className="landing-link"
              >
                <span>ดูการทำงาน</span>
                <span style={{
                  position:'absolute', bottom:-2, left:0, right:0, height:1,
                  background:C.text, transformOrigin:'right', display:'block',
                  transition:'transform 500ms cubic-bezier(0.16,1,0.3,1)',
                }}/>
              </a>
            </div>
          </MaskReveal>

          {/* Meta */}
          <MaskReveal delay={0.9}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:32 }}>
              {[['Version','2.0'], ['Platform','Web · Mobile']].map(([k,v], i) => (
                <div key={i} style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  <span style={labelStyle}>{k}</span>
                  <span style={{
                    ...displayFont, fontSize:15, fontWeight:300,
                    fontStyle:'italic', color:C.text, letterSpacing:'-0.01em',
                  }}>{v}</span>
                </div>
              ))}
            </div>
          </MaskReveal>
        </div>
      </motion.div>

      {/* Bottom hairline */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:1, background:C.bLight }}/>
    </section>
  );
}

/* ════════════════════════════════════════════════════════
   FEATURES — Editorial Index
═══════════════════════════════════════════════════════════ */
const FEATURES = [
  {
    num: '01', title: 'Man',
    titleTh: 'บริหารกำลังคน',
    desc: 'เช็คชื่อพนักงาน, ตรวจ PPE, วางแผนกะ A/B, ติดตามการลา — ทุกอย่างในหน้าเดียว ทั้ง Supervisor และ Leader',
    caption: 'Attendance · PPE · Shift',
  },
  {
    num: '02', title: 'Machine',
    titleTh: 'ติดตามเครื่องจักร',
    desc: 'บันทึกการเปลี่ยนแปลงเครื่องจักร แจ้งเตือนปัญหา ติดตาม 4M Alerts ในทุกไลน์ผลิตแบบ Real-time พร้อม Activity Feed',
    caption: '4M Alerts · Real-time',
    spotlight: true,
  },
  {
    num: '03', title: 'Material',
    titleTh: 'จัดการวัสดุ',
    desc: 'Part Registry, ผัง Line Layout แบบ Interactive — เห็นว่าใครอยู่จุดไหน ใช้วัสดุอะไร ในไลน์ใด',
    caption: 'Parts · Layout · Registry',
  },
  {
    num: '04', title: 'Method',
    titleTh: 'กระบวนการผลิต',
    desc: 'บันทึกการเปลี่ยนแปลงกระบวนการ Standard Manpower ต่อไลน์ Skill Matrix และ KPI Dashboard สรุปผลรายวัน',
    caption: 'KPI · Standard · Skills',
  },
];

function Features() {
  const [hovered, setHovered] = useState(null);
  return (
    <section id="features" style={{ background: C.bg, padding: 'clamp(80px,10vw,160px) 0' }}>
      <div style={{ ...maxW, ...px }}>

        {/* Section header — asymmetric */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:40, marginBottom: 80, alignItems:'end' }}>
          <div>
            <Reveal>
              <span style={labelStyle}>ความสามารถของระบบ</span>
            </Reveal>
            <Reveal delay={0.1}>
              <p style={{
                marginTop:16, fontSize:15, fontWeight:300, lineHeight:1.6,
                color:C.muted, maxWidth:340,
                fontFamily:'Inter, system-ui, sans-serif',
              }}>
                ครอบคลุมทุกมิติของการจัดการสายผลิต ตาม Framework 4M ที่โรงงานใช้จริง
              </p>
            </Reveal>
          </div>
          <div>
            <Reveal delay={0.15}>
              <h2 style={{
                ...displayFont,
                fontSize:'clamp(2.2rem,5vw,4.5rem)',
                fontWeight:300, lineHeight:0.95, letterSpacing:'-0.025em',
                margin:0, color:C.text,
              }}>
                <span style={{ display:'block' }}>ทุกอย่างที่โรงงาน</span>
                <span style={{ display:'block', fontStyle:'italic', fontWeight:400 }}>ต้องการ.</span>
              </h2>
            </Reveal>
          </div>
        </div>

        {/* Index rows */}
        {FEATURES.map((f, i) => (
          f.spotlight
            ? <SpotlightRow key={f.num} feature={f} i={i} />
            : <IndexRow key={f.num} feature={f} i={i} hovered={hovered} setHovered={setHovered} />
        ))}
      </div>
    </section>
  );
}

function IndexRow({ feature: f, i, hovered, setHovered }) {
  const isHov = hovered === f.num;
  return (
    <Reveal delay={i * 0.06}>
      <div
        onMouseEnter={() => setHovered(f.num)}
        onMouseLeave={() => setHovered(null)}
        style={{
          position:'relative', display:'grid',
          gridTemplateColumns:'80px 1fr 1fr auto',
          gap:24, alignItems:'center',
          padding:'28px 0',
          borderTop: `1px solid ${C.bLight}`,
          cursor:'default', overflow:'hidden',
          transition:'background 600ms',
        }}
      >
        {/* Hover wash */}
        <div style={{
          position:'absolute', inset:0, pointerEvents:'none',
          background:`linear-gradient(90deg, ${C.bg2} 0%, transparent 80%)`,
          opacity: isHov ? 1 : 0, transition:'opacity 500ms',
        }}/>

        {/* Number */}
        <span style={{
          ...displayFont, fontSize:'clamp(1.6rem,3vw,2.2rem)', fontWeight:300,
          color: C.text, letterSpacing:'-0.02em',
          transform: isHov ? 'translateX(8px)' : 'translateX(0)',
          transition:'transform 500ms cubic-bezier(0.16,1,0.3,1)',
          position:'relative',
        }}>{f.num}</span>

        {/* Title */}
        <div style={{ position:'relative' }}>
          <div style={{ ...displayFont, fontSize:'clamp(1.1rem,2vw,1.6rem)', fontWeight:300, color:C.text, letterSpacing:'-0.01em' }}>
            {f.title}
            <em style={{ marginLeft:8, color:C.muted, fontSize:'0.7em' }}>/ {f.titleTh}</em>
          </div>
        </div>

        {/* Description */}
        <p style={{
          fontSize:14, lineHeight:1.6, color:C.muted, margin:0,
          fontFamily:'Inter, system-ui, sans-serif', fontWeight:300,
        }}>{f.desc}</p>

        {/* Caption */}
        <span style={{
          ...labelStyle, fontSize:10, textAlign:'right', whiteSpace:'nowrap',
          opacity: isHov ? 1 : 0.45, transition:'opacity 400ms',
        }}>{f.caption}</span>
      </div>
    </Reveal>
  );
}

function SpotlightRow({ feature: f, i }) {
  return (
    <Reveal delay={i * 0.06}>
      <div style={{
        position:'relative', overflow:'hidden',
        background: C.dark2, borderRadius:0,
        padding:'clamp(40px,6vw,72px)', margin:'0 clamp(-24px,-5vw,-80px)',
        display:'grid', gridTemplateColumns:'1fr 1fr', gap:48, alignItems:'center',
      }}>
        {/* Accent gradient top-right */}
        <div aria-hidden style={{
          position:'absolute', top:0, right:0,
          width:400, height:400, borderRadius:'50%', pointerEvents:'none',
          background:`radial-gradient(circle, rgba(200,82,44,0.12) 0%, transparent 65%)`,
          transform:'translate(30%,-30%)',
        }}/>
        {/* Noise */}
        <div aria-hidden style={{
          position:'absolute', inset:0, pointerEvents:'none',
          opacity:0.05, mixBlendMode:'overlay', backgroundImage:NOISE,
        }}/>

        {/* Left: big number + title */}
        <div style={{ position:'relative' }}>
          <span style={{
            ...displayFont,
            fontSize:'clamp(5rem,12vw,9rem)', fontWeight:300, lineHeight:1,
            letterSpacing:'-0.05em', color:'rgba(247,245,241,0.12)',
            display:'block', marginBottom:8,
          }}>{f.num}</span>
          <h3 style={{
            ...displayFont,
            fontSize:'clamp(2rem,4vw,3.5rem)', fontWeight:300, lineHeight:0.95,
            letterSpacing:'-0.025em', color:C.inv, margin:0,
          }}>
            <span style={{ display:'block' }}>{f.title}</span>
            <span style={{ display:'block', fontStyle:'italic', fontWeight:400, color:C.accent }}>{f.titleTh}</span>
          </h3>
        </div>

        {/* Right: desc + caption */}
        <div style={{ position:'relative' }}>
          <p style={{
            fontSize:16, lineHeight:1.65, color:'rgba(247,245,241,0.65)',
            margin:'0 0 24px', fontFamily:'Inter, system-ui, sans-serif', fontWeight:300,
          }}>{f.desc}</p>
          <span style={{ ...labelStyle, color: C.accent, fontSize:10 }}>{f.caption}</span>
        </div>
      </div>
    </Reveal>
  );
}

/* ════════════════════════════════════════════════════════
   STATS
═══════════════════════════════════════════════════════════ */
const STATS = [
  { num:'4', label:'ไลน์ผลิต', sub:'PD1–PD4' },
  { num:'100%', label:'Real-time', sub:'ข้อมูล Live' },
  { num:'4M', label:'Framework', sub:'Man·Machine·Material·Method' },
  { num:'∞', label:'บันทึก', sub:'Unlimited logs' },
];

function Stats() {
  return (
    <section style={{ background:C.bg2, padding:'clamp(60px,8vw,120px) 0', borderTop:`1px solid ${C.bLight}`, borderBottom:`1px solid ${C.bLight}` }}>
      <div style={{ ...maxW, ...px, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:48 }}>
        {STATS.map((s,i)=>(
          <Reveal key={s.label} delay={i*0.1}>
            <div>
              <div style={{
                ...displayFont,
                fontSize:'clamp(3rem,7vw,6rem)', fontWeight:300,
                lineHeight:1, letterSpacing:'-0.04em', color:C.text,
              }}>{s.num}</div>
              <div style={{ marginTop:12, fontSize:13, fontWeight:500, color:C.text, letterSpacing:'0.04em' }}>{s.label}</div>
              <div style={{ marginTop:4, fontSize:12, color:C.muted }}>{s.sub}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════
   CTA — Moment CTA (dark section)
═══════════════════════════════════════════════════════════ */
function CTA({ onLogin }) {
  const containerRef = useRef(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: containerRef, offset:['start end','end start'] });
  const decoY = useTransform(scrollYProgress,[0,1],['10%','-10%']);
  const decoOp = useTransform(scrollYProgress,[0,0.3,0.7,1],[0,0.07,0.07,0]);

  return (
    <section ref={containerRef} style={{
      position:'relative', minHeight:'88vh', overflow:'hidden',
      background:C.dark2, color:C.inv,
      display:'flex', flexDirection:'column', justifyContent:'center',
      padding:'clamp(80px,10vw,140px) 0',
    }}>
      {/* Gradients */}
      <div aria-hidden style={{
        position:'absolute', inset:0, pointerEvents:'none',
        background:`radial-gradient(ellipse 70% 60% at 10% 20%, rgba(200,82,44,0.12) 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 90% 80%, rgba(217,194,164,0.08) 0%, transparent 55%)`,
      }}/>
      {/* Noise */}
      <div aria-hidden style={{
        position:'absolute', inset:0, pointerEvents:'none',
        opacity:0.05, backgroundImage:NOISE,
      }}/>
      {/* Giant "&" */}
      <motion.div aria-hidden style={{
        position:'absolute', bottom:'-20%', right:'-6%',
        pointerEvents:'none', userSelect:'none', lineHeight:1,
        y: reduced ? 0 : decoY, opacity: reduced ? 0.06 : decoOp,
      }}>
        <span style={{
          ...displayFont,
          fontSize:'clamp(20rem,50vw,60rem)',
          fontWeight:300, fontStyle:'italic', color:C.inv,
          letterSpacing:'-0.06em',
        }}>&</span>
      </motion.div>

      <div style={{ position:'relative', zIndex:10, ...maxW, ...px }}>
        <Reveal><span style={{ ...labelStyle, color:'rgba(247,245,241,0.4)' }}>เริ่มต้นวันนี้</span></Reveal>
        <h2 style={{
          ...displayFont,
          fontSize:'clamp(3rem,8.5vw,8.5rem)',
          fontWeight:300, lineHeight:0.93, letterSpacing:'-0.03em',
          margin:'24px 0 48px', color:C.inv,
        }}>
          <MaskReveal delay={0.1}><span style={{ display:'block' }}>พร้อมที่จะ</span></MaskReveal>
          <MaskReveal delay={0.25}><span style={{ display:'block' }}>ยกระดับ</span></MaskReveal>
          <MaskReveal delay={0.4}><span style={{ display:'block', fontStyle:'italic', fontWeight:400 }}>สายผลิตของคุณ?</span></MaskReveal>
        </h2>

        <Reveal delay={0.5}>
          <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:24 }}>
            <button onClick={onLogin} style={{
              display:'flex', alignItems:'center', gap:12,
              padding:'18px 36px', background:C.inv, color:C.dark,
              border:'none', fontSize:14, fontWeight:500,
              letterSpacing:'0.06em', cursor:'pointer',
            }}>
              เข้าสู่ระบบ
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 7h12M7 1l6 6-6 6" stroke="currentColor" strokeWidth="1" strokeLinecap="square"/>
              </svg>
            </button>
            <span style={{ fontSize:13, color:'rgba(247,245,241,0.45)', fontStyle:'italic', ...displayFont, fontWeight:300 }}>
              สำหรับโรงงานและสายผลิตทุกขนาด
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════
   FOOTER
═══════════════════════════════════════════════════════════ */
function Footer({ onLogin }) {
  return (
    <footer style={{ background:C.dark, borderTop:`1px solid ${C.bDark}`, padding:'clamp(48px,6vw,80px) 0 32px' }}>
      <div style={{ ...maxW, ...px }}>
        {/* Top */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:32, paddingBottom:48, borderBottom:`1px solid ${C.bDark}` }}>
          {/* Brand */}
          <div>
            <div style={{ ...displayFont, fontSize:32, fontWeight:300, fontStyle:'italic', color:C.inv, letterSpacing:'-0.02em', marginBottom:16 }}>4M</div>
            <p style={{ fontSize:13, color:'rgba(247,245,241,0.4)', lineHeight:1.6, margin:0, fontWeight:300 }}>
              ระบบจัดการสายผลิต<br/>Man · Machine · Material · Method
            </p>
          </div>
          {/* Links */}
          <div>
            <div style={{ ...labelStyle, color:'rgba(247,245,241,0.3)', marginBottom:20, fontStyle:'italic', ...displayFont, fontSize:13, letterSpacing:'normal', textTransform:'none' }}>
              ระบบ
            </div>
            {['Dashboard','เช็คชื่อ & PPE','จัดการสายผลิต','ตารางกะ','รายงาน'].map(l => (
              <div key={l} style={{ marginBottom:10 }}>
                <button onClick={onLogin} style={{
                  background:'none', border:'none', padding:0, cursor:'pointer',
                  fontSize:12, color:'rgba(247,245,241,0.45)', letterSpacing:'0.1em',
                  textTransform:'uppercase', fontFamily:'inherit',
                }}>{l}</button>
              </div>
            ))}
          </div>
          {/* Info */}
          <div>
            <div style={{ ...labelStyle, color:'rgba(247,245,241,0.3)', marginBottom:20, fontStyle:'italic', ...displayFont, fontSize:13, letterSpacing:'normal', textTransform:'none' }}>
              ข้อมูล
            </div>
            {['Supabase · PostgreSQL','React 19 · Vite','Framer Motion','Render.com Deploy'].map(l => (
              <div key={l} style={{ marginBottom:10, fontSize:12, color:'rgba(247,245,241,0.3)', letterSpacing:'0.08em', textTransform:'uppercase' }}>{l}</div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:24, flexWrap:'wrap', gap:16 }}>
          <span style={{ ...displayFont, fontSize:13, fontStyle:'italic', fontWeight:300, color:'rgba(247,245,241,0.25)' }}>
            4M Management System
          </span>
          <span style={{ fontSize:11, color:'rgba(247,245,241,0.2)', letterSpacing:'0.15em', textTransform:'uppercase' }}>
            © 2026 · All rights reserved
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ════════════════════════════════════════════════════════
   PAGE
═══════════════════════════════════════════════════════════ */
export default function Landing() {
  const navigate = useNavigate();
  const goLogin = () => navigate('/login');

  return (
    <div style={{ fontFamily:'Inter, system-ui, sans-serif', background:C.bg }}>
      <Nav onLogin={goLogin} />
      <Hero onLogin={goLogin} />
      <Features />
      <Stats />
      <CTA onLogin={goLogin} />
      <Footer onLogin={goLogin} />
    </div>
  );
}
