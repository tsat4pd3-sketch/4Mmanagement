/* ═══ 📍 จุดเรียกเติม "อ้างยอดคลังไหน" — ของที่ไลน์ผลิตเอง vs ของที่ไลน์ใช้ (2026-10-08 · feedback Planning&Store)

   หน้างาน (คุณอัจฉรา 07/10): *"ตั้งจุดเรียกเติม ให้อ้างอิงจาก stock FG WAREHOUSE และ STORE ...
   มันจับ stock ที่ไลน์ผลิตแต่ละไลน์ ซึ่ง stock ไม่เท่ากัน เหมือนมันไม่ link mat"*

   วัดจริง 08/10: จุดเรียกเติมที่ตั้งไว้ 62 แถว (LINE A/B/C/D) — **61 แถวเป็นพาร์ทที่ไลน์นั้นผลิตเอง**
   แต่แผงเทียบกับยอด "หน้าไลน์" ซึ่งมีแต่แถวตรวจนับ (ของที่ผลิตเสร็จวิ่งเข้า FG WAREHOUSE / STORE
   ผ่าน `fn_post_confirmed_output` ตามกฎ `stock_inflow_rules`) ⇒ ยอดหน้าไลน์ไม่ขยับตามการผลิตเลย
   แล้วยังเสนอให้ "📦 เบิกจากสโตร์" ซึ่งผิดทิศ — ของที่ไลน์ผลิตเองต้อง **ผลิตเติม** ไม่ใช่เบิก

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

/**
 * แบ่งจุดเรียกเติมของไลน์ออกเป็น 2 ทาง
 * @param {Array} levels   แถว line_part_levels (min_qty/max_qty/reorder_qty)
 * @param {(loc:string, mat:string) => number|null} haveAt  ยอดคงเหลือ (null = ไม่มีแถว = ยังเช็คไม่ได้)
 * @returns {{ produceDue:Array, produceUnknown:Array, produceOk:number, consumeLevels:Array }}
 */
export function splitLevels(levels = [], ctx = {}, haveAt = () => null) {
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const out = { produceDue: [], produceUnknown: [], produceOk: 0, consumeLevels: [] };
  for (const lv of levels || []) {
    const ref = refStockOf(lv.mat_no, ctx);
    if (ref.kind === 'consume') { out.consumeLevels.push(lv); continue; }
    const min = num(lv.min_qty);
    if (min == null) continue;                                   // ไม่ตั้ง min = ไม่เฝ้า
    const have = haveAt(ref.loc, lv.mat_no);
    if (have == null) { out.produceUnknown.push({ ...lv, loc: ref.loc }); continue; }
    if (have > min) { out.produceOk += 1; continue; }
    const max = num(lv.max_qty), reorder = num(lv.reorder_qty);
    const qty = max != null ? Math.max(0, max - have) : (reorder ?? null);
    out.produceDue.push({ ...lv, loc: ref.loc, have, min, suggestQty: qty ? Math.round(qty) : null });
  }
  out.produceDue.sort((a, b) => (a.have / (a.min || 1)) - (b.have / (b.min || 1)));
  return out;
}
