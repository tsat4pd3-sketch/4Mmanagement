/* ─── 📋 ตรวจนับสต็อก (stocktake) + กระทบยอดขาออกที่หลุด ─────────────────────────
   ฟังก์ชันล้วน (pure) — คำนวณอย่างเดียว ไม่แตะ DB/React เพื่อล็อกด้วยเทสได้
   ใช้โดย src/components/StockCountSheet.jsx (แท็บ 📋 ตรวจนับ/เฟิร์มยอด ใน /line-stock)

   ที่มา (2026-09-23 · feedback หน้างานจากแพลนนิ่ง): "Stock บางตัวไม่ตรง"
   ────────────────────────────────────────────────────────────────────────────────
   ไล่ ledger จริงแล้วเจอ 2 รูรั่ว คนละสาเหตุ — ห้ามแก้รวมกันเป็นเรื่องเดียว:

   1) 🚚 **ใบที่กด "ส่งแล้ว" แต่หักสต็อกไม่ได้** (วัดจริง 23/09: 155 ใบ / 22,781 ชิ้น
      จาก 914 ใบที่ส่ง) — CustomerDemand.advance() พยายามหักให้แล้วและ**เตือนถูกต้อง**
      ตอนกด ("⚠️ ส่งแล้ว — แต่ไม่ได้หักสต็อก") แต่ toast นั้นดับไปพร้อมจอ
      ⇒ ยอดคงเหลือค้างสูงกว่าความจริงตลอดไป โดยไม่มีที่ไหนคอยตามต่อ
      → แผงนี้ทำให้ toast ครั้งเดียวกลายเป็น "รายการค้างที่ยังตามได้"

   2) 📋 **ไม่มีหน้าตรวจนับ** — 🔧 ปรับยอด เดิมทำได้ทีละแถวและต้อง**คิดผลต่างเอง**
      (ต้องรู้ว่าจะเพิ่ม/ลด "กี่ชิ้น" ไม่ใช่ "นับได้กี่ชิ้น") ⇒ ตรวจนับทั้งคลังไม่ไหว
      → ตารางนี้กรอก "ยอดที่นับได้" ระบบคิดผลต่างให้ แล้วบันทึกเป็น adjust ทีเดียว

   🔴 กฎเหล็กของโมดูลนี้ — **ห้ามหักย้อนหลังข้ามรอบตรวจนับ**
   ยอดที่ได้จากการตรวจนับ = ของจริงบนชั้น ณ วันนั้น ⇒ ใบที่ส่งไป **ก่อน** รอบนับ
   ถูกสะท้อนในยอดที่นับได้ไปแล้ว การไปหักซ้ำ = ยอดหายสองเท่าเงียบๆ
   (เคยเกือบพลาดจริง: 23/09 อัปไฟล์ Monitoring ตั้งยอดตามที่แพลนนิ่งนับมา 88 พาร์ท
    แล้วเกือบ backfill ใบ shipped ย้อนไปถึง 17/08 ทับลงไปอีก)
   ⇒ `pendingShipCuts()` ตัดใบที่เก่ากว่ารอบนับล่าสุดของ mat+คลังนั้นออกเสมอ
   ──────────────────────────────────────────────────────────────────────────── */

/** ผลต่างของการตรวจนับ 1 แถว
 *  @param {number} onHand  ยอดในระบบ
 *  @param {string|number} counted  ยอดที่นับได้ (ว่าง = ยังไม่นับ → null)
 *  @returns {null | { counted:number, delta:number, dir:'up'|'down', qty:number }}
 *           null = ไม่ต้องทำอะไร (ยังไม่กรอก / กรอกไม่เป็นตัวเลข / ตรงกันอยู่แล้ว)
 */
export function countDelta(onHand, counted) {
  if (counted === '' || counted === null || counted === undefined) return null;
  const c = typeof counted === 'number' ? counted : parseFloat(String(counted).replace(/,/g, ''));
  if (!Number.isFinite(c) || c < 0) return null;
  const base = Number(onHand) || 0;
  const delta = c - base;
  if (delta === 0) return null;
  return { counted: c, delta, dir: delta > 0 ? 'up' : 'down', qty: Math.abs(delta) };
}

/** แปลงแถวที่นับแล้วเป็นรายการ adjust พร้อม insert
 *  ⚠️ adjust ลด = เก็บ qty ติดลบ (view line_stock_summary บวก adjust ตรงๆ) — กติกาเดียวกับ LineStock.handleSave
 *  @returns {Array} txn objects (ไม่มี status — ผู้เรียกเป็นคนตัดสินว่า pending/approved ตามสิทธิ์)
 */
