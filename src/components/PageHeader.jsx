import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../App';
import useIsMobile from '../utils/useIsMobile';

/* ══ 🧭 PageHeader — หัวหน้าเพจมาตรฐาน (breadcrumb + ชื่อหน้า + ปุ่ม + แท็บ) ══════════════
   ทุกหน้าควรขึ้นด้วย component นี้ ห้ามวาดหัวเรื่อง/แถบแท็บเอง
   (ดู docs/NAVIGATION-REVIEW.md — เดิมมีหัวเรื่องแค่ 22 จาก 56 หน้า และแท็บมุมโค้ง 7/8/12 ปนกัน)

   ใช้:
     const [tab, setTab] = useTabParam(['list','kpi'], 'list');
     <PageHeader title="แจ้งซ่อม MTN (MO)" icon="🛠️" sub="ค้างดำเนินการ 3 ใบ"
       actions={<button…/>} tabs={[{key:'list',label:'📋 รายการ MO'},…]} tab={tab} onTab={setTab} />

   • breadcrumb (หมวด › ชื่อหน้า) generate เองจาก NAV_ITEMS ตาม pathname — ไม่ต้องใส่มือ
   • เว้น paddingRight ให้พ้น 🔔 มุมขวาบนตามกติกา UI §7
   • แท็บ: ปุ่มทรงเดียวกันทั้งระบบ · เลื่อนแนวนอนได้บนมือถือ · แท็บที่ถูกเลือกใช้สี accent
   ═════════════════════════════════════════════════════════════════════════════════════════ */

/* ── 🔦 ตัวชี้แท็บที่ "ไถลตาม" + เรืองแสง (2026-09-23 · คำสั่ง user จากคลิป Navigation Tabs V2) ──
   กติกาที่ห้ามลืมถ้ามาแก้ต่อ:
   1. ป้ายแท็บเป็นข้อความไทยยาวไม่เท่ากัน (และ badge ทำให้กว้างเปลี่ยนระหว่างวัน)
      ⇒ **ห้ามคำนวณตำแหน่งจาก index × ความกว้างคงที่แบบในคลิปต้นทาง** ต้องวัดปุ่มจริงเสมอ
   2. วัด `offsetTop` ด้วย ไม่ใช่แค่ `offsetLeft` — เดสก์ท็อปแท็บ wrap ได้ ตัวชี้ต้องย้ายบรรทัดตาม
   3. ตัวชี้อยู่ใน `rowRef` ซึ่งเป็น "เนื้อหา" ของกล่องที่เลื่อนแนวนอน (มือถือ) ⇒ เลื่อนตามเองโดย
      ไม่ต้องดัก event scroll · `rowRef` ต้อง `position:relative` เพราะเป็น offsetParent ของปุ่ม
   4. เฟรมแรกห้ามให้ตัวชี้วิ่งมาจากมุมซ้าย — วัดใน useLayoutEffect (ก่อน paint) แล้วค่อยเปิด transition
   5. เพดาน Chromium 94 (จอ TV): transform/transition/box-shadow/ResizeObserver ผ่านหมด
      **ห้ามใช้ `color-mix()`** — แสงเรืองใช้ตัวแปร `--accent-glow` ใน index.css (มีทั้ง 2 ธีม)      */
