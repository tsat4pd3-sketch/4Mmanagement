/* ═══ ✂️ ปิดใบด้วย "ยอดเศษ" — ผลิตไม่เต็ม packing แต่ส่งเข้ากระบวนการถัดไปแล้ว ═══════════
   ที่มา (2026-10-02 · คำสั่ง user): *"งานปั๊ม พวกเบอร์ 2 ผลิตไม่เต็ม packing แต่ต้องส่งไป
   กระบวนการถัดไป ต้องทำยังไง · และใบออเดอร์นั้นจะถูกแก้จำนวนใน SAP ให้ตรงตามยอดเศษ"*
   และ *"แบบ ข คือแบบปัจจุบันที่มี ก็ใช้ได้ · ยิ่งงาน 1xx ส่งเศษไม่ได้เลย"*

   ── 2 ทางที่ต่างกันคนละเรื่อง — ห้ามยุบเป็นปุ่มเดียว ─────────────────────────────────────
   (ข) **ยกยอดต่อ** (`carry_over` · ของเดิม ไม่แตะ) — ส่งของที่ทำได้ไปก่อน **ส่วนที่เหลือยังต้องทำ**
       ใบไปโผล่ที่กะถัดไปให้ทำต่อจนครบ · ใบ SAP ยังเป็นจำนวนเดิม
   (ก) **ปิดด้วยยอดเศษ** (ใหม่) — เศษนั้น **จบใบเลย** ไม่มีอะไรค้าง
       `qty` ของใบถูกแก้ให้เท่ายอดจริง แล้ว**ทีมวางแผนไปแก้จำนวนใบสั่งใน SAP ให้ตรงกัน**

   🔴 **1xx (FG ส่งลูกค้า) ใช้ (ก) ไม่ได้เด็ดขาด** — ของส่งลูกค้าต้องครบกล่องตามที่ตกลง
      ส่งเศษไม่ได้ ⇒ เหลือทางเดียวคือยกยอดไปทำต่อให้ครบ
      (เบอร์ 2xx = child part ผลิตเอง ส่งเข้ากระบวนการถัดไปในโรงงาน — เศษส่งได้)

   ── ทำไมต้องเขียนทั้ง `qty` และ `qty_ok` ──────────────────────────────────────────────
   trigger ฝั่ง DR อ่านคนละคอลัมน์กัน (ตรวจจาก pg_proc จริง 02/10):
     · `fn_post_confirmed_output` (เติมสต็อกปลายทาง) → `coalesce(qty_ok, qty)`
     · `fn_explode_child_demand`  (ระเบิด BOM หักของ) → `qty` ตรงๆ
   ⇒ เขียนตัวเดียวไม่พอ: เขียนแต่ `qty_ok` = BOM ยังหักของตามเป้าเต็ม (หักเกินจริง)
     เขียนแต่ `qty` = ตรงกันบังเอิญ แต่ `qty_ok` ค้างค่าเก่า ⇒ ของเข้าคลังผิด
   **เป้าเดิมเก็บไว้ที่ `qty_target`** (ห้ามทิ้ง — ไม่งั้นสืบไม่ได้ว่าใบนี้เคยสั่งเท่าไหร่
   และจอ "ผลิตได้กี่ % ของเป้า" จะอ่านว่าทำครบ 100% ทุกใบ)

   ไฟล์นี้ pure — ห้าม import supabase/react (จะได้เทสตรงๆ ได้)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { matClassOf } from './matPrefix.js';

/** คลาส MAT ที่ "ส่งเศษเข้ากระบวนการถัดไปไม่ได้" — ของส่งลูกค้าต้องครบตามที่ตกลง */
export const NO_SHORT_CLOSE = ['fg'];

/**
 * ใบนี้ปิดด้วยยอดเศษได้ไหม (ดูที่ "ชนิดของ" ไม่ใช่ที่ไลน์)
 * @param {string} matNo
 * @returns {{ ok:boolean, reason:string|null }}
 *          ok=false พร้อมเหตุผลที่เขียนบนจอได้ · MAT ที่ระบบตีคลาสไม่ออก = **อนุญาต**
 *          (ไม่ใช่เลข SAP 8 หลัก เช่นเลขภายใน 9xx — ไม่ใช่ของส่งลูกค้าแน่ ห้ามบล็อกการทำงาน)
 */
