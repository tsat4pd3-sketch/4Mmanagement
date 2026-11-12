/* ══ 🗂 TabBar — แถบแท็บ "เส้นใต้" มาตรฐานเดียวทั้งระบบ (2026-11-06 · คำสั่ง user "tab ยังไม่เหมือนกัน เอาให้เป็นมาตรฐาน แบบหน้า QA")
   แยกออกมาจาก PageHeader (05/11) เพื่อให้แถบเลือกมุมมอง/เลือกไลน์ที่วาด "ในหน้า" ใช้หน้าตาชุดเดียวกับแท็บหัวเพจ
   — ไม่ใช่แคปซูลทาสี/ชิป (FactoryMap แถวมุมมอง · Heijunka แถวไลน์ เคยเป็นแคปซูล)
   กติกา (ย้ายมาจาก PageHeader — ห้ามลืม):
   1. ป้ายยาวไม่เท่ากัน ⇒ ตัวชี้ต้องวัดจากปุ่มจริง (offsetLeft/Top/Width) ห้ามคำนวณจาก index × ความกว้างคงที่
   2. วัด offsetTop ด้วย — เดสก์ท็อป wrap ได้ ตัวชี้ต้องย้ายบรรทัดตาม · ResizeObserver จับป้ายเปลี่ยนความกว้าง
   3. ตัวชี้อยู่ใน rowRef (position:relative = offsetParent) ⇒ เลื่อนตามกล่องที่สกรอลล์เอง
   4. เฟรมแรกห้ามให้ตัวชี้วิ่งจากมุมซ้าย — วัดใน useLayoutEffect แล้วค่อยเปิด transition
   5. เพดาน Chromium 94 ผ่าน (transform/transition/ResizeObserver) · ไม่มี color-mix
   · `audit` = ติด data-tabbar/data-tab-ind ให้ audit/stdsweep.mjs ไล่กด (เฉพาะแท็บหัวเพจ · แถบในหน้าใช้ data-tabbar-inpage)
   · ห้ามพับแท็บเข้า dropdown (01/10 · คำสั่ง user) — เดสก์ท็อป wrap · มือถือเลื่อนแนวนอน

   ใช้:  <TabBar tabs={[{ key, label, badge?, title? }]} value={tab} onChange={setTab} />
         <TabBar size="sm" … />   // แถบในหน้า (13px) */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useIsMobile from '../utils/useIsMobile';
import useLang from '../utils/useLang';
import { stripIcon } from './Icon';

const IND_EASE = 'cubic-bezier(.4,1.2,.45,1)';
const prefersReduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function TabBar({ tabs, value, onChange, size, audit = false, className, style, right }) {
  const isMobile = useIsMobile();
  const { tr } = useLang();
  const tabList = (tabs || []).filter(Boolean);
  const scrollRef = useRef(null);
  const rowRef = useRef(null);
  const btnRefs = useRef({});
  const [ind, setInd] = useState(null);
  const [animOn, setAnimOn] = useState(false);
  const sig = tabList.map(t => `${t.key}|${t.label}|${t.badge ?? ''}`).join('~');

  useLayoutEffect(() => {
    Object.keys(btnRefs.current).forEach((k) => { if (!tabList.some(t => String(t.key) === k)) delete btnRefs.current[k]; });
    if (!tabList.length) { setInd(null); return undefined; }
    const measure = () => {
      const el = btnRefs.current[String(value)];
      if (!el || !rowRef.current) { setInd(null); return; }
      const next = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      setInd(prev => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) ? prev : next);
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
  }, [value, sig, isMobile]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const id = requestAnimationFrame(() => setAnimOn(true)); return () => cancelAnimationFrame(id); }, []);

  // มือถือ: แท็บที่เลือกอาจอยู่นอกจอ — เลื่อน "เฉพาะกล่องแท็บ" (ห้าม scrollIntoView = เลื่อนทั้งหน้า)
  useEffect(() => {
    const sc = scrollRef.current; const el = btnRefs.current[String(value)];
    if (!sc || !el || sc.scrollWidth <= sc.clientWidth + 1) return;
    const want = Math.max(0, Math.min(el.offsetLeft - (sc.clientWidth - el.offsetWidth) / 2, sc.scrollWidth - sc.clientWidth));
    if (Math.abs(sc.scrollLeft - want) > 2) sc.scrollTo({ left: want, behavior: animOn && !prefersReduced() ? 'smooth' : 'auto' });
  }, [value, sig, animOn]);

  const moving = animOn && !prefersReduced();
  const slide = moving ? `transform .28s ${IND_EASE}, width .28s ${IND_EASE}, height .28s ${IND_EASE}` : 'none';
  const fs = size === 'sm' ? 12.5 : 13.5;
  const pad = size === 'sm' ? '6px 10px' : '8px 12px';
  const barAttr = audit ? { 'data-tabbar': '1' } : { 'data-tabbar-inpage': '1' };

  return (
    <div ref={scrollRef} className={className} style={{ overflowX: isMobile ? 'auto' : 'visible', paddingTop: 2, paddingBottom: 2, ...style }}>
      <div ref={rowRef} {...barAttr} style={{
        position: 'relative', display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', alignItems: 'center',
        flexWrap: isMobile ? 'nowrap' : 'wrap', width: isMobile ? 'max-content' : 'auto',
      }}>
        {ind && (
          <span aria-hidden="true" {...(audit ? { 'data-tab-ind': '' } : {})} style={{
            position: 'absolute', left: 0, top: 0, width: ind.w, height: 2,
            transform: `translate3d(${ind.x}px, ${ind.y + ind.h - 2}px, 0)`,
            borderRadius: 'var(--r-xs)', background: 'var(--accent)', transition: slide, pointerEvents: 'none', zIndex: 1,
          }} />
        )}
        {tabList.map(t => {
          const on = String(t.key) === String(value);
          const selfPaint = on && !ind;
          return (
            <button key={t.key} type="button" ref={(el) => { btnRefs.current[String(t.key)] = el; }} title={t.title}
              onClick={() => onChange && onChange(t.key)} style={{
                position: 'relative', zIndex: 0, fontSize: fs, fontWeight: on ? 700 : 500, padding: pad, borderRadius: 'var(--r-md)', cursor: 'pointer',
                whiteSpace: 'nowrap', flexShrink: 0, background: 'transparent', border: 'none',
                color: on ? 'var(--text)' : 'var(--muted)', boxShadow: selfPaint ? 'inset 0 -2px 0 var(--accent)' : 'none',
                transition: moving ? 'color .18s ease' : 'none',
              }}>
              {stripIcon(tr(t.label))}
              {t.badge ? <span className="ph-tab-badge">{t.badge}</span> : null}
            </button>
          );
        })}
        {right && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{right}</span>}
      </div>
    </div>
  );
}
