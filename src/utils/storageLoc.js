/* ═══ 🏬 รหัสคลัง (Storage Location — SAP Stor.Loc.) ═════════════════════════════
   รูปแบบที่ user กำหนด (2026-09-02): **ตัวอักษร 1-3 ตัว + ตัวเลข 3 หลัก** เช่น
     S401 พื้นที่สโตร์เก็บชิ้นส่วน · P401 ผลิต 1 · P402 ผลิต 2
     W401 Warehouse (FG)          · R401 สโตร์เหล็ก (Raw Material)
   ตัวอักษรนำหน้าบอก "ชนิดพื้นที่" → ใช้เดาชนิดตอนตั้งรหัสใหม่ได้ (เสนอ ไม่ใช่บังคับ)

   ⚠️⚠️ คนละเรื่องกับ `storage_zones` (WMS เฟส 1 = โซนกองของที่ตีกรอบบนผังโรงงาน)
        นี่คือ "รหัสบัญชีคลัง" ที่อ้างในทุกบรรทัด BOM แบบ SAP · **ห้ามยุบรวมกัน**

   ⚠️ ทุกไฟล์ที่แตะรหัสคลังต้องใช้ helper ในไฟล์นี้ **ห้ามเขียน regex/format ซ้ำในหน้า**
   ไฟล์นี้ pure — ห้าม import supabase/react (จะได้เทสตรงๆ ได้)

   ═══ ชั้นบัญชี SAP ↔ ชั้นกายภาพ (2026-09-08 · user) ═══════════════════════════════════════
   SAP คุมวัตถุดิบที่ระดับ **พื้นที่ (SLoc)**: P411 = ทั้งแผนก Apron Assy (Line 60 · 61 · Sub Apron) · P409 = ทั้ง Hydroform
   ESM คุมที่ระดับ **ไลน์ย่อยที่สุด** (ของ sub component ของ FG แต่ละตัวอยู่หน้าไลน์ของมัน)
   → ไม่เลือกข้าง: SLoc เป็น "ชั้นบัญชี" ที่ **derive จากไลน์อัตโนมัติ** (`slocOfLine`) แล้วแปะติดทุกรายการตอนเขียน
     (ใบขอเติม · ledger · จุดส่ง) · ผูกที่ไลน์แม่ครั้งเดียวใน `storage_locations.line_names` ลูกตกทอด
   · ตัดสต็อกตอนสโตร์ยืนยันเตรียม = มุม SAP คือ S401 → P411 · มุม WIP ของเราคือ STORE → Line 60 — รายการเดียว 2 มุมมอง
   · ไลน์ที่ยังไม่ผูก = null **ไม่เดา** (จอต้องขึ้น worklist)                                       */
import { getAncestorNames } from './lineHierarchy.js';   // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)

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

/**
 * หา SLoc ของไลน์ — ตรงชื่อก่อน แล้วไล่สายบน (ไลน์ลูกตกทอดจากไลน์แม่ ตั้งครั้งเดียวที่แม่)
 * @param {Array} slocs  แถว storage_locations (ต้องมี code, line_names[], is_active)
 * @param {Array} lines  production_lines (name, parent_line_name)
 * @param {string} lineName
 * @returns {{ code:string, via:string, sloc:object }|null}  via = ชื่อไลน์ที่ผูกไว้จริง (ตัวเองหรือแม่) · null = ยังไม่ผูก **ห้ามเดา**
 */
export function slocOfLine(slocs, lines, lineName) {
  const ln = norm(lineName);
  if (!ln) return null;
  const active = (slocs || []).filter(s => s && s.is_active !== false && Array.isArray(s.line_names));
  const find = (name) => active.find(s => s.line_names.map(norm).includes(name));
  const direct = find(ln);
  if (direct) return { code: slocLabel(direct.code), via: ln, sloc: direct };
  for (const a of getAncestorNames(lines || [], ln)) {
    const hit = find(a);
    if (hit) return { code: slocLabel(hit.code), via: a, sloc: hit };
  }
  return null;
}
export const slocCodeOfLine = (slocs, lines, lineName) => slocOfLine(slocs, lines, lineName)?.code || null;

/** ไลน์ทั้งหมด (รวมลูกหลาน) ที่ตกอยู่ใน SLoc นี้ — ใช้ backfill/สรุปยอด · ไลน์ที่ผูก SLoc อื่นเองชนะแม่ */
export function linesOfSloc(slocs, lines, code) {
  const c = slocLabel(code);
  return (lines || []).map(l => l.name).filter(n => slocCodeOfLine(slocs, lines, n) === c);
}

