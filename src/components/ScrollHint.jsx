import { useEffect, useRef, useState } from 'react';
import useIsMobile from '../utils/useIsMobile';

/* ─── ScrollHint — บอก user ว่า "ยังมีเนื้อหาข้างล่าง เลื่อนต่อได้" ──────────────
   ปัญหา: บนมือถือไม่มี scrollbar ให้เห็น → user ไม่รู้ว่าหน้ายังเลื่อนลงได้อีก
   (เคยเกิดจริง: หัวหน้างานไม่เห็นปุ่มบันทึกใน modal เพราะไม่รู้ว่าเลื่อนได้)

   ทำงานยังไง — mount ครั้งเดียวใน App.jsx ไม่ต้องแก้ทีละหน้า:
     · ถ้ามี modal เปิดอยู่ (.overlay / .modal-scroll) → จับตัวนั้นเป็นตัวเลื่อน
       ไม่งั้นจับ document (หน้าเพจปกติ)
     · ยังมีเนื้อหาข้างล่าง → โชว์เงาจางที่ขอบล่าง + ชิป "เลื่อนลง ▾" (กดได้ = เลื่อนให้)
     · เลื่อนถึงล่างสุด/เนื้อหาพอดีจอ → ซ่อนเอง

   กติกา:
     · **มือถือเท่านั้น** (≤768px) — desktop มี scrollbar ให้เห็นอยู่แล้ว ไม่ต้องรบกวน
     · **ห้ามกระพริบ** — ตาม Andon ของโปรเจค การกระพริบสงวนไว้ให้สัญญาณเตือนสีแดงเท่านั้น
     · **ไม่ใช้แถบเงาคลุมขอบล่าง** — ลองแล้วมันบังเนื้อหาแถวล่างสุด และสีเงาไปผูกกับธีม
       (ดำบนธีมสว่างดูผิด) · ชิปข้อความไทยชัดกว่าและไม่บังอะไร
────────────────────────────────────────────────────────────────────────── */

const NEAR_BOTTOM = 24;   // เหลือไม่ถึงเท่านี้ = ถือว่าถึงล่างสุดแล้ว
const MIN_SCROLL  = 40;   // เลื่อนได้น้อยกว่านี้ ไม่ต้องขึ้นชิป (กันขึ้นๆ หายๆ กวนตา)

export default function ScrollHint() {
  const isMobile = useIsMobile();
  const [show, setShow] = useState(false);
  const targetRef = useRef(null);

  useEffect(() => {
    if (!isMobile) { setShow(false); return; }

    // ⚠️ ตัวที่เลื่อนจริงของ "ทั้งหน้า" คือ <body> ไม่ใช่ <html>
    //   เพราะ index.css ตั้ง `html,body{height:100%}` + `overflow-x:hidden` ที่ body
    //   → body กลายเป็น scroll container เอง (document.scrollingElement คืน <html> ซึ่งนิ่ง)
    //   จึงต้องไล่หาตัวที่ scrollHeight > clientHeight จริง ห้าม hardcode scrollingElement
    const pageScroller = () =>
      [document.scrollingElement, document.body, document.documentElement]
        .find(el => el && el.scrollHeight > el.clientHeight + 1) || document.body;

    // ตัวที่กำลังเลื่อนอยู่จริง: modal ที่เปิดล่าสุด (ถ้ามี) ไม่งั้นเป็นทั้งหน้า
    const pickTarget = () => {
      const modals = document.querySelectorAll('.overlay, .modal-scroll');
      const top = modals.length ? modals[modals.length - 1] : null;
      return top && top.scrollHeight > top.clientHeight + 1 ? top : pageScroller();
    };

    const check = () => {
      const el = pickTarget();
      targetRef.current = el;
      if (!el) return setShow(false);
      const rest = el.scrollHeight - el.clientHeight - el.scrollTop;
      const scrollable = el.scrollHeight - el.clientHeight;
      setShow(scrollable > MIN_SCROLL && rest > NEAR_BOTTOM);
    };

    check();
    // capture:true — ให้ได้ scroll event ของตัวเลื่อนข้างในด้วย (scroll ไม่ bubble)
    window.addEventListener('scroll', check, { capture: true, passive: true });
    window.addEventListener('resize', check);
    // เนื้อหาโหลดเพิ่ม/modal เปิด-ปิด → เช็คใหม่
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    const ro = new ResizeObserver(check);
    ro.observe(document.body);
    return () => {
      window.removeEventListener('scroll', check, { capture: true });
      window.removeEventListener('resize', check);
      mo.disconnect(); ro.disconnect();
    };
  }, [isMobile]);

  if (!isMobile || !show) return null;

  const jump = () => {
    const el = targetRef.current;
    if (!el) return;
    el.scrollBy({ top: Math.round(el.clientHeight * 0.72), behavior: 'smooth' });
  };

  return (
    <button onClick={jump} aria-label="เลื่อนลงดูเนื้อหาต่อ" style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 10, zIndex: 10001,
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
        fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
        color: 'var(--text)', background: 'var(--bg3)',
        border: '1px solid var(--border2)', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      }}>
      เลื่อนลงดูต่อ <span style={{ fontSize: 14, lineHeight: 1 }}>▾</span>
    </button>
  );
}
