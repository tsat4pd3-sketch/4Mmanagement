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
/** 🔴 เส้นตั้งต้นยอดทั้งระบบ — migration `20261001_line_stock_reset_to_zero.sql` ล้างยอดทุกคลังเป็น 0
 *  (ยอดเดิมเชื่อถือไม่ได้ · คำสั่ง user) = **รอบตรวจนับของทุก (คลัง, mat) พร้อมกัน** รวมถึง MAT ที่ตอนนั้นไม่มีแถว
 *  ⇒ ใบที่ส่งก่อนเส้นนี้ห้ามหักย้อนหลังเด็ดขาด
 *  เคสจริง 07/10: MAT ที่ไม่มีแถวในคลังตอนล้าง ไม่มี `adjust` ให้ `lastCountAt` เห็น ⇒ ปุ่มหักย้อนหลังลากใบ ส.ค.–ก.ย.
 *  159 ใบ / 23,476 ชิ้น มาหัก FG WAREHOUSE จนติดลบ 6 MAT (−24,344) ทั้งที่ของไม่เคยถูกรับเข้าระบบ
 *  (เวลา = created_at ของแถวล้างยอดจริงใน DR) */
export const STOCK_BASELINE_AT = '2026-10-01T04:30:42Z';

export function pendingShipCuts({ orders, cutIds, counted, fgLine, sapOf, baselineAt = STOCK_BASELINE_AT }) {
  const open = [], closedByCount = [], unresolved = [];
  (orders || []).forEach(o => {
    if (cutIds?.has?.(o.id)) return;
    const sap = sapOf ? sapOf(o.mat_no) : o.mat_no;
    if (!sap) { unresolved.push({ ...o, sap: null }); return; }
    const own = counted?.[`${fgLine}\u0000${sap}`];
    const mark = own && (!baselineAt || own > baselineAt) ? own : (baselineAt || own);
    const at = o.shipped_at || (o.due_date ? `${o.due_date}T23:59:59Z` : null);
    if (mark && at && at <= mark) { closedByCount.push({ ...o, sap, countedAt: mark }); return; }
    open.push({ ...o, sap });
  });
  return { open, closedByCount, unresolved };
}

/* ─── 🧭 ขั้น ② ของแผน min/max — "รอบนับตั้งต้นที่ไลน์ปลายทาง" (2026-11-25 · คำสั่ง user) ──
   ลำดับของแผนคือ ① ย้ายทะเบียนไปที่ของนอนรอจริง (ทำแล้ว 24/11) → ② **นับของจริงตั้งต้น**
   → ③ ค่อยเชื่อ `qty_on_hand` (📄 docs/modules/kanban-auto-calc.md)

   🔴🔴 กฎเหล็กของขั้นนี้ — **"ปรับยอด" ไม่ใช่ "นับของจริง" ห้ามนับรวมกัน**
   `line_stock_transactions.type='adjust'` เป็นถุงรวมของหลายเรื่องที่คนละความหมายกันสิ้นเชิง:
     · `ตรวจนับ: …`                  = **คนไปยืนนับของบนชั้น** ⇒ เป็นข้อเท็จจริงของวันนั้น
     · `ตั้งยอดให้ตรงไฟล์ Monitoring` = ตั้งยอดตามไฟล์ Excel (191+102+88 แถว) — **ไม่ได้นับ**
     · `ตั้งต้นใหม่ 01/10` · `ย้ายยอด…` · `แก้ย้อนหลัง…` · `กลับรายการ…` = การแก้บัญชี **ไม่ได้นับ**
   ⇒ ถ้าเอา adjust ทุกแบบมาตอบ "ไลน์นี้นับล่าสุดเมื่อไหร่" จอจะบอกว่า LINE D นับแล้ว 03/11
     ทั้งที่วันนั้นคือการตั้งยอดตามไฟล์ = **จอโกหก** (เคสจริงของ LINE D: ยอดติดลบ −100,212
     เกิดจากการตั้งยอดตามไฟล์ทับกันหลายรอบ ไม่ใช่การผลิต — ดูเอกสาร kanban-auto-calc.md)

   🔴 **ทำไมมี 2 ฟังก์ชัน ห้ามยุบเป็นตัวเดียว**
     · `lastCountAt()`        = เส้น "ห้ามหักใบส่งย้อนหลังข้ามรอบนี้" — ตั้งใจนับ adjust **ทุกแบบ**
       เพราะการตั้งยอดตามไฟล์ก็สะท้อนของที่ออกไปแล้วเหมือนกัน ⇒ ไม่หัก = **ปลอดภัยกว่า** (fail-closed)
     · `lastPhysicalCountAt()` = "ไลน์นี้มีคนไปนับของจริงล่าสุดเมื่อไหร่" — ใช้ตอบความคืบหน้าของรอบนับ
       ที่นี่ fail-closed คือ **ตอบว่ายังไม่นับ** (ไม่เคลมว่านับแล้ว)
   ──────────────────────────────────────────────────────────────────────────── */