const IND_EASE = 'cubic-bezier(.4,1.2,.45,1)';
const prefersReduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function PageHeader({
  title, icon, sub, actions, tabs, tab, onTab, breadcrumb = true, children,
}) {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const navItem = NAV_ITEMS.find(n => n.to === pathname);
  const tabList = (tabs || []).filter(Boolean);
  const tabLabel = tabList.find(t => t.key === tab)?.label;

  const scrollRef = useRef(null);   // กล่องที่เลื่อนแนวนอน (มือถือ)
  const rowRef = useRef(null);      // แถวปุ่ม = offsetParent ของปุ่มและของตัวชี้
  const btnRefs = useRef({});
  const [ind, setInd] = useState(null);       // {x,y,w,h} ของแท็บที่เลือก — null = ยังวัดไม่ได้
  const [animOn, setAnimOn] = useState(false); // เปิด transition หลังเฟรมแรก (กันตัวชี้วิ่งจากมุมซ้าย)

  // ป้ายแท็บ/badge เปลี่ยน = ความกว้างเปลี่ยน ⇒ ต้องวัดใหม่ (ResizeObserver ไม่จับการสลับปุ่ม)
  const sig = tabList.map(t => `${t.key}|${t.label}|${t.badge ?? ''}`).join('~');

  useLayoutEffect(() => {
    Object.keys(btnRefs.current).forEach((k) => {
      if (!tabList.some(t => t.key === k)) delete btnRefs.current[k];
    });
    if (!tabList.length) { setInd(null); return undefined; }

    const measure = () => {
      const el = btnRefs.current[tab];
      if (!el || !rowRef.current) { setInd(null); return; }
      const next = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      setInd(prev => (prev && prev.x === next.x && prev.y === next.y
        && prev.w === next.w && prev.h === next.h) ? prev : next);
    };
    measure();

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(rowRef.current);
      Object.values(btnRefs.current).forEach(el => el && ro.observe(el));
    }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [tab, sig, isMobile]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimOn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // มือถือ: แท็บที่เลือกอาจอยู่นอกจอ — เลื่อน "เฉพาะกล่องแท็บ" เข้ามา ห้ามใช้ scrollIntoView (เลื่อนทั้งหน้า)
  useEffect(() => {
    const sc = scrollRef.current; const el = btnRefs.current[tab];
    if (!sc || !el || sc.scrollWidth <= sc.clientWidth + 1) return;
    const want = Math.max(0, Math.min(el.offsetLeft - (sc.clientWidth - el.offsetWidth) / 2,
      sc.scrollWidth - sc.clientWidth));
    if (Math.abs(sc.scrollLeft - want) > 2) {
      sc.scrollTo({ left: want, behavior: animOn && !prefersReduced() ? 'smooth' : 'auto' });
    }
  }, [tab, sig, animOn]);

  const moving = animOn && !prefersReduced();
  const slide = moving
    ? `transform .28s ${IND_EASE}, width .28s ${IND_EASE}, height .28s ${IND_EASE}`
    : 'none';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
      {breadcrumb && navItem && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
          <button onClick={() => navigate('/')} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
          }}>🏠 หน้าหลัก</button>
          <span>›</span>
          <span>{navItem.group}</span>
          <span>›</span>
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>{navItem.label}</span>
          {tabLabel && <><span>›</span><span style={{ color: 'var(--text2)' }}>{tabLabel}</span></>}
        </div>
      )}

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        justifyContent: 'space-between', paddingRight: 52,   // กัน 🔔 ทับ (UI §7)
      }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 19 : 23, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            {icon && <span>{icon}</span>}{title}
          </h2>
          {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
        </div>
        {actions && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>{actions}</div>}
      </div>

      {!!tabList.length && (
        <div ref={scrollRef} style={{
          overflowX: isMobile ? 'auto' : 'visible',
          paddingTop: 7, paddingBottom: 4,   // เผื่อที่ให้ลำแสง/แสงเรืองไม่โดนกล่องที่เลื่อนตัดหัว
        }}>
          <div ref={rowRef} style={{
            position: 'relative', display: 'flex', gap: 7,
            flexWrap: isMobile ? 'nowrap' : 'wrap',
            width: isMobile ? 'max-content' : 'auto',
          }}>
            {ind && (
              <span aria-hidden="true" data-ux-ok="tab-indicator" style={{
                position: 'absolute', left: 0, top: 0, width: ind.w, height: ind.h,
                transform: `translate3d(${ind.x}px, ${ind.y}px, 0)`,
                borderRadius: 999, background: 'var(--accent)',
                boxShadow: '0 0 13px -2px var(--accent-glow), 0 0 4px -1px var(--accent-glow)',
                transition: slide, pointerEvents: 'none', zIndex: 0,
              }}>
                {/* ลำแสงบนขอบบน — ของเด่นของดีไซน์นี้ (อยู่ในกรอบ paddingTop จึงไม่ถูกตัด)
                    ไล่เฉดให้จางที่ปลายทั้งสองข้าง ไม่งั้นอ่านเป็น "ติ่ง" ที่งอกจากปุ่ม ไม่ใช่แสง */}
                <span style={{
                  position: 'absolute', left: '50%', top: -5, width: '34%', height: 2,
                  transform: 'translateX(-50%)', borderRadius: 2,
                  background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
                  boxShadow: '0 0 10px 1px var(--accent-glow)',
                }} />
              </span>
            )}

            {tabList.map(t => {
              const on = t.key === tab;
              const selfPaint = on && !ind;   // ยังวัดไม่ได้ = ปุ่มทาสีเอง (กันแท็บที่เลือกวูบหาย)
              return (
                <button key={t.key} ref={(el) => { btnRefs.current[t.key] = el; }}
                  onClick={() => onTab && onTab(t.key)} style={{
                    position: 'relative', zIndex: 1,
                    fontSize: 13.5, fontWeight: 700, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
                    whiteSpace: 'nowrap', flexShrink: 0,
                    background: on ? (selfPaint ? 'var(--accent)' : 'transparent') : 'var(--bg3)',
                    color: on ? 'var(--accent-ink)' : 'var(--text)',
                    border: `1px solid ${on ? (selfPaint ? 'var(--accent)' : 'transparent') : 'var(--border2)'}`,
                    transition: moving ? 'color .18s ease' : 'none',
                  }}>
                  {t.label}
                  {t.badge ? <span style={{ marginLeft: 6, color: on ? 'var(--accent-ink)' : '#f59e0b' }}>{t.badge}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
