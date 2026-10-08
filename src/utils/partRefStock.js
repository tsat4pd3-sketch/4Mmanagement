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
     · 🔴 **ยกเว้นพาร์ทที่สโตร์คุมเป็นล็อต** (`child_lot_requests` ไม่นับ cancelled · ส่งมาเป็น `lotMats`) — ยอดเข้าทาง
       "ปิดล็อตที่บอร์ดสโตร์" ทางเดียว ซึ่งลงที่ **ชื่อไลน์ผลิต** (`advanceLot` · trigger ข้าม MAT พวกนี้ตั้งแต่ 06/10)
       ⇒ อ้างยอดที่ไลน์ตัวเอง (ยังเป็น `produce` = ผลิตเติม ไม่ใช่เบิก) · เทียบ STORE = ไม่มียอดตลอดกาล
   · นอกนั้น (ของที่ไลน์ใช้ / ชั้น OP ซึ่งไม่เข้าคลังเลย / ไม่มีกฎ) ⇒ `consume` · อ้างยอดหน้าไลน์เหมือนเดิม
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
 * @param {{ lineName:string, products?:Array<{mat_no,line_name,is_active,is_operation}>, rules?:Array, lotMats?:Set<string>|string[] }} ctx
 * @returns {{ kind:'produce'|'consume', loc:string }}
 */
export function refStockOf(mat, { lineName, products = [], rules = [], lotMats = [] } = {}) {
  const m = key(mat);
  const prod = (products || []).find(p => key(p?.mat_no) === m && p?.is_active !== false);
  const madeHere = prod && !prod.is_operation && lineKey(prod.line_name) === lineKey(lineName);
  const lots = lotMats instanceof Set ? lotMats : new Set(lotMats || []);
  if (madeHere && lots.has(m)) return { kind: 'produce', loc: lineName };
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
 * @param {{ lineName, products, rules, lotMats, stds:Map<string,{min_qty,max_qty}> }} ctx
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
