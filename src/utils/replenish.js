/* ═══ 📥 เติมเต็ม (Replenishment) — "ของลดต่ำกว่า Max เท่าไหร่ ⇒ ต้องเติมเท่าไหร่" ═══════
 *
 * ที่มา (2026-10-20/21 · user): *"ที่จริงระบบกัมบัง มันคือเติมเต็มใช่มั้ย มันควรจะตีกรอบได้ว่า
 * งานลดลงต่ำกว่าค่า max เท่าไหร่แล้ว เพื่อตีกรอบให้เองปะว่าต้องผลิตเท่าไหร่เพื่อเติมให้เต็มค่า max"*
 * และ *"ยิ่งงานที่ไลน์นั้นมี product เดียว ยิ่ง auto ได้เลย"*
 *
 * ── 🔴 กล่องนี้ **ไม่ใช่** ตู้เฮจุนกะ (คำสั่ง user 21/10 "เราควรแยกออกจากตู้เฮจุนกะ") ────
 *   · ตู้เฮจุนกะ = "ใบที่**ปล่อยแล้ว** ทำเวลาไหน" — ในตู้มีแต่ใบจริง
 *   · กล่องเติมเต็ม = "ต้อง**ปล่อย**กี่ใบ" — เป็น **สัญญาณ** ยังไม่ใช่ใบ
 *   เอาสัญญาณไปวาดในตู้ = ตู้มีใบที่ยังไม่มีอยู่จริงปนใบจริง ⇒ **ตู้เริ่มโกหก**
 *   ลำดับที่ถูก: กล่องเติมเต็มคำนวณ → **คนกดออกใบ** → ใบเข้าตู้เฮจุนกะ
 *   ⇒ ไฟล์นี้ **ห้ามสร้างใบ/เขียน DB** · "ระบบเสนอ คนตัดสิน"
 *
 * ── 🔴🔴 กับดักที่ทำให้ตัวเลขนี้ "พังแบบเงียบ" (วัดจริง 20/10 ก่อนเขียนไฟล์นี้) ───────────
 *   332 คู่ไลน์+พาร์ท มี **252 คู่ที่ `qty_on_hand = 0`** ซึ่งแปลว่า **"ไม่ได้นับ" ไม่ใช่ "ของหมด"**
 *   คิดตรงๆ จะได้ "ต้องผลิต 3,071,326 ชิ้น" ⇒ คนเห็นครั้งเดียวก็เลิกเชื่อทั้งจอ
 *   (บทเรียนเดียวกับ §เลิกจุด WIP: *"ยอดที่ไม่มีใครหักออก = ยอดปลอม"*)
 *   ⇒ **ยอดที่เชื่อไม่ได้ ต้องคืน `unknown` ห้ามคืนตัวเลข** · และจอต้องเขียนว่าเชื่อไม่ได้เพราะอะไร
 *
 * ── ⏸️ สถานะ: **ยังไม่มีผู้เรียกใช้ — ตั้งใจ** (21/10) ────────────────────────────────
 *   เขียนสูตรเสร็จแล้วแต่ **ยังไม่ต่อเข้าข้อมูลจริง** เพราะ input ที่มีอยู่เชื่อไม่ได้:
 *   `line_stock_summary.qty_on_hand` **สูงกว่าจริงอย่างเป็นระบบ** (วัดสด 21/10 ทั้งตาราง:
 *   issue 5,177,813 ชิ้น : consume 484,043 = ตัดออกแค่ **9%** · มี `adjust` คนไล่แก้มือ
 *   644 ครั้ง รวม −1,725,279) — มีกฎห้ามใช้เลขนี้ตอบ "ค้างที่ไลน์" อยู่แล้วใน `LineWipPanel.jsx`
 *   🔴 ต่อเข้าไปจะผิด**ด้านที่เงียบที่สุด**: คงเหลือพอง ⇒ บอก "ไม่ต้องเติม" ทั้งที่ต้องเติม
 *   ⇒ สัญญาณที่ถูกคือ **ช่องว่างในตู้คัมบัง** (ป้ายที่ถอดกลับมา = ข้อเท็จจริงทางกายภาพ
 *     ไม่ต้องพึ่งบัญชี) — ยังไม่มีในระบบ รอ user ตัดสินวิธีบันทึก (สแกน / นับต้นกะ / อนุมาน)
 *   **อย่าเพิ่งต่อไฟล์นี้เข้า `qty_on_hand` จนกว่า backflush จะใช้ได้จริง**
 *
 * ไฟล์นี้ pure — ห้าม import supabase/react
 * 📄 docs/modules/kanban-auto-calc.md §เติมเต็ม
 * ═══════════════════════════════════════════════════════════════════════════════════ */

/** ledger เงียบเกินกี่วัน = ยอดคงเหลือเชื่อไม่ได้
 *  (Assy GOR วัดจริง 21/10: ใบเคลื่อนไหวล่าสุด 12/10 = ค้าง 9 วันทั้งที่ไลน์ยังเดิน) */
export const STALE_DAYS = 3;

