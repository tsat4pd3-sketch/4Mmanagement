/* ═══ ตัวสะสม Demand ของระบบดึง — จัดกลุ่มให้บอร์ดตอบคำถามของตัวเองได้ ══════════
   🔴 ที่มา (2026-09-30 · user: *"หน้านี้พังมาก"* พร้อมภาพจอจริง)

   แผง ① "ตัวสะสม Demand (รอครบล็อต)" ใน `/heijunka?view=pull` เดิมวาด **ทุกแถวเป็นการ์ด
   เรียงตาม `pending_qty` มาก→น้อย** ในกริดเดียว ⇒ วัดจริง 30/09: **98 การ์ด** ปูเต็มจอ
   แล้วดันแผง ② (ใบสั่งผลิต + คิวผลิต = ของที่ต้องลงมือจริง) หลุดไปใต้ 6 แถวการ์ด

   ที่แย่กว่า "เยอะ" คือ **มันไม่ตอบคำถามที่บอร์ดนี้ตั้งไว้** ("อะไรครบล็อตแล้ว"):
     · ครบล็อตพร้อมออกใบจริงๆ มีแค่ **3 จาก 98** — และกระจายอยู่กลางกำแพงการ์ด
     · **18 แถวยังไม่ตั้ง lot_size** ⇒ สะสมไปก็ **ไม่มีวันครบ ไม่มีวันออกใบสั่งผลิต**
       (นี่คือ *งานที่ต้องไปตั้งค่า* ไม่ใช่ *งานที่ต้องรอ* — คนละเรื่องกันแต่หน้าตาเหมือนกัน)
     · 8 แถวไม่ขยับมา > 30 วัน (เก่าสุด 30/06) — demand ค้างที่ไม่มีใครรู้ว่าค้าง
     · เรียงด้วย **จำนวนดิบ** ซึ่งเทียบข้ามพาร์ทไม่ได้เลย: 640/4,800 (13%) ถูกวางไว้*เหนือ*
       519/600 (86%) ทั้งที่ตัวหลังใกล้ครบล็อตกว่ามาก ⇒ สายตาไล่ไม่เจอว่าอะไรจะครบก่อน

   ⇒ กฎของไฟล์นี้:
   1. **จัดกลุ่มตาม "ต้องทำอะไรต่อ" ไม่ใช่ตามขนาดตัวเลข** — ครบแล้ว / กำลังสะสม / ตั้งค่าไม่ครบ
   2. **เรียงด้วย % ของล็อต** (ใกล้ครบขึ้นก่อน) — จำนวนดิบข้ามพาร์ทเทียบกันไม่ได้
   3. **ห้ามซ่อนเงียบ** (กฎความซื่อสัตย์ของจอ) — กลุ่มที่ยุบไว้ต้องบอกจำนวนบนหัวกลุ่มเสมอ
   4. `lot` ที่ยังไม่ตั้ง = **`null` ไม่ใช่ 0** — 0 จะถูกอ่านว่า "ครบแล้ว" (หารศูนย์/เทียบผิด)
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** ไม่ขยับเกินกี่วันถือว่า "ค้าง" — demand ที่นิ่งนานคือสัญญาณว่าของไม่ไหลแล้ว */
export const STALE_DAYS = 30;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** lot_size ที่ใช้ได้จริง — 0 / ค่าเพี้ยน / ไม่มี = null ("ยังไม่ตั้ง") ห้ามคืน 0 */
export const lotSizeOf = (map, mat) => {
  const n = Number(map?.[mat]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * จัดกลุ่มแถวตัวสะสม demand ตาม "ต้องทำอะไรต่อ"
 * @param {Array}  rows        แถวจาก child_demand_accumulator
 * @param {Object} lotSizeMap  mat_no → lot_size
 * @param {number|Date} now    เวลาปัจจุบัน — **ส่งเข้ามาเสมอ** (เทสตรึงค่าได้ ไม่ระเบิดเวลา)
 * @returns {{ready:Array, waiting:Array, noLot:Array, total:number, staleCount:number}}
 *   แต่ละแถวถูกเติม `{ lot, pct, stale }` · pct = null เมื่อยังไม่ตั้ง lot (ไม่ใช่ 0)
 */
export function groupAccumulator(rows, lotSizeMap = {}, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const staleBefore = nowMs - STALE_DAYS * 86400000;
  const ready = [], waiting = [], noLot = [];

  for (const r of rows || []) {
    const qty = num(r?.pending_qty);
    const lot = lotSizeOf(lotSizeMap, r?.child_mat_no);
    const t = r?.updated_at ? Date.parse(r.updated_at) : NaN;
    const stale = Number.isFinite(t) && t < staleBefore;
    const pct = lot ? (qty / lot) * 100 : null;
    const row = { ...r, lot, pct, stale };
    if (!lot) noLot.push(row);
    else if (qty >= lot) ready.push(row);
    else waiting.push(row);
  }

  // ครบแล้ว: เกินล็อตมากสุดก่อน (ค้างนานสุด = เสียหายสุด)
  ready.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  // กำลังสะสม: **ใกล้ครบก่อน** — ไม่ใช่จำนวนมากก่อน
  waiting.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  // ยังไม่ตั้ง lot: ของค้างเยอะสุดก่อน (แรงจูงใจให้ไปตั้งค่าตัวนั้นก่อน)
  noLot.sort((a, b) => num(b.pending_qty) - num(a.pending_qty));

  const all = [...ready, ...waiting, ...noLot];
  return { ready, waiting, noLot, total: all.length, staleCount: all.filter(r => r.stale).length };
}
