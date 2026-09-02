/* ═══ 🏬 รหัสคลัง (Storage Location — SAP Stor.Loc.) ═════════════════════════════
   รูปแบบที่ user กำหนด (2026-09-02): **ตัวอักษร 1-3 ตัว + ตัวเลข 3 หลัก** เช่น
     S401 พื้นที่สโตร์เก็บชิ้นส่วน · P401 ผลิต 1 · P402 ผลิต 2
     W401 Warehouse (FG)          · R401 สโตร์เหล็ก (Raw Material)
   ตัวอักษรนำหน้าบอก "ชนิดพื้นที่" → ใช้เดาชนิดตอนตั้งรหัสใหม่ได้ (เสนอ ไม่ใช่บังคับ)

   ⚠️⚠️ คนละเรื่องกับ `storage_zones` (WMS เฟส 1 = โซนกองของที่ตีกรอบบนผังโรงงาน)
        นี่คือ "รหัสบัญชีคลัง" ที่อ้างในทุกบรรทัด BOM แบบ SAP · **ห้ามยุบรวมกัน**

   ⚠️ ทุกไฟล์ที่แตะรหัสคลังต้องใช้ helper ในไฟล์นี้ **ห้ามเขียน regex/format ซ้ำในหน้า**
   ไฟล์นี้ pure — ห้าม import supabase/react (จะได้เทสตรงๆ ได้)                     */

const norm = (s) => (s ?? '').toString().trim();

/** รูปแบบรหัสคลัง — ตัวอักษร 1-3 ตัว + เลข 3 หลัก (เทียบหลัง normalize เป็นตัวพิมพ์ใหญ่แล้ว) */
export const SLOC_RE = /^[A-Z]{1,3}[0-9]{3}$/;

/** แสดงผล/เก็บลง DB: ตัดช่องว่าง + ตัวพิมพ์ใหญ่
 *  **ไม่ระบุ = '' ห้ามเดาเป็นคลังใดคลังหนึ่ง** (ระบบยังเบิกตามพฤติกรรมเดิม = ตาม line_name) */
export const slocLabel = (s) => norm(s).toUpperCase();

/** ตรงรูปแบบไหม — ว่าง = true (ยังไม่ระบุ ไม่ใช่ "ผิด") */
export const slocValid = (s) => {
  const c = slocLabel(s);
  return c === '' || SLOC_RE.test(c);
};

/** ชนิดพื้นที่ (ป้าย/สี) — ตัวเดียวทั้งระบบ ห้ามพิมพ์ชื่อชนิดซ้ำในหน้า */
export const SLOC_KINDS = {
  store_part: { label: 'สโตร์ชิ้นส่วน',  icon: '📦', color: '#3b82f6' },
  production: { label: 'พื้นที่ผลิต',     icon: '🏭', color: '#22c55e' },
  warehouse:  { label: 'Warehouse (FG)', icon: '🏢', color: '#f59e0b' },
  raw:        { label: 'สโตร์วัตถุดิบ',   icon: '🪨', color: '#a855f7' },
  other:      { label: 'อื่นๆ',           icon: '🏬', color: '#6b7280' },
};

/** ตัวอักษรนำหน้า → ชนิด (ธรรมเนียมที่ user วางไว้)
 *  **คืน null เมื่อเดาไม่ได้ ห้ามยัดเป็น 'other' ให้เอง** — ต่างกัน:
 *  null = "ระบบไม่รู้ ให้คนเลือก" · 'other' = "คนเลือกแล้วว่าไม่เข้าพวก" */
const PREFIX_KIND = { S: 'store_part', P: 'production', W: 'warehouse', R: 'raw' };
export const slocKindGuess = (code) => {
  const c = slocLabel(code);
  if (!SLOC_RE.test(c)) return null;
  return PREFIX_KIND[c[0]] || null;
};

/** ป้ายชนิดสำหรับแสดงผล — ชนิดที่ไม่รู้จักคืนค่ากลาง ไม่พัง */
export const slocKindMeta = (kind) => SLOC_KINDS[kind] || SLOC_KINDS.other;

/** ข้อความอธิบายรูปแบบ (ใช้ทั้ง placeholder และข้อความ error — จะได้ตรงกันเสมอ) */
export const SLOC_FORMAT_HINT = 'รูปแบบ: ตัวอักษร 1-3 ตัว + เลข 3 หลัก (เช่น S401 · P401 · W401 · R401)';