export function canShortClose(matNo) {
  const cls = matClassOf(matNo);
  if (cls && NO_SHORT_CLOSE.includes(cls.key)) {
    return { ok: false, reason: `${cls.label} — ของส่งลูกค้าต้องครบตามที่ตกลง ส่งเศษไม่ได้ ⇒ ใช้ "ยกยอดต่อ" ให้ทำต่อจนครบ` };
  }
  return { ok: true, reason: null };
}

/**
 * ตรวจยอดเศษก่อนปิด
 * @param {number|string} qty   ยอดที่ทำได้จริง
 * @param {number} target       เป้าของใบ (จำนวนตามการ์ด/ที่สั่ง)
 * @returns {string|null} ข้อความ error · null = ผ่าน
 */
export function shortCloseError(qty, target) {
  const q = Number(qty);
  const t = Number(target) || 0;
  if (!Number.isFinite(q) || q <= 0) return 'กรอกยอดที่ทำได้จริง (ต้องมากกว่า 0)';
  if (t > 0 && q > t) return `ทำได้ ${q} เกินเป้าของใบ (${t}) — เกินเป้าไม่ใช่ "ยอดเศษ"`;
  if (t > 0 && q === t) return 'ยอดเท่าเป้าพอดี = ผลิตครบ — กดปุ่ม "ผลิตครบแล้ว" แทน';
  return null;
}

/**
 * คอลัมน์ที่ต้องเขียนตอนปิดด้วยยอดเศษ
 * @param {object} order  ใบเดิม ({ qty, qty_target, mat_no, prod_no })
 * @param {number} qty    ยอดที่ทำได้จริง
 * @param {object} [meta] { by, stoppedAt }
 * @returns {object} payload สำหรับ update (ไม่รวม id)
 */
export function shortClosePatch(order, qty, { by, stoppedAt } = {}) {
  const q = Number(qty) || 0;
  // เป้าเดิม: ใบที่เคยถูกปิดเศษมาก่อนต้องไม่เสียเป้าตั้งต้น (qty_target ชนะ qty เสมอ)
  const target = Number(order?.qty_target) || Number(order?.qty) || 0;
  return {
    status: 'confirmed',
    qty: q,            // fn_explode_child_demand อ่านตัวนี้ — BOM ต้องหักตามของที่ทำจริง
    qty_ok: q,         // fn_post_confirmed_output อ่าน coalesce(qty_ok, qty)
    qty_actual: q,
    qty_target: target,
    qty_updated_at: new Date().toISOString(),
    ...(stoppedAt ? { stopped_at: stoppedAt, confirmed_at: stoppedAt } : {}),
    confirmed_by: by || null,
    /* 🔴 ต้องเขียนไว้ว่า "ใบนี้ถูกตัดยอด" — ไม่งั้นเดือนหน้าไม่มีใครรู้ว่าทำไมใบ 60 เหลือ 47
       และทีมวางแผนต้องเห็นว่าต้องไปแก้ SAP ใบไหนบ้าง */
    carry_over_note: `ปิดด้วยยอดเศษ: ทำได้ ${q}/${target} ชิ้น — ส่งเข้ากระบวนการถัดไปแล้ว `
                   + `· ยอดที่เหลือ ${Math.max(0, target - q)} ชิ้นไม่ต้องทำต่อ `
                   + `· ⚠ แก้จำนวนใบสั่งใน SAP ให้เป็น ${q}`,
  };
}

/** ใบนี้ถูกปิดด้วยยอดเศษไหม (ไว้ติดป้ายบนจอ/ทำ worklist แก้ SAP) */
export const isShortClosed = (o) =>
  o?.status === 'confirmed' && Number(o?.qty_target) > 0 && Number(o?.qty_target) > Number(o?.qty);
