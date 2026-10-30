/* ══ 🚀 รุ่น "New Model" (IEC) — เว็บแยกของทีมพาร์ทใหม่ (2026-10-29 · คำสั่ง user) ═══════════
   ไฟล์นี้ถูกสลับเข้ามาแทน `appEdition.js` ตอน build ด้วย `vite.nm.config.js` (alias)
   ⇒ **บิลด์หลักไม่เคย import ไฟล์นี้** · แก้ไฟล์นี้ไม่มีทางกระทบเว็บแมส

   อ่านกติกา/เหตุผลทั้งหมดที่ `src/appEdition.js` (หัวไฟล์) ก่อนแก้
   ═══════════════════════════════════════════════════════════════════════════════════════ */

export const EDITION = 'nm';
export const EDITION_LABEL = 'NEW MODEL · IEC';
export const EDITION_HOME = '/nm-board';

/**
 * หน้าที่เว็บ New Model มี
 *
 * 🔴 **ใส่หน้าเพิ่ม ≠ แจกสิทธิ์** — คนที่เข้าได้ยังตัดสินที่ `role_permissions` เหมือนเดิม
 *    (`engineer_nm` วันนี้ถือ `page:/npi` · `page:/nm-board` · `page:/pe-docs` เท่านั้น)
 *
 * 2 กลุ่มในลิสต์นี้:
 *  ① **หน้าของงาน NM** — เหตุผลที่เว็บนี้มีอยู่
 *  ② **ปลายทางของลิงก์ที่หน้า NM ชี้ไปอยู่แล้ว** — ไม่ใส่ = ลิงก์ในจอกลายเป็นทางตัน
 *     (`/pe-docs` 4 จุด · `/qa-setup` 2 จุด · `/equipment` 1 จุด ใน `NPI.jsx`)
 *     🔴 ทีม IEC **ไม่มีสิทธิ์** 2 ตัวหลังอยู่แล้ว ⇒ ใส่ไว้เพื่อให้ admin ที่เปิดเว็บนี้ตามลิงก์ได้
 *        ไม่ได้เปิดประตูให้ทีม NM แตะงานแมส
 *
 * ⚠️ เพิ่มหน้าใหม่ที่นี่ = ถามตัวเองก่อนว่า "เป็นงาน NM จริงไหม" — เว็บนี้ตั้งใจให้เล็ก
 */
export const EDITION_PAGES = [
  // ① งาน New Model
  '/nm-board',        // 🧭 บอร์ด New Model (IEC) — จอประชุม/จอแขวนของทีม
  '/npi',             // 🚀 พาร์ทใหม่ APQP / PPAP / ECI / Tooling
  // ② ปลายทางของลิงก์ที่มีอยู่ในหน้า NM
  '/pe-docs',         // 📐 Process Flow / PFMEA / Control Plan (ทีม NM ดูได้ แก้ไม่ได้ — `pe:edit` ปิดอยู่)
  '/qa-setup',        // 🔍 มาตรฐานตรวจ + drawing balloon (ผูกกับพาร์ทใน NPI)
  '/equipment',       // 🧰 ทะเบียนแม่พิมพ์/จิ๊ก (แผน tooling อ้าง `die_set_code`)
];

export function inEdition(path) {
  const p = String(path || '').split(/[?#]/)[0];
  return EDITION_PAGES.includes(p);
}
