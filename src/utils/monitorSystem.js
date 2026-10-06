/* ══ 📉 monitorSystem — "แถวไหนระบบรู้เอง" ของบอร์ด Monitoring (pure · 2026-10-01) ═══════
   เหตุผลที่โมดูลนี้มีอยู่: ในไฟล์ Excel เดิม ทีมวางแผน**พิมพ์มือ 6 แถวต่อพาร์ทต่อวัน** แต่
   4 ใน 6 แถวนั้นระบบรู้อยู่แล้ว (วัดจริง 01/10) ⇒ งานพิมพ์ที่เหลือจริงๆ คือแถว PLAN

     แถว      ที่มาในระบบ
     IN       ใบผลิตที่ปิดแล้ว (prod_orders ⋈ production_sessions.work_date)
     OUT      การจ่ายของออกจากไลน์ (line_stock_transactions: issue + consume)
     MIN      ระดับขั้นต่ำต่อไลน์ (line_part_levels.min_qty)
     BALANCE  คำนวณจาก IN/OUT (monitorGrid.RECUR.stock_run)

   🔴 กฎที่ห้ามพลาด
   1. **ค่าที่คนกรอกชนะค่าที่ระบบรู้เสมอ** — จัดการใน `buildGrid` แล้ว (ไฟล์นี้แค่ "เสนอ")
      หน้างานเห็นของจริงที่ระบบยังไม่รู้ · ระบบห้ามลบของที่คนยืนยัน
   2. **ไม่รู้ = `undefined` ห้ามคืน 0** — "ไม่มีใบผลิตของพาร์ทนี้" กับ "ผลิตได้ 0 ชิ้น"
      ต่างกันสิ้นเชิง · วัดจริง: 106 พาร์ทในไฟล์ **มีประวัติผลิตในระบบแค่ 26 ตัว (25%)**
      ถ้าคืน 0 ให้อีก 80 ตัว จอจะดูเหมือนพัง ทั้งที่ความจริงคือยังไม่มีใครเปิดใบผลิตพาร์ทนั้น
   3. **MIN เป็นแถว const** ⇒ ใส่ค่าที่ "คอลัมน์ยอดยกมา" ช่องเดียว แล้วปล่อยให้ไหลไปขวาเอง
      (ใส่ทุกช่องก็ได้ค่าเดียวกัน แต่เปลืองและทำให้ "คนแก้ค่าเองกลางทาง" ใช้ไม่ได้)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `${mat}|${date}` → ผลรวม · ใช้ทำดัชนีจากแถวดิบที่ดึงมาจาก DR */
export function sumByMatDate(rows = [], { mat = 'mat_no', date = 'work_date', qty = 'qty', keep } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    if (typeof keep === 'function' && !keep(r)) continue;
    const mt = String(r?.[mat] ?? '').trim();
    const dt = String(r?.[date] ?? '').slice(0, 10);
    const q = num(r?.[qty]);
    if (!mt || !dt || q === null) continue;
    const k = `${mt}|${dt}`;
    m.set(k, (m.get(k) || 0) + q);
  }
  return m;
}

/** `mat` → ค่าเดียว (เช่น min_qty) · ซ้ำกัน = ตัวแรกชนะ (ทะเบียนมี unique อยู่แล้ว) */
export function firstByMat(rows = [], { mat = 'mat_no', value = 'min_qty' } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    const mt = String(r?.[mat] ?? '').trim();
    if (!mt || m.has(mt)) continue;
    const v = num(r?.[value]);
    if (v !== null) m.set(mt, v);
  }
  return m;
}