/** หัวข้อ note ที่ `toAdjustTxns()` เขียน — ตัวเดียวที่แปลว่า "คนไปนับของจริง" */
export const COUNT_NOTE_PREFIX = 'ตรวจนับ:';

/** แถวนี้คือผลการนับของจริงไหม (ไม่ใช่การปรับยอด/ตั้งยอดตามไฟล์) */
export function isPhysicalCount(t) {
  if (!t || t.type !== 'adjust') return false;
  if (t.status && t.status !== 'approved') return false;
  return String(t.note || '').trimStart().startsWith(COUNT_NOTE_PREFIX);
}

/** เวลานับ**ของจริง**ล่าสุดต่อ (คลัง, mat) — คนละตัวกับ `lastCountAt` (ดูกฎข้างบน)
 *  @returns {Object} key `${line_name}\u0000${mat_no}` → ISO string */
export function lastPhysicalCountAt(txns) {
  const m = {};
  (txns || []).forEach(t => {
    if (!isPhysicalCount(t)) return;
    const at = t.created_at || null;
    if (!at) return;
    const k = `${t.line_name}\u0000${t.mat_no}`;
    if (!m[k] || at > m[k]) m[k] = at;
  });
  return m;
}

const sKey = (line, mat) => `${line}\u0000${mat}`;

/** 📋 ความคืบหน้ารอบนับ แยกรายไลน์/คลัง — ตัวเลขทุกตัวของแผงรอบนับออกจากที่นี่
 *
 *  🔴 อ่าน ledger ไม่ได้ = คืน `null` ห้ามคืน `[]` — "ไม่มีงานต้องนับ" กับ "อ่านไม่ได้" คนละเรื่อง
 *     (กฎข้อ 12 ของ db-write-rules: ลิสต์ว่าง 2 ความหมาย)
 *
 *  @param {Array}  a.stock   line_stock_summary [{ line_name, mat_no, qty_on_hand }]
 *  @param {Array}  a.txns    adjust ที่ approved [{ line_name, mat_no, qty, note, type, status, created_at }]
 *  @param {Array}  [a.levels] line_part_levels [{ line_name, mat_no }] — พาร์ทที่ทะเบียนบอกว่าต้องมีที่ไลน์นี้
 *  @returns {null | Array} เรียงงานมากก่อน (ติดลบมากสุดขึ้นก่อน)
 */
export function countRoundRows({ stock, txns, levels }) {
  if (!Array.isArray(stock) || !Array.isArray(txns)) return null;   // fail-closed
  const lastAt = lastPhysicalCountAt(txns);

  /* พาร์ทที่ "ต้องนับ" ของแต่ละไลน์ = แถวในคลัง ∪ คู่ที่ทะเบียน min/max ตั้งไว้ที่ไลน์นี้
     (ทะเบียนตั้งไว้แต่ไม่มีแถวเลย = ของควรอยู่ที่นี่ แต่ระบบยังไม่เคยรู้จัก — ต้องนับได้ด้วย) */
  const per = new Map();   // line → { mats:Map(mat → qty), fromLevels:Set }
  const unit = (ln) => {
    let u = per.get(ln);
    if (!u) { u = { mats: new Map(), fromLevels: new Set() }; per.set(ln, u); }
    return u;
  };
  (stock || []).forEach(s => {
    const ln = String(s.line_name ?? '').trim();
    if (!ln || !s.mat_no) return;
    unit(ln).mats.set(String(s.mat_no), parseFloat(s.qty_on_hand) || 0);
  });
  (levels || []).forEach(l => {
    const ln = String(l.line_name ?? '').trim();
    if (!ln || !l.mat_no) return;
    const u = unit(ln);
    const mat = String(l.mat_no);
    if (!u.mats.has(mat)) { u.mats.set(mat, 0); u.fromLevels.add(mat); }
  });

  /* "หลังนับแล้วมีคนมาปรับยอดอีกเท่าไหร่" — สัญญาณว่าการนับ **ไม่อยู่** (ต้องแก้ที่การบันทึก ไม่ใช่นับซ้ำ) */
  const drift = {};
  (txns || []).forEach(t => {
    if (!t || t.type !== 'adjust') return;
    if (t.status && t.status !== 'approved') return;
    if (isPhysicalCount(t)) return;                       // การนับไม่ใช่ drift
    const k = sKey(String(t.line_name ?? '').trim(), String(t.mat_no ?? ''));
    const mark = lastAt[k];
    if (!mark || !t.created_at || t.created_at <= mark) return;   // ก่อนรอบนับ = ไม่นับเป็น drift
    drift[k] = (drift[k] || 0) + Math.abs(parseFloat(t.qty) || 0);
  });

  const out = [];
  per.forEach((u, line_name) => {
    let parts = 0, zeroParts = 0, negParts = 0, negQty = 0, counted = 0, never = 0;
    let lineLastAt = null, driftAfter = 0, noRowParts = 0;
    u.mats.forEach((qty, mat) => {
      parts += 1;
      if (qty === 0) zeroParts += 1;
      if (qty < 0) { negParts += 1; negQty += qty; }
      if (u.fromLevels.has(mat)) noRowParts += 1;
      const at = lastAt[sKey(line_name, mat)] || null;
      if (at) { counted += 1; if (!lineLastAt || at > lineLastAt) lineLastAt = at; } else never += 1;
      driftAfter += drift[sKey(line_name, mat)] || 0;
    });
    out.push({
      line_name, parts, zeroParts, negParts, negQty, counted, never,
      noRowParts,                                   // ทะเบียนตั้งไว้ที่นี่ แต่ยังไม่เคยมีรายการ
      lastAt: lineLastAt,
      driftAfter,
      status: never === parts ? 'none' : never > 0 ? 'partial' : 'done',
    });
  });
  /* เรียง "งานมากก่อน": ติดลบหนักสุด → ยังไม่เคยนับ → พาร์ทมาก */
  out.sort((a, b) => (a.negQty - b.negQty) || (b.never - a.never) || (b.parts - a.parts)
    || String(a.line_name).localeCompare(String(b.line_name)));
  return out;
}

