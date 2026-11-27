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
         <TabBar size="sm" … />   // แถบในหน้า (13px)
         <TabBar scroller after={<ปุ่ม/>} … />   // 24/11: แถวเดียว (25/11 ทุกขนาดจอ) ล้นแล้วมีปุ่ม ◀ ▶ เลื่อน · `after` = ของท้ายแถบ (นอกกล่องเลื่อน)
         · ใช้โดย PageHeader โหมดหัวเพจกะทัดรัด (หมวดใน `STICKY_TAB_GROUPS`) · ไม่ส่ง `scroller` = แบบเดิมเป๊ะ */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useIsMobile from '../utils/useIsMobile';
import useLang from '../utils/useLang';
import { stripIcon } from './Icon';
import { prefersReduced } from '../utils/motion';
import useScrollEdges from '../utils/useScrollEdges';   // ↔️ 18/11: มือถือ แถบที่เลื่อนได้ต้องบอกว่ายังมีต่อ (กฎ Closure)   // 18/11: ของกลางเรื่องขยับ (reduced-motion / perf lite)

const IND_EASE = 'cubic-bezier(.4,1.2,.45,1)';

export default function TabBar({ tabs, value, onChange, size, audit = false, className, style, right, scroller = false, after, arrows }) {
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

  const hscroll = isMobile || scroller;   // กล่องเลื่อนแนวนอน: มือถือเสมอ · จอคอมเฉพาะ `scroller`
  const edges = useScrollEdges(scrollRef, [sig, isMobile, scroller]);
  const moving = animOn && !prefersReduced();
  const slide = moving ? `transform .28s ${IND_EASE}, width .28s ${IND_EASE}, height .28s ${IND_EASE}` : 'none';
  const fs = size === 'sm' ? 12.5 : 13.5;
  const pad = size === 'sm' ? '6px 10px' : '8px 12px';
  const barAttr = audit ? { 'data-tabbar': '1' } : { 'data-tabbar-inpage': '1' };

  /* 📱 ขอบจางซ้าย/ขวาเมื่อแถบล้นจอ (วัดจริง 390px: แท็บสุดท้ายที่เห็นโผล่แค่ 5% ⇒ ไม่มีอะไรบอกว่าปัดต่อได้)
     🔴 โครง DOM ต้องนิ่ง: มือถือ = wrapper เสมอ (ไม่ใช่ "มี wrapper เฉพาะตอนล้น") — ไม่งั้นกล่องเลื่อนถูกสร้างใหม่ตอนสลับ
     แล้ว listener/ResizeObserver ค้างอยู่กับ element เก่าที่ถูกถอด (วัดได้ 0 ⇒ ขอบจางหายทันทีที่เริ่มเลื่อน · เจอจริง 18/11)
     จอคอม overflow visible ⇒ คืน root เดิมเป๊ะ ไม่มี wrapper (desktopdiff 0) */
  const deskScroll = scroller;   // 25/11 (คำสั่ง user "เหมือนจอคอม") — มือถือ/จอแคบก็แถวเดียว + ◀ ▶ แบบเดียวกัน
  const bar = (
    <div ref={scrollRef} className={deskScroll ? 'tabbar-scroller' : (isMobile ? undefined : className)}
      style={{ overflowX: hscroll ? 'auto' : 'visible', paddingTop: 2, paddingBottom: 2, ...(deskScroll ? { flex: 1, minWidth: 0 } : null), ...(isMobile || deskScroll ? null : style) }}>
      <div ref={rowRef} {...barAttr} style={{
        position: 'relative', display: 'flex', gap: 2, borderBottom: deskScroll ? 'none' : '1px solid var(--border)', alignItems: 'center',
        flexWrap: hscroll ? 'nowrap' : 'wrap', width: hscroll ? 'max-content' : 'auto',
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
  /* 🖥️ scroller (จอคอม): แถวเดียวไม่ตัดบรรทัด · ล้นเมื่อไหร่ค่อยมีปุ่ม ◀ ▶ (ปุ่มที่สุดทางแล้ว = จาง กดไม่ได้)
     เส้นใต้ย้ายมาอยู่ที่กรอบนอก ⇒ ยาวเต็มแถวรวมปุ่ม · ป้ายแท็บไม่ถูกบีบ (ห้ามพับเข้า dropdown — กฎเดิม) */
  if (deskScroll) {
    // `arrows="always"` (27/11 มาตรฐานกิจกรรม): ปุ่ม ◀ ▶ มีเสมอ — ไม่ล้น = จางกดไม่ได้ (ตำแหน่งไม่กระโดด)
    const over = arrows === 'always' || edges.left || edges.right;
    const step = (dir) => { const sc = scrollRef.current; if (sc) sc.scrollBy({ left: dir * Math.max(120, sc.clientWidth * 0.7), behavior: prefersReduced() ? 'auto' : 'smooth' }); };
    const arrow = (dir, on) => (
      <button type="button" data-tab-scroll={dir < 0 ? 'left' : 'right'} onClick={() => step(dir)} disabled={!on}
        aria-label={dir < 0 ? tr('เลื่อนแท็บไปทางซ้าย') : tr('เลื่อนแท็บไปทางขวา')} title={dir < 0 ? tr('เลื่อนแท็บไปทางซ้าย') : tr('เลื่อนแท็บไปทางขวา')}
        style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'var(--card)',
          color: on ? 'var(--text)' : 'var(--muted)', opacity: on ? 1 : 0.4, cursor: on ? 'pointer' : 'default', fontSize: 12, lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dir < 0 ? '◀' : '▶'}</button>
    );
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, borderBottom: '1px solid var(--border)', ...style }}>
        {over && arrow(-1, edges.left)}
        {bar}
        {over && arrow(1, edges.right)}
        {after}
      </div>
    );
  }
  if (!isMobile) return bar;
  return (
    <div className={className} style={{ position: 'relative', minWidth: 0, ...style }}>
      {bar}
      {edges.left && <span aria-hidden="true" className="hs-fade-l" />}
      {edges.right && <span aria-hidden="true" className="hs-fade-r" />}
    </div>
  );
}