export function toAdjustTxns({ rows, lineName, workDate, by, note, counts }) {
  const out = [];
  (rows || []).forEach(r => {
    const d = countDelta(r.qty_on_hand, counts?.[r.mat_no]);
    if (!d) return;
    out.push({
      line_name: lineName,
      mat_no:    r.mat_no,
      part_name: r.part_name || null,
      qty:       d.delta,                 // +เพิ่ม / −ลด (ติดลบได้)
      type:      'adjust',
      work_date: workDate,
      note:      `ตรวจนับ: ระบบ ${(Number(r.qty_on_hand) || 0).toLocaleString()} → นับได้ ${d.counted.toLocaleString()}`
                 + (note ? ` · ${note}` : ''),
      created_by: by || null,
    });
  });
  return out;
}

/** สรุปผลการตรวจนับก่อนกดบันทึก (ให้จอบอกความจริงได้ครบ ห้ามขึ้นแค่ "สำเร็จ") */
export function countSummary({ rows, counts }) {
  let counted = 0, up = 0, down = 0, upQty = 0, downQty = 0, same = 0;
  (rows || []).forEach(r => {
    const raw = counts?.[r.mat_no];
    if (raw === '' || raw === null || raw === undefined) return;
    counted += 1;
    const d = countDelta(r.qty_on_hand, raw);
    if (!d) { same += 1; return; }
    if (d.dir === 'up') { up += 1; upQty += d.qty; } else { down += 1; downQty += d.qty; }
  });
  return { counted, same, up, down, upQty, downQty, changed: up + down };
}

/** เวลาตรวจนับล่าสุดต่อ (คลัง, mat) — ใช้เป็นเส้นแบ่ง "หักย้อนหลังได้ถึงไหน"
 *  @param {Array} txns  line_stock_transactions (type adjust, status approved)
 *  @returns {Object} key `${line_name}\u0000${mat_no}` → ISO string ของรอบนับล่าสุด
 */
export function lastCountAt(txns) {
  const m = {};
  (txns || []).forEach(t => {
    if (t.type !== 'adjust') return;
    if (t.status && t.status !== 'approved') return;
    const k = `${t.line_name}\u0000${t.mat_no}`;
    const at = t.created_at || null;
    if (!at) return;
    if (!m[k] || at > m[k]) m[k] = at;
  });
  return m;
}

/** ใบที่ "ส่งแล้ว" แต่ยังไม่มีแถวตัดสต็อกผูกอยู่ และยัง**ไม่ถูกปิดด้วยรอบตรวจนับ**
 *  @param {Array}  a.orders    customer_shipping_orders ที่ status='shipped'
 *  @param {Set}    a.cutIds    set ของ order id ที่มีแถวตัดสต็อกแล้ว (ref_shipment_id)
 *  @param {Object} a.counted   ผลจาก lastCountAt()
 *  @param {string} a.fgLine    ชื่อคลังปลายทางที่จะหัก (เช่น 'FG WAREHOUSE')
 *  @param {Function} [a.sapOf] map เลขใน order → เลข SAP ที่ของอยู่จริง (ไม่ส่ง = ใช้ mat_no ตรงตัว)
 *  @returns {{ open:Array, closedByCount:Array, unresolved:Array }}
 *    open          = ตามต่อได้ (หักย้อนหลังได้)
 *    closedByCount = ส่งก่อนรอบตรวจนับล่าสุด → ยอดที่นับสะท้อนไปแล้ว **ห้ามหักซ้ำ**
 *    unresolved    = จับคู่เลข SAP ไม่ได้ → หักไม่ได้ ต้องแก้ทะเบียนก่อน (ห้ามเดา)
 */
export function pendingShipCuts({ orders, cutIds, counted, fgLine, sapOf }) {
  const open = [], closedByCount = [], unresolved = [];
  (orders || []).forEach(o => {
    if (cutIds?.has?.(o.id)) return;
    const sap = sapOf ? sapOf(o.mat_no) : o.mat_no;
    if (!sap) { unresolved.push({ ...o, sap: null }); return; }
    const mark = counted?.[`${fgLine}\u0000${sap}`];
    const at = o.shipped_at || (o.due_date ? `${o.due_date}T23:59:59Z` : null);
    if (mark && at && at <= mark) { closedByCount.push({ ...o, sap, countedAt: mark }); return; }
    open.push({ ...o, sap });
  });
  return { open, closedByCount, unresolved };
}