export const REFILL_STATE = {
  need:    { key: 'need',    label: 'ต้องเติม',        color: '#f59e0b' },
  full:    { key: 'full',    label: 'เต็มแล้ว',         color: '#22c55e' },
  unknown: { key: 'unknown', label: 'ตอบไม่ได้',        color: '#8aa0b4' },
};

/* 🔴 `Number(null)` = 0 และ `Number('')` = 0 — **ทั้งคู่ finite** ⇒ เช็คแค่ isFinite ไม่พอ
   "ไม่มีบัญชี" จะกลายเป็น "มี 0 ชิ้น" แล้วสั่งผลิตเต็ม Max ทันที (กับดักหลักของไฟล์นี้เลย) */
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ห่างกี่วัน — ตอบไม่ได้ = `null` (ห้ามคืน 0 · 0 แปลว่า "วันนี้") */
export function daysSince(iso, now) {
  const a = Date.parse(iso || '');
  const b = Date.parse(now || '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

/**
 * ต้องเติมเท่าไหร่เพื่อให้เต็ม Max
 * @param {number|null} onHand      ยอดคงเหลือที่จุดนั้น · `null` = ไม่มีบัญชี
 * @param {number|null} max         Max ของจุดนั้น · ไม่มี = ตอบไม่ได้
 * @param {number|null} perKanban   ชิ้นต่อ 1 ใบคัมบัง (แปลงชิ้น → จำนวนใบ)
 * @param {string|null} lastMoveAt  เวลาที่ ledger ขยับล่าสุด (ISO) · ไม่มี = ไม่เคยนับ
 * @param {string}      now         เวลาปัจจุบัน (ISO) — **รับเข้ามาเสมอ** เพื่อให้เทสตรึงเวลาได้
 * @returns {{ state:'need'|'full'|'unknown', pcs:number|null, cards:number|null, why:string|null, staleDays:number|null }}
 */
export function refillNeed({ onHand = null, max = null, perKanban = null, lastMoveAt = null, now = null, staleDays = STALE_DAYS } = {}) {
  const miss = (why) => ({ state: 'unknown', pcs: null, cards: null, why, staleDays: null });
  const mx = num(max);
  if (mx == null || mx <= 0) return miss('ยังไม่ตั้ง Max ของจุดนี้');

  const oh = num(onHand);
  /* 🔴 "ไม่มีบัญชี" ≠ "ของหมด" — ตัวนี้คือกับดักหลักของทั้งเรื่อง ห้ามบีบเป็น 0 */
  if (oh == null) return miss('ไม่มีบัญชีคงเหลือของจุดนี้ — ยังนับไม่ได้ว่าขาดเท่าไหร่');
  if (!lastMoveAt) return miss('ยอดคงเหลือไม่เคยถูกบันทึกเลย — เลข 0 ไม่ได้แปลว่าของหมด');

  const age = daysSince(lastMoveAt, now);
  if (age == null) return miss('อ่านเวลาเคลื่อนไหวล่าสุดไม่ได้');
  if (age > staleDays) {
    return { state: 'unknown', pcs: null, cards: null, staleDays: age,
      why: `ยอดคงเหลือค้างมา ${age} วัน (ขยับล่าสุด ${String(lastMoveAt).slice(0, 10)}) — เชื่อเป็นของจริงไม่ได้` };
  }

  const pcs = Math.max(0, Math.round(mx - oh));
  const pk = num(perKanban);
  return {
    state: pcs > 0 ? 'need' : 'full',
    pcs,
    /* ไม่รู้ว่า 1 ใบกี่ชิ้น = บอกเป็นใบไม่ได้ (คืน null ไม่ใช่ 0) แต่ยังบอกเป็น "ชิ้น" ได้ */
    cards: pk != null && pk > 0 ? Math.ceil(pcs / pk) : null,
    why: null,
    staleDays: age,
  };
}

/** สรุปทั้งไลน์ — จอต้องตอบได้ว่า "ตอบไม่ได้กี่รายการ" ไม่ใช่ซ่อนมันไป
 *  @param rows [{ mat_no, part_name, need }] โดย need = ผลของ refillNeed()
 *  @returns {{ need:number, full:number, unknown:number, pcs:number, cards:number|null, coverage:number|null }}
 *   `coverage` = ตอบได้กี่ % ของรายการทั้งหมด (null = ไม่มีรายการเลย) */
export function refillSummary(rows = []) {
  let need = 0, full = 0, unknown = 0, pcs = 0, cards = 0, cardsKnown = false;
  for (const r of rows || []) {
    const s = r?.need?.state;
    if (s === 'need') { need++; pcs += r.need.pcs || 0; if (r.need.cards != null) { cards += r.need.cards; cardsKnown = true; } }
    else if (s === 'full') full++;
    else unknown++;
  }
  const total = need + full + unknown;
  return {
    need, full, unknown, pcs,
    cards: cardsKnown ? cards : null,
    coverage: total ? Math.round(((need + full) / total) * 100) : null,
  };
}
