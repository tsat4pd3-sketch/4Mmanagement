/* ═══ 📍 จุดเรียกเติม "อ้างยอดคลังไหน" — ของที่ไลน์ผลิตเอง vs ของที่ไลน์ใช้ (2026-10-08 · feedback Planning&Store)

   หน้างาน (คุณอัจฉรา 07/10): *"ตั้งจุดเรียกเติม ให้อ้างอิงจาก stock FG WAREHOUSE และ STORE ...
   มันจับ stock ที่ไลน์ผลิตแต่ละไลน์ ซึ่ง stock ไม่เท่ากัน เหมือนมันไม่ link mat"*

   วัดจริง 08/10: จุดเรียกเติมที่ตั้งไว้ 62 แถว (LINE A/B/C/D) — **61 แถวเป็นพาร์ทที่ไลน์นั้นผลิตเอง**
   แต่แผงเทียบกับยอด "หน้าไลน์" ซึ่งมีแต่แถวตรวจนับ (ของที่ผลิตเสร็จวิ่งเข้า FG WAREHOUSE / STORE
   ผ่าน `fn_post_confirmed_output` ตามกฎ `stock_inflow_rules`) ⇒ ยอดหน้าไลน์ไม่ขยับตามการผลิตเลย
   แล้วยังเสนอให้ "📦 เบิกจากสโตร์" ซึ่งผิดทิศ — ของที่ไลน์ผลิตเองต้อง **ผลิตเติม** ไม่ใช่เบิก

   🎴 08/10 (user): ขั้นต่ำ/สูงสุดของ "ของที่ไลน์ผลิตเอง" = `kanban_standards` (แท็บคำนวณ Kanban) ชุดเดียว
      — ชุดเดียวกับที่ Line Stock ของสโตร์ใช้ · ตอนสลับ 60 พาร์ท ตัวเลข min ตรงกัน 38 · **ต่างกัน 21** · Kanban ไม่มี 1

   กติกา (pure · เทส `__tests__/partRefStock.test.mjs`):
   · พาร์ทที่ Product Master บอกว่าไลน์นี้ผลิต + มีกฎรับเข้าคลัง ⇒ `produce` · อ้างยอดคลังปลายทางของกฎ
     (ตรรกะเลือกกฎ = ตัวเดียวกับ trigger: กฎ MAT ชนะ prefix · prefix ยาวชนะสั้น)
   · นอกนั้น (ของที่ไลน์ใช้ / ชั้น OP ซึ่งไม่เข้าคลังเลย / ไม่มีกฎ) ⇒ `consume` · อ้างยอดหน้าไลน์เหมือนเดิม

   🔁 **26/10 (คำสั่ง user) — พาร์ทโหมด 🔧 ปิดล็อต เลิกเป็นข้อยกเว้นแล้ว**
   เดิม: กดปุ่ม "📥 รับของเข้าสโตร์" บนบอร์ดคัมบัง แล้วยอดลงที่ **ชื่อไลน์ผลิต** ⇒ `inflowDestOf()`
         ต้องข้ามกฎโหมดนั้น และ `refStockOf()` ต้องมีข้อยกเว้นให้อ้างยอดที่ไลน์ตัวเอง
   สโตร์แจ้ง (ใบ E-Production TSAT P4): *"ปลายทางคือสโตร์ ... ปัจจุบันพอกดรับ สต็อกจะวิ่งไปที่ไลน์นั้นๆ
   เนื่องจาก set ปลายทางเป็นไลน์ผลิต"* ⇒ สโตร์เปิดดูยอดของตัวเองไม่เจอของที่เพิ่งรับ
   วัด 26/10: แถว `issue` จากปุ่มนี้ 70 แถว ลงที่ LINE A/B/C/D + Assy GOR **ไม่มีแถวไหนลง STORE เลย**
   ⇒ user เคาะ: **ปลายทางของโหมด 🔧 = `dest_line_name` ของกฎนั้นจริงๆ** (ซึ่งตั้งไว้ STORE อยู่แล้ว)
   ⇒ `inflowDestOf()` **เลิกข้ามกฎโหมด lot** · `refStockOf()` ไม่มีข้อยกเว้นอีก · พารามิเตอร์ `lotMats`
     ถูกถอดจากทุกฟังก์ชันในไฟล์นี้ (ไม่มีใครใช้ตัดสินคลังแล้ว)
   🔴 โหมด 🔧 **ยังมีความหมายเดิม** = "ยอดเข้าทางปิดล็อตทางเดียว ปิดใบผลิตไม่ลงสต็อก"
     (trigger `fn_post_confirmed_output` ยังข้ามตามเดิม — **ห้ามแก้ฝั่ง DB**) เปลี่ยนแค่ "ลงที่คลังไหน"
   ═══════════════════════════════════════════════════════════════════════════════ */

