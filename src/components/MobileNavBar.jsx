import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useIsMobile from '../utils/useIsMobile';
import { canAccessPage } from '../utils/permissions';

/* ══ 📱 MobileNavBar — แถบล่าง 4 ช่องของจอมือถือ/handheld (2026-10-15 · docs/MOBILE-UX-STANDARD.md §3) ══════
   ทำไม: ปุ่ม ☰ มุมซ้ายบน "นิ้วโป้งไม่ถึง" เมื่อถือเครื่องมือเดียว (คนหน้างานอีกมือถือชิ้นงาน/ใส่ถุงมือ) และลอยทับ
   เนื้อหาตลอดเวลาที่เลื่อน · แอปมือถือมาตรฐาน (Material navigation bar / iOS tab bar) วางปลายทางหลัก 3–5 ช่องล่างจอ
   · 🏠 หน้าหลัก · 📷 สแกนป้าย (handheld = สแกนเนอร์) · 🔎 ค้นหาเมนู (CommandPalette ตัวเดิม) · ☰ เมนูเต็ม (Sidebar ตัวเดิม)

   🔴 กติกา (ห้ามแหก):
   1. **มือถือเท่านั้น** — จอคอม return null และตัวแปร `--mnav-h` ไม่ถูกตั้ง (= 0) ⇒ จอคอมเท่าเดิมทุกพิกเซล
   2. ความสูงแถบอยู่ใน `--mnav-h` (ตั้งผ่าน class `has-mnav` ที่ <body>) — ของที่ลอยชิดล่างจอ (toast/ไซเรน/ชิปเลื่อน/
      ปุ่มลอย ที่เป็น `position: fixed`) **ต้องบวก `var(--mnav-h, 0px)`** ไม่งั้นโดนแถบทับ · <body> ได้ padding-bottom เท่าแถบ
      ⇒ **`position: sticky; bottom` ห้ามบวก** (body = ตัวเลื่อน · padding หดกรอบ sticky ให้แล้ว · บวกซ้ำ = ลอยสูงเกิน 56px วัดจริง 15/10)
   3. คีย์บอร์ดเปิด (visualViewport หดเกิน 25%) = ซ่อนแถบ — ไม่งั้นแถบดันขึ้นมาเกาะเหนือคีย์บอร์ด กินจอที่เหลือ ~300px
   4. z-index ต่ำกว่าโมดัล (.overlay = 1000) ⇒ เปิดโมดัลแล้วแถบอยู่ใต้ฉาก ไม่แย่งปุ่มบันทึกของโมดัล
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
export const MNAV_H = 56;

export default function MobileNavBar({ role, onOpenMenu, onOpenSearch }) {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [kbOpen, setKbOpen] = useState(false);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const check = () => setKbOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);

  const show = isMobile && !kbOpen;
  useEffect(() => {
    if (!show) return undefined;
    document.body.classList.add('has-mnav');
    return () => document.body.classList.remove('has-mnav');
  }, [show]);

  if (!show) return null;

  const items = [
    { key: 'home', icon: '🏠', label: 'หน้าหลัก', on: pathname === '/', go: () => navigate('/') },
    canAccessPage('/scan', role) && { key: 'scan', icon: '📷', label: 'สแกน', on: pathname === '/scan', go: () => navigate('/scan') },
    onOpenSearch && { key: 'search', icon: '🔎', label: 'ค้นหาเมนู', on: false, go: onOpenSearch },
    onOpenMenu && { key: 'menu', icon: '☰', label: 'เมนู', on: false, go: onOpenMenu },
  ].filter(Boolean);

  return (
    <nav className="mnav" aria-label="เมนูลัด">
      {items.map(it => (
        <button key={it.key} type="button" onClick={it.go} aria-current={it.on ? 'page' : undefined}
          className={it.on ? 'on' : ''}>
          <span className="mnav-ico" aria-hidden="true">{it.icon}</span>
          <span className="mnav-lbl">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
