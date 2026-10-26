/* 📺 useTvShell — "หน้านี้กำลังเปิดบนจอ TV ห้องประชุมไหม" (2026-10-20 · โหมดจอประชุม)
   ตัดสินที่เดียวคือ `isTvShell()` (utils/displayRotation.js) → App ติด class `esm-tv-shell` บน body
   hook นี้แค่อ่าน class นั้น (+ เฝ้าการเปลี่ยน) ⇒ หน้าไม่ต้องรู้ role / query string เอง · **ห้ามเขียนกฎตัดสินชุดที่ 2**
   ใช้คู่กับ `tvSize()` (ขนาดตัวอักษรบนจอประชุม) และ class `.tv-hide` (ซ่อนของที่ไม่มีใครกดในห้องประชุม) — UI §6.32 */
import { useEffect, useState } from 'react';

const read = () => typeof document !== 'undefined' && document.body.classList.contains('esm-tv-shell');

export default function useTvShell() {
  const [tv, setTv] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const mo = new MutationObserver(() => setTv(read()));
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    setTv(read());
    return () => mo.disconnect();
  }, []);
  return tv;
}

/* ขนาดตัวอักษรบนจอประชุม (TV 43–50" · ยืนดู 2–3 ม.) — 1px บนจอ ≈ 0.5–0.57 มม.
   อ่านออกที่ 2–3 ม. ต้องสูง ≥ 7–10 มม. ⇒ เนื้อความ ≥ 22–28px · ตัวเลขหลัก ≥ 48px
   `tvSize(desk, tv)` = ขนาดเดิมบนจอคอม / ขนาดบนจอประชุม (ไม่ต่ำกว่า TV_MIN) */
export const TV_MIN = 20;
export const tvSizer = (isTv) => (desk, tv) => (isTv ? Math.max(TV_MIN, tv ?? Math.round(desk * 1.8)) : desk);