const key = (s) => String(s ?? '').trim();
const lineKey = (s) => key(s).replace(/\s+/g, ' ').toLowerCase();

/** คลังปลายทางของ MAT ตามกฎรับเข้า (ไม่มี = null) */
export function inflowDestOf(mat, rules = []) {
  const m = key(mat);
  if (!m) return null;
  let best = null;
  for (const r of rules || []) {
    if (r?.is_active === false) continue;
    /* 🔧 กฎโหมด "ปิดล็อตที่สโตร์" **ร่วมตัดสินปลายทางด้วย** (26/10 · คำสั่ง user — เดิมข้าม)
       โหมดบอกแค่ "ยอดเข้าทางไหน" (ปิดล็อตที่บอร์ด ไม่ใช่ปิดใบผลิต) · `dest_line_name` บอก "เข้าคลังไหน"
       สองเรื่องนี้แยกกัน — เอามาปนกันคือต้นเหตุที่ของเข้าสโตร์แล้วไปโผล่ที่ไลน์ */
    const v = key(r?.match_value);
    if (!v || !r?.dest_line_name) continue;
    const hit = r.match_type === 'mat' ? v === m : (r.match_type === 'prefix' && m.startsWith(v));
    if (!hit) continue;
    const rank = r.match_type === 'mat' ? [0, 0] : [1, -v.length];
    if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { rank, dest: r.dest_line_name };
  }
  return best ? best.dest : null;
}

/**
 * จุดเรียกเติมของ MAT นี้บนไลน์นี้ อ้างยอดที่ไหน
 * @param {string} mat
 * @param {{ lineName:string, products?:Array<{mat_no,line_name,is_active,is_operation}>, rules?:Array }} ctx
 * @returns {{ kind:'produce'|'consume', loc:string }}
 */
export function refStockOf(mat, { lineName, products = [], rules = [] } = {}) {
  const m = key(mat);
  const prod = (products || []).find(p => key(p?.mat_no) === m && p?.is_active !== false);
  const madeHere = prod && !prod.is_operation && lineKey(prod.line_name) === lineKey(lineName);
  const dest = madeHere ? inflowDestOf(m, rules) : null;
  return dest ? { kind: 'produce', loc: dest } : { kind: 'consume', loc: lineName };
}

/** MAT ที่ไลน์นี้ผลิตเอง (Product Master · ไม่ใช่ชั้น OP) — ตัวตั้งของรายการ "ต้องผลิตเติม" */
export function madeHereMats(lineName, products = []) {
  const out = new Set();
  for (const p of products || []) {
    if (p?.is_active === false || p?.is_operation) continue;
    if (lineKey(p?.line_name) === lineKey(lineName) && key(p?.mat_no)) out.add(key(p.mat_no));
  }
  return [...out].sort();
}

/**
 * แบ่งจุดเรียกเติมของไลน์ออกเป็น 2 ทาง
 * · ของที่ไลน์ผลิตเอง: ขั้นต่ำ/สูงสุด **อ่านจาก `kanban_standards` (แท็บ 🎴 คำนวณ Kanban) ชุดเดียว**
 *   (user 08/10 "ให้ใช้ขั้นต่ำจากแท็บคำนวณ Kanban ชุดเดียวกัน") · `line_part_levels` ของพาร์ทพวกนี้ไม่ถูกใช้แล้ว
 *   ไม่มีขั้นต่ำใน Kanban = `produceNoStd` (ไม่เดา · ห้ามถอยไปใช้ line_part_levels = 2 แหล่งความจริง)
 * · ของที่ไลน์ใช้: `line_part_levels` + ยอดหน้าไลน์ เหมือนเดิม
 * @param {Array} levels  แถว line_part_levels ของไลน์
 * @param {{ lineName, products, rules, stds:Map<string,{min_qty,max_qty}> }} ctx
 * @param {(loc:string, mat:string) => number|null} haveAt  ยอดคงเหลือ (null = ไม่มีแถว = ยังเช็คไม่ได้)
 */
export function splitLevels(levels = [], ctx = {}, haveAt = () => null) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const stds = ctx.stds instanceof Map ? ctx.stds : new Map(Object.entries(ctx.stds || {}));
  const out = { produceDue: [], produceUnknown: [], produceNoStd: [], produceOk: 0, consumeLevels: [] };
  for (const lv of levels || []) {
    if (refStockOf(lv.mat_no, ctx).kind === 'consume') out.consumeLevels.push(lv);
  }
  for (const mat of madeHereMats(ctx.lineName, ctx.products)) {
    const ref = refStockOf(mat, ctx);
    if (ref.kind !== 'produce') continue;                        // ไม่มีกฎรับเข้าคลัง = ไม่รู้ว่าของไปอยู่ไหน
    const std = stds.get(mat);
    const min = num(std?.min_qty);
    if (min == null) { out.produceNoStd.push({ mat_no: mat, loc: ref.loc }); continue; }
    const max = num(std?.max_qty);
    const have = haveAt(ref.loc, mat);
    if (have == null) { out.produceUnknown.push({ mat_no: mat, loc: ref.loc, min, max }); continue; }
    if (have > min) { out.produceOk += 1; continue; }
    const qty = max != null ? Math.max(0, max - have) : null;
    out.produceDue.push({ mat_no: mat, loc: ref.loc, have, min, max, suggestQty: qty ? Math.round(qty) : null });
  }
  out.produceDue.sort((a, b) => (a.have / (a.min || 1)) - (b.have / (b.min || 1)));
  return out;
}

