/* ═══ 🌳 ระเบิดความต้องการลูกค้าลง BOM — "ไลน์ที่ทำพาร์ทลูกต้องเห็นงานของตัวเองด้วย" ═══════
   2026-09-22 · คำสั่ง user (audit แผนผลิต):
     *"ตอนนี้เมื่อเห็นความต้องการ mat 1xxxxxxx แล้ว ต้องไปแตก BOM เพื่อเห็นความต้องการของ mat เบอร์อื่นด้วย
       เพื่อคำนวณ capacity ของไลน์ผลิต"*

   ── ปัญหาเดิม ────────────────────────────────────────────────────────────────────
   `fn_explode_child_demand` (DR) เป็น **trigger บน `prod_orders`** = ระเบิด BOM *หลังปิดใบผลิตแล้ว*
   เพื่อออกใบเบิก/ตัดสต็อก — เป็นการ "เติมของที่ใช้ไปแล้ว" ไม่ใช่การวางแผนล่วงหน้า
   ส่วนแผนผลิตจับพาร์ท→ไลน์ตรงๆ จาก `dr_products.line_name` ⇒ **ไลน์ปั๊ม/เลเซอร์เห็นเฉพาะงานที่ลูกค้า
   สั่งพาร์ทลูกโดยตรง** ส่วนที่ต้องทำเพื่อป้อนไลน์ประกอบ ไม่เคยปรากฏในแผนเลย

   ── กติกาของไฟล์นี้ (ทั้งไฟล์ pure — ไม่แตะ supabase/react · มีเทส) ──────────────────
   1. **ความต้องการของพาร์ทลูก = ที่ลูกค้าสั่งตรง + ที่ระเบิดมาจาก BOM — บวกกัน ห้ามแทนกัน**
      (ของจริง 22/09: ลูกค้าสั่งพาร์ท 2xxxxxxx ตรงๆ อยู่แล้ว 687 แถว/18 mat บน LINE C/D/LASER)
   2. **ต่อโซ่หลายชั้นแบบ SAP** (คำตอบ user 22/09) ⇒ แถวที่ `explodeBom` ตีว่า `isDupeRow`
      (หลานที่ถูกใส่ซ้ำไว้ที่ชั้น 1 ของใบเดียวกัน) **ไม่ถูกนับ** — ไม่งั้นของก้อนเดียวถูกนับ 2-3 รอบ
      ⚠️ ตัวนี้ **ไม่แก้ข้อมูลให้** แค่ไม่นับตอนคำนวณ + คืนรายการออกไปให้จอโชว์เป็น worklist
         (กฎเดิมของ `bomTree.js`: จะลบแถวจริงหรือไม่ เป็นการตัดสินใจของ PE/Planning)
   3. **หน่วยต้องติดมาด้วยเสมอ** — BOM มีทั้ง PC และ KG (coil) · ผู้เรียกต้องกรองเอง
      ห้ามเอา KG ไปบวกกับชิ้นหรือเอาไปหารกำลังผลิตต่อกะ
   4. **วนลูปต้องไม่ทำให้ทั้งระบบค้าง** — `explodeBom` ตัดที่ `maxDepth` และคืน `cycles` มาให้ ต้องส่งต่อ
   5. ⏱️ **เฟส 1 ยังไม่เลื่อนวัน (lead time)** — ความต้องการของลูกถูกวางไว้ "วันเดียวกับดิวของแม่"
      ซึ่งมองโลกในแง่ดีเกินจริง (ของจริงลูกต้องเสร็จก่อน) · ใส่ `offsetDays` ได้เมื่อมีข้อมูล lead time
      **จอต้องเขียนบอกข้อนี้ ห้ามให้คนเข้าใจว่าเป็นวันที่ต้องเริ่มทำจริง**
   ═══════════════════════════════════════════════════════════════════════════════ */

const norm = (s) => String(s ?? '').trim().toUpperCase();