/**
 * สร้างฟังก์ชัน `system(partId, rowKey, periodKey)` ให้ `buildGrid`
 * @param {object} a
 * @param {Map}    a.partMat   partId → mat_no
 * @param {Map}    [a.inIdx]   `mat|date` → ยอดผลิตเข้า
 * @param {Map}    [a.outIdx]  `mat|date` → ยอดจ่ายออก
 * @param {Map}    [a.orderIdx] `mat|date` → ยอดลูกค้าสั่ง (EDI 862/830 · บอร์ด FG)
 * @param {Map}    [a.minByMat] mat → min_qty
 * @param {string} [a.seedKey] คอลัมน์แรก (ที่ใส่ค่า MIN)
 * @returns {Function} คืน `undefined` เมื่อระบบไม่รู้ (ห้ามคืน 0)
 */
export function makeSystemLookup({ partMat, inIdx, outIdx, orderIdx, minByMat, seedKey } = {}) {
  return (partId, rowKey, periodKey) => {
    const mat = partMat?.get?.(partId);
    if (!mat) return undefined;
    if (rowKey === 'in' && inIdx) return inIdx.get(`${mat}|${periodKey}`);
    if (rowKey === 'out' && outIdx) return outIdx.get(`${mat}|${periodKey}`);
    if (rowKey === 'order' && orderIdx) return orderIdx.get(`${mat}|${periodKey}`);
    /* MIN ใส่ช่องยอดยกมาช่องเดียว แล้ว RECUR 'carry' พาไปขวาเอง */
    if (rowKey === 'min' && minByMat && periodKey === seedKey) return minByMat.get(mat);
    return undefined;
  };
}

/** ชนิดธุรกรรมที่นับเป็น "ของออกจากไลน์"
 *  ⚠️ `adjust` ไม่นับ — เป็นการแก้ยอดให้ตรงของจริง ไม่ใช่การจ่ายออก (และติดลบได้)
 *     วัดจริง 01/10: adjust 249 แถว ติดลบ 155 แถว ต่ำสุด −312,120 ⇒ รวมเข้าไป = OUT เพี้ยนหนัก */
export const OUT_TXN_TYPES = ['issue', 'consume'];

/** ใบผลิตที่ถือว่า "ผลิตเข้าแล้ว" — ต้องคอนเฟิร์มยอดแล้วเท่านั้น
 *  🔴 วัดจริงจาก DR 01/10 — ระบบ**ไม่มีสถานะ `closed`** (เคยเขียนไว้ตอนแรก = กรองไม่ติดเงียบๆ):
 *     confirmed 16,217 (มี qty_ok 15,999) · imported 912 · open 93 · cancelled 53 · carry_over 5
 *  · `imported` = ใบที่ยกเข้าระบบย้อนหลัง **ยังไม่มีใครคอนเฟิร์มยอด** (qty_ok ว่างทั้ง 912 ใบ) ⇒ ไม่นับ
 *  · `open` = ใบที่ยังเดินอยู่ ของยังไม่เข้าคลัง ⇒ ไม่นับ · `cancelled` ⇒ ไม่นับแน่นอน */
export const IN_ORDER_STATUS = ['confirmed'];

/** ยอดที่ผลิตได้จริงของใบ — `qty_ok` ก่อน ไม่มีค่อยถอยไป `qty_actual`
 *  🔴 ห้ามถอยไป `qty` (= เป้าของใบ ไม่ใช่ของที่ทำได้) — จะได้ IN เท่าเป้าเสมอ ซึ่งไม่เคยจริง */
export function orderInQty(o) {
  const ok = num(o?.qty_ok);
  if (ok !== null) return ok;
  return num(o?.qty_actual);
}

/** ออเดอร์ลูกค้าที่ยัง "นับเป็นความต้องการ" — ยกเลิกแล้วไม่นับ
 *  🔴 ส่งแล้ว (`shipped`) **ยังนับ** เพราะบอร์ด FG หักยอดตามวันส่งที่ลูกค้าขอ
 *     (ของออกไปแล้วก็ต้องหายจากสต๊อก — ไม่ใช่ว่าหายไปจากความต้องการ) */
export const DEMAND_SKIP_STATUS = ['cancelled'];