/* ═══ 📤 วัตถุดิบ/ชิ้นส่วนที่ "ใช้ผลิตล็อต" — ตัดสต็อกจากคลังที่ของอยู่จริง (2026-10-12 · audit SSOT ยอดสต็อก · user เคาะ)

   เดิมตัด `consume` ที่ `source_line` ของล็อต (ไลน์ที่ใช้) ทั้งที่ไม่เคยมีใครจ่ายของเข้าไลน์นั้นใน ledger
   ⇒ ไลน์ที่ใช้ติดลบ (LINE C −21,600 ของ 20058693) ขณะที่คลังที่ของอยู่จริง (LINE D ที่ผลิต · STORE) ไม่เคยลด
   = ยอดเดียวกันโผล่ 2 ที่ ผิดทั้งคู่

   กติกา (ตัวเลือกคลังชุดเดียวกับ `refStockOf` — จุดเรียกเติม/บอร์ด Monitoring/ตัวนำเข้า):
   1. ของที่ผลิตในโรงงาน (Product Master มีไลน์ผลิต · ไม่ใช่ชั้น OP) ⇒ คลังที่ของผลิตเสร็จเข้า
      (ตามกฎ `stock_inflow_rules` — รวมกฎโหมด 🔧 ปิดล็อต ตั้งแต่ 26/10)
   2. ไม่ได้ผลิตเอง แต่มีกฎรับเข้า ⇒ คลังตามกฎ
   3. ของซื้อ (MAT ขึ้นต้น 3/5 — เกณฑ์เดียวกับ trigger `fn_explode_child_demand` ที่ออก purchase_requests)
      ⇒ `receiptLine` (คลังรับของซื้อ = STORE · `stockReceipt.RECEIPT_LINE`)
   4. ไม่รู้เลย ⇒ ไลน์ที่ใช้ (พฤติกรรมเดิม — ไม่เดาคลังใหม่ให้)
   ═══════════════════════════════════════════════════════════════════════════════ */
export function rawSourceLocOf(mat, { consumingLine, products = [], rules = [], receiptLine = 'STORE' } = {}) {
  const m = key(mat);
  if (!m) return key(consumingLine) || null;
  const prod = (products || []).find(p => key(p?.mat_no) === m && p?.is_active !== false && !p?.is_operation);
  if (prod && key(prod.line_name)) {
    const ref = refStockOf(m, { lineName: prod.line_name, products, rules });
    if (ref.kind === 'produce') return ref.loc;
  }
  const dest = inflowDestOf(m, rules);
  if (dest) return dest;
  if (/^[35]/.test(m)) return receiptLine;
  return key(consumingLine) || null;
}

/**
 * แบ่งยอดตัดวัตถุดิบ: ใช้ของที่ "ถูกจ่ายเข้าไลน์ที่ใช้แล้ว" ก่อน (ไลน์มียอดบวก = สโตร์จ่ายเข้ามาจริง)
 * ส่วนที่เกินค่อยตัดที่คลังต้นทาง (`rawSourceLocOf`) — กันทั้ง 2 ทางผิด:
 *   ตัดที่ไลน์ล้วน = ไลน์ติดลบทั้งที่ของยังอยู่คลัง · ตัดที่คลังล้วน = ของที่จ่ายเข้าไลน์แล้วค้างเป็นยอดผีที่ไลน์
 * @returns {Array<{loc:string, qty:number}>} เฉพาะก้อนที่ > 0 (ผลรวม = qty เสมอ)
 */
export function splitRawConsume(qty, { consumingLine, sourceLoc, lineHave = 0 } = {}) {
  const q = Number(qty) || 0;
  if (q <= 0) return [];
  if (!sourceLoc || key(sourceLoc) === key(consumingLine)) return [{ loc: consumingLine, qty: q }];
  const take = Math.min(q, Math.max(0, Number(lineHave) || 0));
  return [
    ...(take > 0 ? [{ loc: consumingLine, qty: take }] : []),
    ...(q - take > 0 ? [{ loc: sourceLoc, qty: q - take }] : []),
  ];
}