/* ═══ 🏠 ที่จัดเก็บหลักของพาร์ท (2026-11-05 · คำสั่ง user) ═══════════════════════════════════
   user: *"สโตร์ไม่จำเป็นต้องไปตั้งไลน์ · part master แต่ละตัวควรตั้งได้ว่าที่จัดเก็บหลักอยู่ที่ไหน
          ส่วนไปที่ไหนก็ตามพาร์ทแม่ที่เรียกไปผลิต — 20056789 ผลิตที่ P401 แต่เก็บที่ S402 คนละประเด็นกัน"*
   · กองยอดสต็อกฝั่งคลัง (`STOCK_BUCKETS` = STORE / FG WAREHOUSE) ยังเป็นกองเดียวใน ledger
     แต่ "อยู่พื้นที่ไหน" = **`parts_master.home_sloc` ของพาร์ทนั้น** ไม่ใช่การผูกไลน์ใน storage_locations
   · ไลน์ผลิต = ผูกไลน์เหมือนเดิม (`slocOfLine`) — ปลายทางของสโตร์ = พื้นที่ของไลน์ที่เปิดใบผลิต
   · 🔴 พาร์ทที่ยังไม่ตั้ง = null → จอเขียน "ยังไม่ตั้งที่จัดเก็บ" **ห้ามเดาจากเลข MAT** */
export const STOCK_BUCKETS = ['STORE', 'FG WAREHOUSE'];
export const STORE_SLOC_KINDS = ['store_part', 'raw', 'warehouse'];
export const isStockBucket = (line) => STOCK_BUCKETS.includes(norm(line).toUpperCase());

/** ที่จัดเก็บหลักของ MAT จาก Map(mat → code) · ไม่ตั้ง = null */
export const homeSlocOf = (homeOf, mat) => {
  const c = slocLabel(homeOf?.get?.(norm(mat)));
  return c || null;
};

/** พื้นที่ของ "แถวยอด" (กอง + MAT): กองคลัง = ที่จัดเก็บหลักของพาร์ท · ไลน์ผลิต = ผูกไลน์ (ไล่สายแม่) */
export function slocOfStockRow(slocs, lines, lineName, mat, homeOf) {
  if (isStockBucket(lineName)) {
    const code = homeSlocOf(homeOf, mat);
    return code ? { code, via: 'home', sloc: (slocs || []).find(s => slocLabel(s?.code) === code) || null } : null;
  }
  return slocOfLine(slocs, lines, lineName);
}
export const slocCodeOfStockRow = (...a) => slocOfStockRow(...a)?.code || null;

/* ═══ 📍 "พื้นที่เดียวกัน" ตามรหัส SAP (2026-11-05 · คำสั่ง user) ═══════════════════════════════
   user: *"เราคุยกันที่พื้นที่ที่ตั้งไว้อ้างอิงจาก SAP ไม่สนว่าอยู่ไลน์แม่หรือลูก — GOR · Assy GOR · Laser GOR คือ P410
          ก็นับว่าอยู่ที่เดียวกัน"* ⇒ ความต้องการ/ของคงเหลือ/ใบรอหยิบ ของการเบิกจากสโตร์ คิดรวมทั้งพื้นที่
   · ไลน์ที่ยังไม่ผูกพื้นที่ = คิดเฉพาะไลน์ตัวเอง (`code: null`) — จอต้องเขียนว่ายังไม่ผูก ห้ามเดาไปรวมกับไลน์อื่น */
export function areaLinesOf(slocs, lines, lineName) {
  const ln = norm(lineName);
  const hit = slocOfLine(slocs, lines, ln);
  if (!hit) return { code: null, lines: ln ? [ln] : [] };
  const own = (hit.sloc?.line_names || []).map(norm);
  const all = [...new Set([ln, ...own, ...linesOfSloc(slocs, lines, hit.code)].filter(Boolean))];
  return { code: hit.code, lines: all };
}

/* ═══ 🔀 ของค้าง "ไลน์แม่" ที่พื้นที่ SAP ครอบอยู่แล้ว = ไม่ใช่ปัญหา (2026-11-09 · คำสั่ง user) ═══
   user: *"ถ้าพื้นที่ใช้ร่วมกันก็คือของอยู่ที่พื้นที่นั้น — apron assy ก็ P411 ลูก 60/61/sub apron ก็ P411 ที่เดียวกัน"*
   ตัวตัดสต็อกตอนคอนเฟิร์ม (`fn_area_take` ฝั่ง DR) หักจาก **ทุกไลน์ในพื้นที่เดียวกัน** อยู่แล้ว
   ⇒ ไลน์แม่ที่อยู่พื้นที่เดียวกับลูกทุกตัว = ของถูกหักได้ ไม่ต้องย้าย
   🔴 ต้องตรงกับ SQL `fn_area_lines()` — นับเฉพาะชื่อที่ "ระบุในทะเบียนรหัสคลังเอง" (ไม่ไล่ตกทอดจากแม่)
      ไม่งั้นจอบอกว่าหักได้ แต่ฝั่ง DB หาไม่เจอ = ของค้างเงียบ
   · ไลน์แม่ไม่ได้ผูกพื้นที่ / ลูกแยกหลายพื้นที่ (เช่น Assembly Line D: D1=P404 · D2–D6=P413) = **ยังค้างจริง** คืน false */
export function parentAreaCovers(slocs, lines, parentName) {
  const p = norm(parentName);
  if (!p) return false;
  const kids = (lines || []).filter(l => l && l.is_active !== false && norm(l.parent_line_name) === p).map(l => norm(l.name));
  if (!kids.length) return false;
  const active = (slocs || []).filter(s => s && s.is_active !== false && Array.isArray(s.line_names));
  const home = active.find(s => s.line_names.map(norm).includes(p));
  if (!home) return false;
  const names = new Set(home.line_names.map(norm));
  return kids.every(k => names.has(k));
}