/* ─── ⏳ ใบปรับยอดที่ "รออนุมัติ" — กันนับซ้ำหักซ้ำ (2026-11-25 · user ถาม "ต่างคนต่างนับจะปนกันมั่วไหม") ──
   🔴🔴 กฎเหล็ก — **`qty_on_hand` ไม่รวมใบที่ยังไม่อนุมัติ**
   view `line_stock_summary` มี `where status = 'approved'` ⇒ ใบ `pending` ไม่อยู่ในยอดที่จอโชว์
   ⇒ คนที่ 2 เปิดจอมาเห็น "ยอดระบบ" ตัวเดิม แล้วกรอกยอดที่นับได้ตัวเดิม = **เขียนผลต่างซ้ำอีกใบ**
     พออนุมัติทั้งคู่ ของหายสองเท่า **เงียบสนิท ไม่มี error** (คลาสเดียวกับการหักซ้ำ 1.3 ล้านชิ้น 25/11)
   ⇒ คู่ (ไลน์, mat) ที่มีใบค้าง **ห้ามรับผลนับใบใหม่** จนกว่าใบเดิมจะถูกอนุมัติหรือตีกลับ
     (fail-closed: ยอมให้ช้า ดีกว่ายอมให้ของหายโดยไม่มีใครรู้)
   🔴 ห้าม "เอาใบ pending มาบวกในยอดตั้งต้น" แทนการบล็อก — ใบที่ยังไม่อนุมัติอาจถูกตีกลับ
     เอามาคิดผลต่าง = ตั้งยอดจากตัวเลขที่ยังไม่จริง */

const PEND_KEY = (line, mat) => `${String(line ?? '').trim()}\u0000${String(mat ?? '')}`;

/** ใบปรับยอดที่ยังรออนุมัติ ต่อ (คลัง, mat)
 *  ⚠️ นับ **ทุกใบ `adjust` ที่ pending** ไม่ใช่เฉพาะใบตรวจนับ — ใบ 🔧 ปรับยอดก็ทำให้ยอดตั้งต้นเพี้ยนเหมือนกัน
 *  @returns {Object} key → { n, qty, by, at } (qty = ผลรวมที่จะมีผลเมื่ออนุมัติ)
 */
export function pendingAdjustMap(txns) {
  const m = {};
  (txns || []).forEach(t => {
    if (!t || t.type !== 'adjust' || t.status !== 'pending') return;
    const k = PEND_KEY(t.line_name, t.mat_no);
    const cur = m[k] || { n: 0, qty: 0, by: null, at: null };
    cur.n += 1;
    cur.qty += parseFloat(t.qty) || 0;
    if (!cur.at || (t.created_at && t.created_at > cur.at)) { cur.at = t.created_at || cur.at; cur.by = t.created_by || cur.by; }
    m[k] = cur;
  });
  return m;
}

/** แยกผลนับที่บันทึกได้ ออกจากที่ต้องกันไว้เพราะมีใบค้าง
 *  🔴 ห้ามทิ้งเงียบ — ผู้เรียกต้องเอา `blocked` ไปเขียนบนจอว่ากันไว้กี่พาร์ทและเพราะอะไร
 *  @returns {{ ok:Array, blocked:Array }}
 */
export function splitPendingBlocked(txns, pendingMap) {
  const ok = [], blocked = [];
  (txns || []).forEach(t => {
    const p = pendingMap?.[PEND_KEY(t.line_name, t.mat_no)];
    if (p?.n) blocked.push({ ...t, pending: p }); else ok.push(t);
  });
  return { ok, blocked };
}

/** คีย์ของ map ข้างบน — ให้จอถามรายแถวได้โดยไม่ต้องรู้รูปแบบคีย์ */
export const pendingKey = PEND_KEY;
