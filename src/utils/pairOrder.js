/* ═══ 👯 ใบผลิตงานคู่ RH/LH — "ลงยอดข้างเดียว" (2026-10-02 · feedback หน้างาน) ═══════════
   user: *"บางรายการเวลาคอนเฟิร์มยอด ก็ได้งานข้างเดียว ไม่ได้ทั้งคู่ซ้ายขวา"*

   วัดจริง 02/10 (60 วัน · ใบของสินค้าที่มี `pair_mat_no` 676 ใบ):
     · ไม่ได้ผูกคู่ **239 ใบ (35%)** — ในนั้น **111 ใบไม่มีใบของอีกข้างในกะเดียวกันเลย**
       (อีก 128 ใบมีใบอยู่ แค่ไม่ได้ผูก `paired_order_id` ต่อกัน)
     · คู่ที่ผูกแล้ว 226 คู่ — ยอดต่างกัน 4 คู่ · ได้ข้างเดียว 1 คู่
   ⇒ อาการที่ user เจอมี **2 ต้นเหตุคนละตัว** ห้ามแก้รวมกัน:
     (A) ลงยอดที่ใบหนึ่ง **อีกใบไม่ขยับ** — ตอนลงยอด/ปิดใบ โค้ดเขียนแค่ `.eq('id', ใบนี้)`
     (B) **ไม่เคยมีใบของอีกข้าง** — ตอนเปิดใบ สแกนข้างเดียวแล้วไม่ได้สแกนคู่ / กด Cancel ตอนถามเปิดเป้าคู่
         แล้ว**ไม่มีอะไรเตือนอีกเลย** จนไปเห็นตอนสรุปยอด

   🔴 กติกา (ตรงกับกฎเหล็ก "ชิ้น ≠ shot" + "ระบบเสนอ คนตัดสิน"):
     · ปั๊มทีเดียวได้ 2 ชิ้น ⇒ ยอด 2 ข้าง**ควร**เท่ากัน — แต่ **ห้ามเขียนให้เงียบๆ**
       (RH/LH บางคู่เสียไม่เท่ากันจริง · วัดจริง 4 คู่) ⇒ **เสนอค่าให้ คนกดยืนยัน**
     · **ห้ามเดาว่า "ไม่มีคู่ = ไม่ต้องมี"** — ต้องขึ้นบนจอว่ายังขาดอีกข้าง
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const up = (s) => (s ?? '').toString().trim().toUpperCase();
const qtyOf = (o) => Number(o?.qty_ok ?? o?.qty_actual ?? 0) || 0;

/**
 * จะเสนอให้ลงยอดอีกข้างด้วยไหม — คืน null = ไม่ต้องถาม (ไม่มีคู่ / ยอดตรงกันอยู่แล้ว / คู่ปิดไปแล้ว)
 * @param {object} order    ใบที่กำลังลงยอด
 * @param {object} partner  ใบคู่ (จาก paired_order_id) — ไม่มี = null
 * @param {number} newQty   ยอดใหม่ที่กำลังจะลงให้ `order`
 * @returns {{partner, from:number, to:number, locked:boolean}|null}
 *   locked = ใบคู่ปิด/ยืนยันไปแล้ว ⇒ เสนอได้แต่ต้องบอกว่าจะไปทับใบที่ปิดแล้ว
 */
export function pairQtyPlan(order, partner, newQty) {
  const q = Number(newQty);
  if (!order || !partner || !Number.isFinite(q)) return null;
  if (partner.status === 'cancelled') return null;
  const from = qtyOf(partner);
  if (from === q) return null;                      // ตรงกันอยู่แล้ว ไม่ต้องรบกวน
  return { partner, from, to: q, locked: partner.status === 'confirmed' || partner.status === 'closed' };
}

/**
 * ใบงานคู่ที่ "ยังไม่มีอีกข้าง" ในชุดใบที่ให้มา — เอาไปขึ้น worklist บนจอกะ
 * 🔴 แยก 2 กลุ่มคนละความหมาย ห้ามยุบ:
 *    missing = ไม่มีใบของอีกข้างเลย (ต้องไปเปิดใบ)
 *    unlinked = มีใบอยู่ แค่ยังไม่ผูกต่อกัน (กดผูกได้เลย ยอดไม่หาย)
 * @param {Array} orders   ใบในกะนี้
 * @param {Function} pairOf (mat_no) => mat_no ของคู่ | null
 */
export function pairOrderGaps(orders, pairOf) {
  const live = (orders || []).filter(o => o && o.status !== 'cancelled');
  const byMat = new Map();
  live.forEach(o => { const k = up(o.mat_no); if (k) byMat.set(k, [...(byMat.get(k) || []), o]); });
  const byId = new Map(live.map(o => [o.id, o]));

  const missing = [], unlinked = [];
  live.forEach(o => {
    const pm = up(pairOf?.(o.mat_no));
    if (!pm) return;
    if (o.paired_order_id && byId.has(o.paired_order_id)) return;      // ผูกแล้วและคู่อยู่ในกะนี้
    const cands = (byMat.get(pm) || []).filter(x => !x.paired_order_id || !byId.has(x.paired_order_id));
    if (cands.length) unlinked.push({ order: o, pair_mat_no: pm, candidate: cands[0] });
    else missing.push({ order: o, pair_mat_no: pm });
  });
  return { missing, unlinked };
}
