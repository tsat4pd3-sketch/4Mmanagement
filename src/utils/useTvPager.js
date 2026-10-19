/* 📺 useTvPager — กล่องเนื้อหาของจอ TV ที่ยาวเกินจอ ⇒ ตัดหน้าตาม `[data-tv-item]` แล้วหมุนเองทุก N วินาที
   สูตรตัดหน้า = `tvPages()` (utils/tvPager.js) · หน้าตาแถบบอกหน้า = `components/TvPagerBar.jsx`
   · เลื่อนด้วย `scrollTop` ของกล่อง (overflow:hidden) **ห้ามใช้ transform** — modal `position:fixed`
     ที่อยู่ในกล่องจะยึดกล่องแทนจอ (กับดัก CSS)
   · วัดด้วย offsetTop (ไม่โดน transform ของ framer-motion) · วัดใหม่ทุกครั้งก่อนหมุน + ตอนจอเปลี่ยนขนาด
   · เนื้อหาพอดีจอ / ปิดใช้ (มือถือ · ผู้ใช้กด "เลื่อนเอง") = คืนกล่องเป็นปกติทุกอย่าง */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tvPages } from './tvPager';

const MIN_VIEW_H = 240;   // เตี้ยกว่านี้ (หน้าต่างเล็ก) ไม่ตัดหน้า — ปล่อยเลื่อนเอง

function topWithin(el, box) {
  let y = 0, n = el;
  while (n && n !== box) { y += n.offsetTop; n = n.offsetParent; }
  return n === box ? y : null;
}

export default function useTvPager(boxRef, { enabled = true, intervalSec = 20, dataKey = '' } = {}) {
  const [state, setState] = useState({ pages: [], page: 0, viewH: 0 });
  const [paused, setPaused] = useState(false);
  const pageRef = useRef(0);

  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return null;
    if (!enabled) return { pages: [], viewH: 0 };
    const viewH = Math.floor(window.innerHeight - box.getBoundingClientRect().top - 12);
    if (viewH < MIN_VIEW_H) return { pages: [], viewH: 0 };
    const els = [...box.querySelectorAll('[data-tv-item]')];
    const items = els.map(el => {
      const top = topWithin(el, box);
      return top == null ? null : { top, bottom: top + el.offsetHeight };
    });
    const valid = items.filter(Boolean);
    const contentH = Math.max(box.scrollHeight, ...valid.map(it => it.bottom), 0);
    if (contentH <= viewH + 1) return { pages: [], viewH: 0 };
    const pages = tvPages(valid, viewH);
    // map index ใน valid → element
    const validEls = els.filter((_, i) => items[i]);
    return { pages: pages.map(p => ({ ...p, els: p.items.map(i => validEls[i]) })), viewH, all: validEls };
  }, [boxRef, enabled]);

  const apply = useCallback((m, page) => {
    const box = boxRef.current;
    if (!box || !m) return;
    const active = m.pages.length > 1;
    box.style.position = 'relative';
    box.style.height = active ? `${m.viewH}px` : '';
    box.style.overflow = active ? 'hidden' : '';
    const shown = active ? new Set(m.pages[page]?.els || []) : null;
    box.querySelectorAll('[data-tv-item]').forEach(el => { el.style.visibility = !shown || shown.has(el) ? '' : 'hidden'; });
    box.scrollTop = active ? (m.pages[page]?.start || 0) : 0;
  }, [boxRef]);

  const go = useCallback((delta) => {
    const m = measure();
    if (!m) return;
    const n = Math.max(1, m.pages.length);
    const p = delta === 0 ? Math.min(pageRef.current, n - 1) : ((pageRef.current + delta) % n + n) % n;
    pageRef.current = p;
    apply(m, p);
    setState({ pages: m.pages.map(x => ({ part: x.part || 0, parts: x.parts || 0 })), page: p, viewH: m.viewH });
  }, [measure, apply]);

  // ข้อมูล/ขนาดจอเปลี่ยน = วัดใหม่ คงหน้าเดิม (ถ้ายังมี)
  useLayoutEffect(() => { go(0); }, [go, dataKey]);
  useEffect(() => {
    const t = setTimeout(() => go(0), 600);     // รอแอนิเมชันเข้าจอ/รูปโหลด
    const onR = () => go(0);
    window.addEventListener('resize', onR);
    return () => { clearTimeout(t); window.removeEventListener('resize', onR); };
  }, [go, dataKey]);

  const count = state.pages.length;
  useEffect(() => {
    if (!enabled || paused || count < 2) return undefined;
    const t = setInterval(() => go(1), Math.max(5, intervalSec) * 1000);
    return () => clearInterval(t);
  }, [enabled, paused, count, intervalSec, go]);

  // ปิดใช้ = คืนกล่องเป็นปกติ
  useEffect(() => () => { const box = boxRef.current; if (box) apply({ pages: [] }, 0); }, [boxRef, apply]);

  return {
    page: state.page, pageCount: count, part: state.pages[state.page]?.part || 0, parts: state.pages[state.page]?.parts || 0,
    paused, setPaused, next: () => go(1), prev: () => go(-1),
  };
}