/** บวกจำนวนเข้า map โดยพก uom + ที่มาไปด้วย (ที่มา = ไว้ตอบ "ทำไมไลน์นี้ถึงมีงาน") */
function addNeed(map, mat, qty, uom, viaFg) {
  if (!mat || !(qty > 0)) return;
  const e = map[mat] || (map[mat] = { mat_no: mat, qty: 0, uom: uom || '', via: new Set() });
  e.qty += qty;
  if (!e.uom && uom) e.uom = uom;
  // หน่วยไม่ตรงกันระหว่างใบ = ข้อมูลขัดกันเอง ต้องไม่บวกมั่วแล้วเงียบ
  else if (uom && e.uom && norm(e.uom) !== norm(uom)) e.uomConflict = true;
  if (viaFg) e.via.add(viaFg);
}

/**
 * ระเบิดความต้องการ (ทุกชั้น) จากรายการความต้องการระดับบน
 *
 * @param {Array<{mat_no: string, qty: number}>} demand  ความต้องการตั้งต้น (ปกติคือ FG ที่ลูกค้าสั่ง)
 * @param {object} ix        ผลจาก `buildBomIndex(rows, matOf)` — ต้องมี bomOf + sheetFor
 * @param {Function} explode ฟังก์ชัน `explodeBom` (ส่งเข้ามาเพื่อให้ไฟล์นี้ยัง pure/เทสง่าย)
 * @param {object} [opt]     { chainMode = true, maxDepth = 10 }
 *   chainMode=false = นับแถวชั้น 1 ที่ซ้ำด้วย (พฤติกรรมแบบ "คง BOM แบน") — มีไว้เทียบเท่านั้น
 * @returns {{
 *   needByMat: Record<string, {mat_no, qty, uom, via: Set<string>, uomConflict?: boolean}>,
 *   flatDupes: Array<{root, mat_no, qtyAtLevel1, via}>,   // worklist ให้ PE/Planning ตัดสิน
 *   cycles: Array<string[]>, truncated: boolean, rootsWithBom: number, rootsNoBom: string[]
 * }}
 */
export function explodeDemand(demand = [], ix, explode, opt = {}) {
  const { chainMode = true, maxDepth = 10 } = opt;
  const needByMat = {};
  const flatDupes = [];
  const cycles = [];
  const rootsNoBom = [];
  let truncated = false;
  let rootsWithBom = 0;

  if (!ix || typeof explode !== 'function') return { needByMat, flatDupes, cycles, truncated, rootsWithBom, rootsNoBom };

  // รวมความต้องการของ mat เดียวกันก่อน — ระเบิดครั้งเดียวต่อ mat (ต้นไม้เดิมซ้ำๆ ไม่ต้องเดินหลายรอบ)
  const qtyByRoot = {};
  (demand || []).forEach(d => {
    const m = norm(d?.mat_no);
    const q = Number(d?.qty) || 0;
    if (m && q > 0) qtyByRoot[m] = (qtyByRoot[m] || 0) + q;
  });

  Object.entries(qtyByRoot).forEach(([root, rootQty]) => {
    const res = explode(root, ix.bomOf, { sheetFor: ix.sheetFor, maxDepth });
    const rows = res?.rows || [];
    if (!rows.length) { rootsNoBom.push(root); return; }
    rootsWithBom++;
    if (res.truncated) truncated = true;
    (res.cycles || []).forEach(c => cycles.push(c));
    (res.flatDupes || []).forEach(f => flatDupes.push({ ...f, root }));

    rows.forEach(r => {
      // ① ต่อโซ่แบบ SAP: ข้ามแถวชั้น 1 ที่เป็นสำเนาแบนของหลาน (ของก้อนเดียวกัน)
      if (chainMode && r.isDupeRow) return;
      // ② แถวที่เป็นจุดวนลูป — นับตัวมันเอง แต่ `explodeBom` หยุดเดินต่อให้แล้ว
      addNeed(needByMat, norm(r.mat_no), rootQty * (Number(r.qtyPerRoot) || 0), r.uom, root);
    });
  });

  return { needByMat, flatDupes, cycles, truncated, rootsWithBom, rootsNoBom };
}

