/* familyTotals — ยอดผลิตสะสมต่อ "ตระกูลสินค้า" (family_id) · ของกลางจุดเดียว (2026-10-15 · QC audit)

   🔴 ทำไมต้องมีไฟล์นี้ — ของเดิมผิด 2 ชั้นซ้อนกันใน 2 จอ (`/products` + `/daily-report` แท็บสินค้า):
     (1) คิวรี `production_sessions.select('product_id, qty_ok, dr_products(family_id)')`
         **ไม่มี filter ไม่มี .order()** แล้วบวกเองในหน้า — วัดจริง 15/10 ตารางนี้ **1,675 แถว**
         ⇒ PostgREST คืนแค่ 1,000 แถวแรก และได้ **คนละชุดทุกครั้งที่โหลด** (กฎเหล็ก DB ข้อ 5)
     (2) 🔴 หนักกว่า: `production_sessions.product_id` = **NULL ทั้ง 1,675 แถว** ⇒ join ไม่ติดเลย
         ⇒ ยอดเป็น `{}` ตลอด · จอเขียน `{totalQty > 0 && …}` ⇒ **ชิปถูกซ่อนเงียบมาตลอด**
         ไม่มีใครรู้ว่าฟีเจอร์ตาย (= เคสคลาสสิกของ "ห้ามซ่อนแผงเมื่อข้อมูลไม่มา")

   ✅ แหล่งจริง = `prod_orders` (qty_ok รวม 1.2M ชิ้น) ผูก family ด้วย `mat_no` · รวมฝั่ง DB
      ผ่าน RPC `dr_family_qty_totals()` (migration 20261015c) — ไม่ลากแถวดิบมาบวกในเบราว์เซอร์
      วัดผลหลังแก้ 15/10: **128 family · 1,197,048 ชิ้น**

   ⚠️ คืน **object ธรรมดา** `{ totals, fail }` — ห้ามแกะ `{ data }` (กฎเหล็ก DB ข้อ 12)
   ⚠️ อ่านไม่ได้ ⇒ `fail: true` + `totals: {}` · **จอต้องเขียนบนจอว่าอ่านไม่ได้ ห้ามโชว์ 0 ห้ามซ่อนชิป** */
/* ⚠️ import client แบบ lazy — ให้ตัวตัดสินป้าย (pure) เทสได้ด้วย node:test ตรงๆ
   ไม่ต้องลาก supabaseClient + env เข้ามาทั้งก้อน (module ถูก cache อยู่แล้ว ไม่มีผลกับความเร็ว) */
/** @returns {Promise<{ totals: Record<string, number>, fail: boolean, error: string|null }>} */
export async function loadFamilyQtyTotals() {
  const { supabaseDR } = await import('../supabaseClient');
  const { data, error } = await supabaseDR.rpc('dr_family_qty_totals');
  if (error) return { totals: {}, fail: true, error: error.message };
  const totals = {};
  (data || []).forEach(r => {
    if (!r?.family_id) return;
    totals[r.family_id] = Number(r.qty_total) || 0;
  });
  return { totals, fail: false, error: null };
}

/* ── ป้ายบนจอ — "ยอดสะสม" มี 3 สถานะ ห้ามยุบเป็น 2 ───────────────────────────
   อ่านไม่ได้ (fail) ≠ ยังไม่เคยผลิต (0) ≠ ผลิตแล้ว N ชิ้น
   🔴 คืนเป็น **tone ชุดกลางของระบบ** (`utils/statusTone.js`) ห้ามตั้ง hex เองที่นี่
      (ด่าน `status-palette-single-source`) · อ่านไม่ได้ = `warn` (เหลือง = มีอะไรไม่ปกติ)
      ยังไม่เคยผลิต = `none` (เทา = ไม่มีค่าให้ตัดสิน · **ห้ามเขียว**) */
export function familyQtyChip(totals, familyId, fail = false) {
  if (fail) return { text: '📦 อ่านยอดสะสมไม่ได้', tone: 'warn' };
  const n = totals?.[familyId];
  if (!(Number(n) > 0)) return { text: '📦 ยังไม่เคยผลิต', tone: 'none' };
  return { text: `📦 ยอดสะสม ${Number(n).toLocaleString()} ชิ้น`, tone: 'good' };
}