/**
 * แปลงผลระเบิด → ความต้องการ "รายวัน" ต่อ mat (ไว้ต่อเข้าแผนรายวัน)
 * @param {Array<{mat_no, qty, due_date}>} demandRows  ความต้องการตั้งต้นที่มีวันครบดิว
 * @param {Function} explodeOne  (mat, qty) => needByMat   (ปกติห่อ explodeDemand ไว้)
 * @param {number} offsetDays    เลื่อนวันของลูกให้เร็วขึ้นกี่วัน (เฟส 1 = 0 · ดูกฎข้อ 5)
 * @returns {Record<string, Record<string, number>>}  date → mat → qty
 */
export function explodeDemandByDate(demandRows = [], explodeOne, offsetDays = 0, addDays) {
  const out = {};
  const byDate = {};
  (demandRows || []).forEach(r => {
    const d = r?.due_date;
    const m = norm(r?.mat_no);
    const q = Number(r?.qty) || 0;
    if (!d || !m || !(q > 0)) return;
    const bag = byDate[d] || (byDate[d] = {});
    bag[m] = (bag[m] || 0) + q;
  });
  Object.entries(byDate).forEach(([date, matQty]) => {
    const need = explodeOne(Object.entries(matQty).map(([mat_no, qty]) => ({ mat_no, qty })));
    const key = offsetDays && typeof addDays === 'function' ? addDays(date, -offsetDays) : date;
    const bag = out[key] || (out[key] = {});
    Object.values(need || {}).forEach(e => { bag[e.mat_no] = (bag[e.mat_no] || 0) + e.qty; });
  });
  return out;
}

/* ═══ 📦 หัก buffer stock ก่อนสั่งผลิตซ้ำ (net requirement) — 2026-09-22 · คำถาม user ═══
   *"ต้องไปคิดกับ buffer stock ใน store ป่ะ พาร์ทลูก"* — ใช่ · ของที่มีอยู่แล้วไม่ต้องผลิตซ้ำ

   🔴 กติกา
   1. **หักเรียงตามเวลา ห้ามหักทุก bucket ด้วยยอดเดิม** — ของกองเดียวกันใช้ได้ครั้งเดียว
      (หักซ้ำทุกวัน = ความต้องการหายเกือบหมด แล้วแผนบอก "ไม่ต้องเปิดกะ" ทั้งที่ของไม่พอ)
   2. **หักได้เฉพาะสต็อกที่เชื่อถือได้** — ผู้เรียกต้องส่งเฉพาะยอดที่ STORE เข้ามา
      ยอดคงเหลือ "ที่ไลน์" (mini-store) ห้ามเอามาหัก: backflush ไม่ทำงาน (issue 5,908 : consume 40)
      ⇒ สูงกว่าความจริงเสมอ · หักแล้ว = สั่งผลิตน้อยกว่าที่ต้องใช้ = ของขาด (ทิศอันตราย)
   3. คืน `absorbed` (ถูกหักไปเท่าไหร่) + `leftover` (เหลือเท่าไหร่) ให้จอบอกคนดูได้ว่าเลขหายไปไหน  */

/**
 * @param {Array<[string, Record<string, number>]>} buckets  [[คีย์เวลา, {mat: qty}], ...] **เรียงจากเร็วไปช้าแล้ว**
 * @param {Record<string, number>} stock  mat → ยอดที่หักได้ (ปกติ = ยอดที่ STORE)
 * @returns {{ buckets: Record<string, Record<string, number>>, absorbed: number, leftover: Record<string, number> }}
 */
export function netOffBuffer(buckets = [], stock = {}) {
  const left = { ...(stock || {}) };
  const out = {};
  let absorbed = 0;
  buckets.forEach(([key, matQty]) => {
    const bag = {};
    Object.entries(matQty || {}).forEach(([mat, qty]) => {
      const need = Math.max(0, Number(qty) || 0);
      // สต็อกติดลบ (ledger เพี้ยน) ต้องถือว่า 0 — ไม่งั้น `need - use` จะ **เพิ่ม** ความต้องการ
      const have = Math.max(0, Number(left[mat]) || 0);
      const use = Math.max(0, Math.min(need, have));
      if (use > 0) { left[mat] = have - use; absorbed += use; }
      const rest = need - use;
      if (rest > 0) bag[mat] = rest;      // 0 = ไม่ต้องผลิตรอบนี้ (ของพอ) — ตัดทิ้งได้
    });
    out[key] = bag;
  });
  return { buckets: out, absorbed, leftover: left };
}
