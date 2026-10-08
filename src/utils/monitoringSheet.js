/* ═══ 📗 ตัวแกะไฟล์ Monitoring ของแพลนนิ่ง (1.Monitoring-<เดือน>.xlsx) — 2026-09-23 ═══
   user 23/09: *"ไฟล์ที่แพลนนิ่งบอกว่าใช้วางแผนงานรายการอื่น"*
   = ช่องทางที่ 4 ของความต้องการลูกค้า ต่อจาก EDI 830 / 862 / e-SMART
   (ลูกค้า TSPK · TSESA · TSLA · TSRA · GWM · Argen ไม่ได้ส่ง EDI — แพลนนิ่งคุมด้วยไฟล์นี้มือ)

   ── ทำไมต้องมีตัวแกะเฉพาะ ไม่ใช้ `customer_pull_formats` เดิม ───────────────────
   ฟอร์แมต EDI เดิมเป็น **ตารางแถวต่อออเดอร์** (1 แถว = พาร์ท+วัน+จำนวน) จับด้วย alias หัวคอลัมน์ได้
   แต่ไฟล์นี้เป็น **บล็อกไขว้วัน** (pivot): 1 พาร์ท = หลายแถว (PLAN/IN/OUT/BALANCE/MIN) × คอลัมน์วันที่
   ⇒ ตัวอ่าน alias เดิมแกะไม่ได้เลย · จึงแยกเป็น kind ของตัวเอง **ห้ามยัดเข้า detectEdiKind**

   ── 🔴 กติกาที่ห้ามพลาด ────────────────────────────────────────────────────────
   1. **ไฟล์นี้เป็น "บอร์ดติดตาม" ไม่ใช่ "สมุดออเดอร์ล่วงหน้า"** — วัดจริง 23/09: ตัวเลขรายวันเต็ม
      ถึงวันที่เปิดไฟล์ แล้วบางลงทันที (PLAN ล่วงหน้าแค่ 2 วัน · OUT ล่วงหน้าหลักร้อย)
      ⇒ **ห้ามเอา `out` ไปลงเป็นออเดอร์ค้างส่ง** จะกลายเป็น backlog ปลอมมหาศาลในแผน
      · ของที่ใช้วางแผนได้จริง = `fc` (ยอดเดือน) · `min` (สต็อกขั้นต่ำ) · `orders[]` ของชีทลูกค้า
   2. **`plan` = แผนที่คนทำมือ ไม่ใช่ความต้องการ** — ระบบต้องคำนวณแผนเอง (capacityModel/backwardPlan)
      เก็บไว้ได้เพื่อ "เทียบว่าแผนคนกับแผนระบบต่างกันแค่ไหน" แต่**ห้ามเอาไปเป็น demand**
   3. **หน่วยเป็น "ชิ้น" ทุกช่อง** (ไม่มี KG เหมือน BOM) — แต่ `lot`/`packing` คือขนาดล็อต/บรรจุ
      ไม่ใช่จำนวนที่ต้องผลิต **ห้ามเอาไปบวกเป็นยอด**
   4. ทั้งไฟล์ pure — รับ `rows` (array ของ array) ที่ผู้เรียกอ่านมาแล้ว ไม่แตะ xlsx/supabase/react
      (มีเทส `__tests__/monitoringSheet.test.mjs`)
   ═══════════════════════════════════════════════════════════════════════════════ */

/** หัวคอลัมน์ → คีย์ · เทียบแบบตัดอักขระพิเศษ (ไฟล์จริงมีทั้ง "Mat SAP" / "Mat'l" / "MAT'L NO.") */
const normHead = (s) => String(s ?? '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');

const MAT_HEADS = ['MATSAP', 'MATL', 'MATLNO', 'MATSAP2', 'MATNO',
  /* ชีท mat (R402) เขียน " Mat'l SAP" — เพิ่ม 2026-10-01 ตอนทำบอร์ด Monitoring
     ✅ ตรวจแล้วไม่กระทบ `detectMonitoringKind`: ชีท mat ยังคืน null เหมือนเดิม (ไม่มีคอลัมน์ป้าย ·
     ไม่มี Order · ไม่มี FC+%SL) ⇒ MonitoringUpload ยังข้ามชีทนี้เหมือนเดิม ไม่มีพฤติกรรมไหนเปลี่ยน */
  'MATLSAP'];
/* ป้ายที่เจอจริงในไฟล์ — ชีทไลน์ปั๊มกับชีท Argen ใช้ชุดไม่เหมือนกัน แต่โครง "บล็อกป้าย × วัน" เดียวกัน
   ⇒ หาคอลัมน์ป้ายด้วยการ**สแกนหาคอลัมน์ที่มีป้ายซ้อนกันหลายตัว** ห้ามผูกกับหัวคอลัมน์ชื่อใดชื่อหนึ่ง
   (เดิมผูกกับหัว 'PLAN' ⇒ ชีท Argen ซึ่งหัวเป็น 'REQUIREMENT DATE' ถูกข้ามทั้งใบ = ตกความต้องการ
    ล่วงหน้าถึง มี.ค. 2027 รวม 1.33 ล้านชิ้น ซึ่งเป็นก้อนใหญ่สุดของไฟล์) */
const LABELS_PRESS = ['PLAN', 'IN', 'UNBOUND', 'OUT', 'BALANCE', 'WIP', 'MIN',
  'ORDERREQUIREMENT', 'PRODDATE', 'STOCKWH', 'SENDTOGREAT'];
const LABEL_DEMAND = 'ORDERREQUIREMENT';   // Argen: ความต้องการล่วงหน้าจริง (รายสัปดาห์)

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** cell → 'YYYY-MM-DD' แบบ local · null ถ้าไม่ใช่วันที่
 *  ⚠️ ห้ามใช้ `toISOString()` (UTC — เลื่อนวันสำหรับไทย ตามกฎ Date/Time ของโปรเจค) */
export function cellDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  return null;
}

/** index ของคอลัมน์แรกที่หัวตรงกับ heads ชุดหนึ่ง (−1 = ไม่เจอ) */
function findCol(row = [], heads = []) {
  const want = heads.map(normHead);
  for (let i = 0; i < row.length; i++) if (want.includes(normHead(row[i]))) return i;
  return -1;
}

/**
 * หาคอลัมน์ "ป้ายบล็อก" — คอลัมน์ที่มีคำว่า PLAN/IN/OUT/BALANCE/… ซ้อนกันลงมา
 * @returns {number} index (−1 = ไม่ใช่ชีทแบบบล็อก)
 */
function findLabelCol(rows = [], scanRows = 14) {
  const width = Math.max(...rows.slice(0, scanRows).map(r => (r || []).length), 0);
  let best = -1, bestHits = 0;
  for (let c = 0; c < width; c++) {
    let hits = 0;
    for (let r = 0; r < Math.min(rows.length, scanRows); r++) {
      if (LABELS_PRESS.includes(normHead(rows[r]?.[c]))) hits++;
    }
    if (hits > bestHits) { bestHits = hits; best = c; }
  }
  return bestHits >= 3 ? best : -1;
}

/**
 * แยกว่าแผ่นนี้เป็นแบบไหน — ต้องเดาให้ถูกก่อนเลือกตัวแกะ
 * @returns {'press'|'customer'|null}
 */
export function detectMonitoringKind(rows = []) {
  const r0 = rows[0] || [], r1 = rows[1] || [], r2 = rows[2] || [];
  if (findCol(r0, MAT_HEADS) < 0 && findCol(r1, MAT_HEADS) < 0) return null;
  if (findLabelCol(rows) >= 0) return 'press';
  // customer = แถว 2 มีคำว่า Order ใต้คอลัมน์วันที่
  if (r1.some(c => normHead(c) === 'ORDER') || r2.some(c => normHead(c) === 'ORDER')) return 'customer';
  /* grid (ชีท RA) = ตารางแบน 1 พาร์ท/แถว · มี FC + %SL + คอลัมน์วันที่
     🔴 เงื่อนไขต้องแคบ — ชีท 824-825 (งานชุบข้างนอก) ก็มี Forecast + วันที่ แต่ 1 พาร์ท = หลายแถว
     ตามทิศทางการไหล (ส่งไปชุบ / รับกลับ) ⇒ ถ้าแกะแบบ grid จะนับ "ส่งไปชุบ" เป็นยอดส่งลูกค้า
     จึงบังคับให้ต้องมีหัว %SL ด้วย (824-825 ไม่มี) แล้วปล่อยให้ตกไปกอง skipped อย่างตั้งใจ */
  for (const hr of [r0, r1, r2]) {
    if (findCol(hr, ['FC']) >= 0 && findCol(hr, ['%SL']) >= 0) return 'grid';
  }
  return null;
}

/**
 * ชีทตารางแบน (RA) — 1 พาร์ท = 1 แถว · FC + คอลัมน์วันที่ = **ยอดที่ส่งไปแล้ว** (ไม่ใช่ความต้องการ)
 * @returns {{parts: Array, warnings: string[]}}
 */
export function parseGridSheet(rows = []) {
  const warnings = [];
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    if (findCol(rows[i], ['FC']) >= 0 && findCol(rows[i], ['%SL']) >= 0) { h = i; break; }
  }
  if (h < 0) return { parts: [], warnings: ['ไม่พบหัวตาราง (ต้องมีทั้ง FC และ %SL)'] };
  const head = rows[h];
  const matCol = findCol(head, MAT_HEADS);
  if (matCol < 0) return { parts: [], warnings: ['ไม่พบคอลัมน์เลข MAT'] };
  const cName = findCol(head, ['Part Name', 'PART NAME']);
  const cFc = findCol(head, ['FC']);
  const dateCols = [];
  head.forEach((c, i) => { const d = cellDate(c); if (d) dateCols.push([i, d]); });
  if (!dateCols.length) warnings.push('ไม่พบคอลัมน์วันที่');

  const parts = [];
  let skippedRows = 0, blankRun = 0;
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const mat = String(row[matCol] ?? '').trim();
    if (!/^\d{6,}$/.test(mat)) {
      /* แถวที่มีตัวเลขอยู่จริงแต่ช่อง MAT ว่าง = ข้อมูลตกหล่นในไฟล์ต้นทาง (เจอจริงในชีท RA 2 แถว)
         — ต้องนับแล้วรายงาน **ห้ามข้ามเงียบ** */
      if (dateCols.some(([i]) => num(row[i]) > 0)) skippedRows++;
      /* 🔴 ชีทเดียวมีได้หลายตาราง — ชีท RA จริงมีตารางที่ 2 (สรุปงานชุบ) ต่อท้ายใต้ตารางหลัก
         ถ้าไล่อ่านจนสุดแผ่นจะเก็บขยะของตารางที่ 2 มาเป็นพาร์ท ⇒ หยุดเมื่อเจอแถวไม่มี MAT ติดกัน 3 แถว */
      if (++blankRun >= 3) break;
      continue;
    }
    blankRun = 0;
    const out = {};
    dateCols.forEach(([i, d]) => { const v = num(row[i]); if (v) out[d] = (out[d] || 0) + v; });
    parts.push({
      mat_no: mat,
      part_name: cName >= 0 ? String(row[cName] ?? '').trim() : '',
      customer_part_no: '', model: '', raw_material: '',
      lot: null, packing: null,
      fc: cFc >= 0 ? num(row[cFc]) || null : null,
      min: null, balance: null,
      plan: {}, out, demand: {},
    });
  }
  if (skippedRows) warnings.push(`ข้าม ${skippedRows} แถวที่มีตัวเลขแต่ช่อง MAT ว่าง — ไปเติมเลข SAP ในไฟล์ต้นทาง`);
  return { parts, dates: dateCols.map(([, d]) => d), warnings };
}

/**
 * ชีทไลน์ปั๊ม (110T/300T/250T/800T/600T/Argen) — 1 พาร์ท = บล็อกป้าย × คอลัมน์วันที่
 *
 * ⚠️ ตำแหน่งคอลัมน์**ไม่คงที่ระหว่างชีท** (110T มี 'Process' แทรก ทำให้ทุกอย่างเลื่อน 1 ช่อง)
 *    ⇒ หาโดยหัวคอลัมน์เสมอ ห้ามตรึง index
 *
 * @param {Array<Array>} rows  ทั้งแผ่น (row 1 = หัว, row 2 = วันที่)
 * @returns {{parts: Array, dates: string[], warnings: string[]}}
 */
export function parsePressSheet(rows = [], { asOf } = {}) {
  const head = rows[0] || [];
  const warnings = [];
  const matCol = findCol(head, MAT_HEADS);
  const labCol = findLabelCol(rows);
  if (matCol < 0 || labCol < 0) return { parts: [], dates: [], warnings: ['ไม่พบคอลัมน์ Mat SAP หรือคอลัมน์ป้ายบล็อก'] };

  /* แถววันที่: ปกติแถว 2 (ไลน์ปั๊ม) แต่ชีท Argen วันที่อยู่แถว 1 ⇒ เลือกแถวที่มีวันที่มากที่สุดใน 2 แถวแรก */
  const dateRowOf = (r) => {
    const out = [];
    (rows[r] || []).forEach((c, i) => { const d = cellDate(c); if (d) out.push([i, d]); });
    return out;
  };
  /* 🔴 ชีท Argen มี **แถววันที่ 2 แถว** ในคอลัมน์เดียวกัน: แถวบน = REQUIREMENT DATE (วันที่ลูกค้าต้องการ)
     แถวล่าง = "ส่งเกรท" (วันที่ **เรา** ต้องส่งออกไป ~3 สัปดาห์ก่อนหน้า)
     ⇒ ใช้**แถวล่างเสมอ** — เป็นวันที่ที่เราผูกพัน และเร็วกว่า (ปลอดภัยกว่าสำหรับการวางแผน)
     ชีทไลน์ปั๊มมีแถววันที่แถวเดียว (แถวบนเป็นชื่อวัน Sun/Mon) จึงตกมาที่แถวล่างเหมือนกัน */
  const d0 = dateRowOf(0), d1 = dateRowOf(1);
  const dateCols = d1.length ? d1 : d0;
  if (!dateCols.length) warnings.push('ไม่พบแถววันที่');
  const firstDataRow = dateCols === d1 ? 2 : 1;

  /* 🔴 ยอดคงเหลือต้องอ่าน "ณ วันอ้างอิง" ไม่ใช่ช่องขวาสุดของแถว
     ชีท Argen ลงความต้องการล่วงหน้าถึง มี.ค. 2027 แต่ยังไม่ลงแผนผลิต ⇒ ช่อง BALANCE ท้ายๆ
     เป็น**ยอดพยากรณ์ที่ติดลบเป็นแสน** (วัดจริง 23/09: ต่ำสุด −82,896) ถ้าเอาไปเขียนสต็อก
     = สต็อกจริงกลายเป็นติดลบทั้งระบบ · คอลัมน์ที่ใช้ = วันสุดท้ายที่ ≤ asOf */
  const balCols = asOf ? dateCols.filter(([, d]) => d <= asOf) : dateCols;
  if (asOf && !balCols.length) warnings.push(`ไม่มีคอลัมน์วันที่ก่อน ${asOf} — อ่านยอดคงเหลือไม่ได้`);
  if (!asOf) warnings.push('ไม่ได้ระบุวันอ้างอิง (asOf) — ยอดคงเหลืออ่านจากช่องขวาสุด อาจเป็นยอดพยากรณ์');

  const col = (h) => findCol(head, [h]);
  const cFc = col('FC'), cLot = col('LOT'), cPack = col('Packing'), cModel = col('Model');
  const cPart = col('PART NO.'), cName = col('PART NAME'), cRaw = col('Raw material');

  const parts = [];
  let cur = null;
  /* ⚠️ ชีท Argen วางแถว ORDER REQUIREMENT ไว้ **ก่อน** แถวที่มีเลข mat ของบล็อกนั้น
     ⇒ ถ้าเก็บใส่ "พาร์ทปัจจุบัน" ตรงๆ ความต้องการจะไปเกาะพาร์ทก่อนหน้าทั้งไฟล์ (เลื่อน 1 ตัว)
     จึงพักไว้ใน pending แล้วยกให้พาร์ทตัวถัดไปที่เปิดบล็อก */
  let pendingDemand = null;
  for (let r = firstDataRow; r < rows.length; r++) {
    const row = rows[r] || [];
    const matRaw = row[matCol];
    if (matRaw !== undefined && matRaw !== null && String(matRaw).trim() !== '') {
      cur = {
        mat_no: String(matRaw).trim(),
        customer_part_no: cPart >= 0 ? String(row[cPart] ?? '').trim() : '',
        part_name: cName >= 0 ? String(row[cName] ?? '').trim() : '',
        raw_material: cRaw >= 0 ? String(row[cRaw] ?? '').trim() : '',
        model: cModel >= 0 ? String(row[cModel] ?? '').trim() : '',
        lot: cLot >= 0 ? num(row[cLot]) || null : null,
        packing: cPack >= 0 ? num(row[cPack]) || null : null,
        fc: cFc >= 0 ? num(row[cFc]) || null : null,
        min: null, balance: null, stockWh: null,
        plan: {}, out: {}, demand: {},
      };
      if (pendingDemand) { cur.demand = pendingDemand; pendingDemand = null; }
      parts.push(cur);
    }
    const lab = normHead(row[labCol]);
    if (lab === LABEL_DEMAND) {
      const bag = {};
      dateCols.forEach(([i, d]) => { const v = num(row[i]); if (v > 0) bag[d] = (bag[d] || 0) + v; });
      if (pendingDemand) warnings.push(`พบ ORDER REQUIREMENT ซ้อนกันโดยไม่มีเลข MAT คั่น (แถว ${r + 1})`);
      pendingDemand = bag;
      continue;
    }
    if (!cur) continue;
    /* SEND TO GREAT (Argen) = ยอดที่ส่งออกไปจริง — ความหมายเดียวกับ OUT ของชีทไลน์ปั๊ม */
    if (lab === 'PLAN' || lab === 'OUT' || lab === 'SENDTOGREAT') {
      const bag = lab === 'PLAN' ? cur.plan : cur.out;
      dateCols.forEach(([i, d]) => { const v = num(row[i]); if (v) bag[d] = (bag[d] || 0) + v; });
    } else if (lab === 'MIN' || lab === 'BALANCE' || lab === 'STOCKWH') {
      /* MIN/BALANCE/STOCK W/H เป็น "ค่าคงเหลือ ณ วัน" ⇒ เอา**ช่องขวาสุดที่มีเลข** = ล่าสุด
         (ห้ามบวกรวมทุกวัน — เป็นยอดคงเหลือ ไม่ใช่ยอดไหล)
         · เก็บ STOCK W/H แยกไว้ แล้วให้ BALANCE ชนะตอนท้าย — ชีท Argen มีทั้งคู่ในบล็อกเดียว
           และ STOCK W/H มักเป็น 0 (ของไม่ได้ค้างที่คลัง) ถ้าปล่อยให้ทับกันจะได้สต็อกเป็น 0 ทั้งใบ */
      const key = lab === 'MIN' ? 'min' : (lab === 'BALANCE' ? 'balance' : 'stockWh');
      for (let k = balCols.length - 1; k >= 0; k--) {
        const v = row[balCols[k][0]];
        if (typeof v === 'number' && Number.isFinite(v)) { cur[key] = v; break; }
      }
    }
  }
  parts.forEach(p => { if (p.balance === null) p.balance = p.stockWh; });   // ไม่มี BALANCE ค่อยใช้ STOCK W/H
  if (pendingDemand) warnings.push('มีแถว ORDER REQUIREMENT ค้างท้ายไฟล์ที่ไม่มีพาร์ทรับ — ตรวจโครงชีท');
  return { parts, dates: dateCols.map(([, d]) => d), warnings };
}

/**
 * ชีทลูกค้า (TSPK / TSESA+LA / RA) — 1 พาร์ท = 1 แถว · คู่คอลัมน์ (Order, balance) ต่อวันส่ง
 *
 * วันส่งอยู่แถวหัว (แถว 1) ตรงคอลัมน์เดียวกับคำว่า "Order" ในแถวถัดมา
 * ⇒ ตัวนี้เท่านั้นที่ให้ **ออเดอร์ล่วงหน้าจริง** (press sheet ให้แค่ประวัติ)
 *
 * @returns {{parts: Array, warnings: string[]}}
 */
export function parseCustomerSheet(rows = []) {
  const warnings = [];
  // หาแถวที่มีคำว่า Order (แถวหัวย่อย) — ปกติแถว 2 แต่บางชีทเลื่อน
  let subIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    if ((rows[i] || []).some(c => normHead(c) === 'ORDER')) { subIdx = i; break; }
  }
  if (subIdx < 0) return { parts: [], dates: [], warnings: ['ไม่พบหัวคอลัมน์ "Order"'] };
  const sub = rows[subIdx] || [];
  const head = rows[subIdx - 1] || [];

  const orderCols = [];
  sub.forEach((c, i) => {
    if (normHead(c) !== 'ORDER') return;
    const d = cellDate(head[i]);
    if (d) orderCols.push([i, d]);
    else warnings.push(`คอลัมน์ Order ที่ ${i + 1} ไม่มีวันที่กำกับ — ข้าม`);
  });

  const matCol = (() => {
    // ชีทลูกค้าบางใบมี 2 คอลัมน์เลข (MAT.TSESA + MAT'L NO.) — เอา MAT'L NO. (เลข SAP ฝั่งเรา) ก่อน
    const c1 = findCol(head, ['MATLNO']);
    return c1 >= 0 ? c1 : findCol(head, MAT_HEADS);
  })();
  if (matCol < 0) return { parts: [], dates: [], warnings: [...warnings, 'ไม่พบคอลัมน์เลข MAT'] };

  const cPart = findCol(head, ['PART NO.']);
  const cMin = findCol(head, ['MIN']), cMax = findCol(head, ['MAX']);
  const cPack = findCol(head, ['P.STD.', 'Packing STD.']);
  const cStock = (() => { const i = findCol(sub, ['Stock W/H']); return i; })();
  const cWip = findCol(sub, ['ผลิต/WIP']);

  const parts = [];
  for (let r = subIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const matRaw = row[matCol];
    if (matRaw === undefined || matRaw === null || String(matRaw).trim() === '') continue;
    const mat = String(matRaw).trim();
    if (!/^\d{6,}$/.test(mat)) continue;                        // ข้ามแถวสรุป/ข้อความ
    const orders = [];
    orderCols.forEach(([i, d]) => { const v = num(row[i]); if (v > 0) orders.push({ due_date: d, qty: v }); });
    parts.push({
      mat_no: mat,
      customer_part_no: cPart >= 0 ? String(row[cPart] ?? '').trim() : '',
      packing: cPack >= 0 ? num(row[cPack]) || null : null,
      min: cMin >= 0 && typeof row[cMin] === 'number' ? row[cMin] : null,
      max: cMax >= 0 && typeof row[cMax] === 'number' ? row[cMax] : null,
      fg_stock: cStock >= 0 && typeof row[cStock] === 'number' ? row[cStock] : null,
      wip: cWip >= 0 && typeof row[cWip] === 'number' ? row[cWip] : null,
      orders,
    });
  }
  return { parts, dates: orderCols.map(([, d]) => d), warnings };
}

/**
 * แกะทั้งไฟล์ · ผู้เรียกส่ง `sheets` = [{ name, rows }] ที่อ่านมาแล้ว
 * @returns {{press: Array, customer: Array, skipped: Array, warnings: string[]}}
 */
export function parseMonitoringWorkbook(sheets = [], { asOf } = {}) {
  const out = { press: [], customer: [], skipped: [], warnings: [] };
  (sheets || []).forEach(({ name, rows }) => {
    const kind = detectMonitoringKind(rows);
    if (kind === 'press') {
      const r = parsePressSheet(rows, { asOf });
      out.press.push({ sheet: name, ...r });
      r.warnings.forEach(w => out.warnings.push(`[${name}] ${w}`));
    } else if (kind === 'grid') {
      const r = parseGridSheet(rows);
      out.press.push({ sheet: name, dates: [], ...r });   // โครงเรคคอร์ดเดียวกับ press ⇒ ใช้ตัวแปลงตัวเดียวกัน
      r.warnings.forEach(w => out.warnings.push(`[${name}] ${w}`));
    } else if (kind === 'customer') {
      const r = parseCustomerSheet(rows);
      out.customer.push({ sheet: name, ...r });
      r.warnings.forEach(w => out.warnings.push(`[${name}] ${w}`));
    } else {
      // ⚠️ ชีทที่แกะไม่ได้ต้องรายงานชื่อออกไป **ห้ามข้ามเงียบ** (ไฟล์เดือนหน้าอาจเพิ่มชีทใหม่)
      out.skipped.push(name);
    }
  });
  return out;
}

/**
 * แปลงผลแกะ → เรคคอร์ดพร้อมลง DB (ยังไม่แตะ DB — ให้หน้าเรียกใช้แล้วค่อย insert)
 * @param {object} parsed ผลจาก parseMonitoringWorkbook
 * @param {object} opt { monthKey: 'YYYY-MM' (เดือนของ FC), lineOfMat: (mat)=>lineName|null, today: 'YYYY-MM-DD' }
 *
 * 🔴 `today` สำคัญมาก — ชีท Argen เก็บความต้องการย้อนหลังไว้ทั้งปี (วัดจริง 23/09: **410 แถว
 *    862,508 ชิ้น อยู่ในอดีต**) ถ้าลงเป็นออเดอร์ค้างส่งทั้งหมด แผนรายวันจะขึ้น backlog ปลอม
 *    เกือบล้านชิ้นในวันแรก แล้วสั่งเปิดกะดึก/OT ทั้งโรงงานทันที
 *    ⇒ แถวที่ดิวเก่ากว่า `today` ถูกติดธง `past: true` ให้ผู้เรียกลงเป็น **ประวัติ (shipped)** เท่านั้น
 */
/* 🔴 FG (เลข MAT ขึ้นต้น 1) **ห้ามลงเป็น min/max ที่ไลน์** — `line_part_levels` คือ "ของที่ต้องมี
   อยู่ที่ไลน์เพื่อป้อนการผลิต" แต่ FG คือ**ของที่ไลน์ผลิตออกมา** ไม่ใช่ของที่สโตร์เบิกเข้าไป

   เคยเกิดจริง (user แจ้ง 2026-10-02 พร้อมภาพหน้าจอ): ชีทไลน์ปั๊มในไฟล์ Monitoring มีทั้ง FG และ
   ชิ้นส่วน (วัดจริง: FG 38 / ชิ้นส่วน 68 จาก 106 พาร์ท) · ตัวนำเข้า 23/09 เขียน `line_part_levels`
   ให้ **ทุก** พาร์ทรวม FG ⇒ `line_part_levels` ที่ใช้งานอยู่ 60 แถว **เป็น FG 28 แถว**
   และทุกแถว `line_name` = ไลน์ที่ผลิตพาร์ทนั้นเอง (ตรวจกับ `dr_products` แล้ว ตรงกันทุกตัว)
   ⇒ จอไลน์ (`LinePartCallPanel`) เสนอให้ไลน์ "เบิกของที่ตัวเองผลิต" แล้วเด้งเข้าคิวสโตร์
   ⇒ สโตร์เห็นเลข 1xxxxxxx ซึ่ง**ไม่มีทางตัดจ่ายได้** (ของที่สโตร์จ่ายเข้าไลน์คือ 2xxx/3xxx/5xxx)

   ⚠️ ไม่ได้แปลว่า FG ห้ามเข้าไลน์เสมอไป — FG ของไลน์หนึ่งเป็นชิ้นส่วนป้อนไลน์ประกอบได้จริง
      (นั่นคือตู้ "Store FG → ไลน์ประกอบ") แต่**ตัวนำเข้านี้** map พาร์ทกลับไปที่ "ไลน์ที่ผลิตมัน"
      เสมอ ⇒ ในบริบทนี้ FG = ขาออกเสมอ ไม่เคยเป็นขาเข้า */
const isFgMat = (mat) => String(mat ?? '').trim().charAt(0) === '1';

export function monitoringToRecords(parsed, { monthKey, lineOfMat, today, customers = [] } = {}) {
  /* 🔴 ชื่อลูกค้าต้องติดไปกับใบเสมอ (เพิ่ม 24/09) — เดิมไม่เขียนเลย ⇒ ใบทั้ง 232 ใบ customer = null
     จอ 🚚 Delivery จัดกลุ่มตามลูกค้า ⇒ ของจากไฟล์นี้ไปกองรวมใน "— ไม่ระบุลูกค้า —"
     แพลนนิ่งจึงรายงานว่า "ลูกค้า TSESA ไม่ขึ้น" ทั้งที่ระบบอ่านชีทได้
     · ชื่อมาจากทะเบียน `customers` เท่านั้น — ไม่มีในทะเบียน = null (ห้ามยัดชื่อชีทดิบเป็นลูกค้า) */
  const custOf = (sheet) => sheetCustomer(sheet, customers);
  const forecasts = [], orders = [], levels = [], lots = [], stock = [], shipped = [];
  /* นับ FG ที่ถูกกันออกจาก min/max ที่ไลน์ — ต้องรายงานออกไป **ห้ามข้ามเงียบ**
     (ข้ามเงียบ = คนนำเข้าไม่รู้ว่าตัวเลข min ในไฟล์บางส่วนไม่ได้ถูกใช้) */
  let fgLevelsSkipped = 0;
  const lineOf = typeof lineOfMat === 'function' ? lineOfMat : () => null;
  const markPast = (o) => ({ ...o, past: today ? o.due_date < today : false });

  (parsed?.press || []).forEach(({ sheet, parts }) => {
    parts.forEach(p => {
      if (p.fc > 0 && monthKey) {
        forecasts.push({ mat_no: p.mat_no, part_name: p.part_name, customer_part_no: p.customer_part_no || null,
                         customer: custOf(sheet),
                         period_month: `${monthKey}-01`, qty: p.fc, source: 'monitoring', note: `Monitoring · ${sheet}` });
      }
      const line = lineOf(p.mat_no);
      if (p.min > 0 && line && !isFgMat(p.mat_no)) levels.push({ line_name: line, mat_no: p.mat_no, min_qty: p.min, max_qty: null, note: `Monitoring · ${sheet}` });
      else if (p.min > 0 && line) fgLevelsSkipped++;   // FG = ขาออกของไลน์ ไม่ใช่ของที่เบิกเข้า (ดูหมายเหตุบนสุด)
      if (p.lot > 0 || p.packing > 0) lots.push({ mat_no: p.mat_no, part_name: p.part_name, lot_size: p.lot || null, qty_per_kanban: p.packing || null });
      if (typeof p.balance === 'number' && line) stock.push({ line_name: line, mat_no: p.mat_no, part_name: p.part_name, qty: p.balance, sheet });
      Object.entries(p.out || {}).forEach(([d, q]) => shipped.push({ mat_no: p.mat_no, part_name: p.part_name, due_date: d, qty: q, sheet }));
      /* ORDER REQUIREMENT (ชีท Argen) = ความต้องการล่วงหน้าจริง รายสัปดาห์ ⇒ เป็นออเดอร์ได้
         (ต่างจาก `out` ซึ่งเป็นประวัติการส่ง — ห้ามสลับ) */
      Object.entries(p.demand || {}).forEach(([d, q]) => orders.push(markPast({
        mat_no: p.mat_no, customer_part_no: p.customer_part_no || null, part_name: p.part_name,
        customer: custOf(sheet), sheet,
        due_date: d, qty: q, source: 'monitoring', note: `Monitoring · ${sheet} · ORDER REQUIREMENT`,
      })));
    });
  });

  (parsed?.customer || []).forEach(({ sheet, parts }) => {
    parts.forEach(p => {
      p.orders.forEach(o => orders.push(markPast({ mat_no: p.mat_no, customer_part_no: p.customer_part_no || null,
                                          customer: custOf(sheet), sheet,
                                          due_date: o.due_date, qty: o.qty, source: 'monitoring', note: `Monitoring · ${sheet}` })));
      if (p.min > 0) {
        const line = lineOf(p.mat_no);
        if (line && !isFgMat(p.mat_no)) levels.push({ line_name: line, mat_no: p.mat_no, min_qty: p.min, max_qty: p.max || null, note: `Monitoring · ${sheet}` });
        else if (line) fgLevelsSkipped++;
      }
      if (p.packing > 0) lots.push({ mat_no: p.mat_no, part_name: '', lot_size: null, qty_per_kanban: p.packing });
      /* FG ของชีทลูกค้า = ของสำเร็จรูปรอส่ง ⇒ อยู่คลัง FG ไม่ใช่ที่ไลน์
         (กฎ demand-flow: ยอด "ที่ไลน์" เชื่อไม่ได้เพราะ backflush ยังไม่ครบ) */
      if (typeof p.fg_stock === 'number') stock.push({ line_name: 'FG WAREHOUSE', mat_no: p.mat_no, part_name: '', qty: p.fg_stock, sheet });
    });
  });

  /* พาร์ทเดียวโผล่ได้หลายบล็อกในชีทเดียว (Argen มี 20065635/20065715 ซ้ำ) ⇒ สต็อกต้องเหลือแถวเดียว
     ไม่งั้น "ตั้งยอดให้ตรงชีท" จะถูกเขียน 2 รอบ แล้วรอบหลังทับรอบแรกโดยไม่มีใครรู้ว่าอันไหนถูก */
  /* 🔴 พาร์ทเดียวโผล่ 2 บล็อกในชีทเดียว (ของจริง: Argen มี 20065715 / 20065635 ซ้ำ ค่าตรงกันเป๊ะ)
     ⇒ ถ้าไม่ยุบ ความต้องการของพาร์ทนั้นกลายเป็น **2 เท่า** แล้วแผนสั่งเปิดกะเกินจริง
     ยุบด้วยคีย์ (mat, วันดิว, ชีท) เอาค่ามากสุด — ไม่บวกกัน เพราะเป็นข้อมูลชุดเดียวที่เขียนซ้ำ */
  const orderKey = (o) => `${o.mat_no}|${o.due_date}|${o.note || ''}`;
  const orderMap = new Map();
  orders.forEach(o => {
    const k = orderKey(o);
    const prev = orderMap.get(k);
    if (!prev || o.qty > prev.qty) orderMap.set(k, o);
  });
  const ordersUniq = [...orderMap.values()];
  const orderDupes = orders.length - ordersUniq.length;

  /* 🔴 MIN/MAX และ Forecast ต้องเหลือ **แถวเดียวต่อคีย์** ก่อนส่ง (06/10 · หลุดถึงมือ user)
     พาร์ทเดียวโผล่ได้หลายแถว/หลายชีท (300T: MAT 20059152 เขียน 2 บรรทัด คว่ำครีบ/หงายครีบ
     โดย FC เดือนเป็นของ "พาร์ท" ตัวเดียวกัน) ⇒ ส่งซ้ำในก้อนเดียวแล้ว:
       · MIN/MAX (upsert) → PostgreSQL ปฏิเสธ **ทั้งก้อน**
         `ON CONFLICT DO UPDATE command cannot affect row a second time`
       · Forecast (insert · ตารางไม่มี unique) → **ลงซ้ำเงียบๆ ⇒ ยอดพยากรณ์เป็น 2 เท่า**
         (เจอของจริงในฐาน 2 คู่: 20059152 ก.ย. 15,734 + ต.ค. 20,234 ถูกนับซ้ำ)
     ⇒ ยุบด้วย **ค่ามากสุด ห้ามบวกกัน** (เป็นข้อมูลชุดเดียวที่เขียนซ้ำ ไม่ใช่ของ 2 ก้อน)
     และต้องรายงานจำนวนที่ยุบ + จำนวนที่ "ค่าไม่ตรงกัน" ออกไปให้คนเห็น (ห้ามเงียบ) */
  const squash = (arr, keyOf, pick) => {
    const at = new Map(); let conflict = 0;
    for (const r of arr) {
      const k = keyOf(r); const prev = at.get(k);
      if (!prev) { at.set(k, r); continue; }
      const merged = pick(prev, r);
      if (merged.__differs) conflict++;
      delete merged.__differs;
      at.set(k, merged);
    }
    return { rows: [...at.values()], dupes: arr.length - at.size, conflict };
  };
  const lv = squash(levels, l => `${l.line_name}|${l.mat_no}`, (a, b) => ({
    ...a,
    min_qty: Math.max(a.min_qty, b.min_qty),
    max_qty: Math.max(a.max_qty || 0, b.max_qty || 0) || null,
    __differs: a.min_qty !== b.min_qty || (a.max_qty || null) !== (b.max_qty || null),
  }));
  const fc = squash(forecasts, f => `${f.mat_no}|${f.period_month}`, (a, b) => ({
    ...a, qty: Math.max(a.qty, b.qty), __differs: a.qty !== b.qty,
  }));

  const stockUniq = [...new Map(stock.map(s => [`${s.line_name}|${s.mat_no}`, s])).values()];
  /* 🔴 ยอดคงเหลือติดลบในไฟล์นี้ = "ความต้องการที่ยังไม่ได้ผลิต" ไม่ใช่ของติดลบในคลัง
     (วัดจริง 23/09: ชีท Argen มี 5 พาร์ทที่ BALANCE ถึง −47,168 เพราะลงความต้องการล่วงหน้าไว้
      แต่ยังไม่ลงแผนผลิต) ⇒ ห้ามเอาไปตั้งยอดทับสต็อกจริง · แยกออกมาให้คนดู */
  const stockOk = stockUniq.filter(s => s.qty >= 0);
  const stockNegative = stockUniq.filter(s => s.qty < 0);
  return { forecasts: fc.rows, forecastDupes: fc.dupes, forecastConflicts: fc.conflict,
           orders: ordersUniq, orderDupes,
           levels: lv.rows, levelDupes: lv.dupes, levelConflicts: lv.conflict,
           lots, stock: stockOk, stockNegative,
           stockDupes: stock.length - stockUniq.length, shipped, fgLevelsSkipped };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   🔎 รายงานรายชีท + ชื่อลูกค้า — เพิ่ม 2026-09-24 หลัง recheck จาก feedback แพลนนิ่ง
   ───────────────────────────────────────────────────────────────────────────────
   แพลนนิ่งแจ้ง 3 อาการ: "TSESA ไม่ขึ้น" · "PK model RG01 RT50 ไม่ขึ้น" ·
   "ขอรอบขายวันนี้ มันขึ้นยอดเดิมเมื่อวาน" — ไล่ไฟล์จริงแล้ว **ทั้ง 3 ข้อคือเนื้อในไฟล์
   ไม่ใช่ตัวอ่านผิด**:
     · ชีท TSESA+LA คอลัมน์วันที่ล่าสุด = 2026-08-06 (เก่ากว่าวันอัป 48 วัน) · ช่อง Order ว่างทั้งแผ่น
     · TSPK: 10076602/01 (RG01) และ 10073261/62 (RT50) ช่อง Order ว่าง — ส่วน RG01 อีก 2 ตัวขึ้นปกติ
     · ชีท TSPK มีคอลัมน์วันที่แค่ 23–26 ก.ย. ⇒ ไฟล์ = snapshot ของวันนั้น **ต้องอัปทุกวัน**

   🔴 บทเรียน: **"อ่านถูกแล้วไม่มีข้อมูล" กับ "อ่านไม่ออก" หน้าตาเหมือนกันบนจอ = ศูนย์เท่ากัน**
      ⇒ ตัวแปลงต้องรายงาน**รายชีท**เสมอว่าให้กี่ใบ และชีทนั้นครอบคลุมถึงวันไหน
      ไม่ใช่รายงานแค่ยอดรวม (เดิมบอกแค่ "ออเดอร์ 232 ใบ" แล้วคนเข้าใจว่าครบทุกลูกค้า)
   ═══════════════════════════════════════════════════════════════════════════════ */

/** ชื่อชีท → ลูกค้าในทะเบียน `customers`
 *  🔴 **ไม่มีในทะเบียน = คืน null ห้ามเดา** (กฎเดียวกับ matResolve — เดาผิดแย่กว่าไม่รู้)
 *  ชื่อชีทจริงมีขยะติดมา: ช่องว่างท้าย ("TSESA+LA ") · ต่อท้ายด้วย +XX ("+LA" = Latin America)
 *  @param {string} sheet        ชื่อชีท
 *  @param {Array}  registry     แถวจาก `customers` [{ code, name, aliases }]
 */
/** ส่วนต่างสต็อกที่ต้องลง ledger (`adjust`) ให้ยอดเท่าไฟล์ = ยอดในไฟล์ − ยอดปัจจุบัน ต่อไลน์+พาร์ท · 0 = ไม่ต้องลง
 *  🔴 QC 05/10 — ต้องเรียก**ซ้ำด้วยยอดสด ณ ตอนกดยืนยัน** (MonitoringUpload) ห้ามใช้ส่วนต่างตอนพรีวิว:
 *     กดยืนยันรอบแรกลงไปบางก้อนแล้วล้ม → กดซ้ำด้วยส่วนต่างเดิม = ยอดเพี้ยนซ้อน · คิดจากยอดสด ⇒ ก้อนที่ลงแล้วได้ 0 (ข้าม)
 *  `norm` = ตัวจับคู่เลข MAT ของหน้า (ตัดช่องว่าง/ขีด) · พาร์ทที่ไม่มีแถวสต็อก = ยอดปัจจุบัน 0 */
export function stockAdjustPlan(fileStock = [], stockRows = [], norm = (s) => String(s ?? '')) {
  const have = {};
  (stockRows || []).forEach(s => { have[`${s.line_name}|${norm(s.mat_no)}`] = Number(s.qty_on_hand) || 0; });
  return (fileStock || []).map(s => {
    const cur = have[`${s.line_name}|${norm(s.mat_no)}`] || 0;
    return { ...s, have: cur, delta: (Number(s.qty) || 0) - cur };
  }).filter(s => s.delta !== 0);
}

export function sheetCustomer(sheet, registry = []) {
  const raw = String(sheet ?? '').trim();
  if (!raw) return null;
  // ตัดส่วนต่อท้ายหลัง + (TSESA+LA → TSESA) แล้วเทียบทั้งแบบเต็มและแบบตัด
  const cands = [raw, raw.split('+')[0].trim()].filter(Boolean);
  const key = (x) => String(x ?? '').trim().toUpperCase();
  for (const c of cands) {
    const k = key(c);
    if (!k) continue;
    const hit = (registry || []).find(r =>
      key(r.code) === k || key(r.name) === k || (r.aliases || []).some(a => key(a) === k));
    if (hit) return hit.name || hit.code;
  }
  return null;
}

/** สรุปผลรายชีท — จอต้องโชว์ตารางนี้เสมอ ห้ามบอกแค่ยอดรวม
 *  @returns {Array<{sheet, kind, parts, orders, orderQty, lastDate, staleDays, customer, note}>}
 */
export function sheetReport(parsed, { today, customers = [] } = {}) {
  const out = [];
  const add = (kind, { sheet, parts = [], dates = [] }, countOrders) => {
    const orders = parts.reduce((n, p) => n + countOrders(p).length, 0);
    const orderQty = parts.reduce((n, p) => n + countOrders(p).reduce((a, o) => a + (Number(o.qty) || 0), 0), 0);
    const lastDate = dates.length ? dates.slice().sort().at(-1) : null;
    const staleDays = (lastDate && today)
      ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / 86400000)
      : null;
    out.push({
      sheet, kind, parts: parts.length, orders, orderQty, lastDate, staleDays,
      customer: sheetCustomer(sheet, customers),
      // ข้อความต้องแยก "อ่านไม่ออก" ออกจาก "อ่านได้แต่ไม่มีของ" ให้ชัด
      note: !parts.length ? 'อ่านพาร์ทไม่ได้เลย — โครงชีทอาจเปลี่ยน'
          : orders === 0 ? (staleDays != null && staleDays > 0
              ? `อ่านได้ ${parts.length} พาร์ท แต่ไม่มีออเดอร์ — ช่อง Order ว่าง (วันที่ล่าสุดในชีท ${lastDate} · เก่ากว่าวันนี้ ${staleDays} วัน)`
              : `อ่านได้ ${parts.length} พาร์ท แต่ช่อง Order ว่างทั้งแผ่น`)
          : null,
    });
  };
  (parsed?.customer || []).forEach(cs => add('ลูกค้า', cs, p => p.orders || []));
  (parsed?.press || []).forEach(ps => add('แท่นปั๊ม', ps,
    p => Object.entries(p.demand || {}).map(([, q]) => ({ qty: q }))));
  return out.sort((a, b) => (a.kind === b.kind ? b.orders - a.orders : a.kind < b.kind ? -1 : 1));
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
   📉 ตัวแกะ "เต็มเมทริกซ์" สำหรับบอร์ด Monitoring ในระบบ (2026-10-01)

   ต่างจาก `parsePressSheet` ข้างบนอย่างไร — และทำไมต้องมี 2 ตัว:
     • `parsePressSheet` = ตัวเดิม (23/09) **ยุบ** ไฟล์ให้เหลือ "สัญญาณความต้องการ" ไปลง
       monitoring_shipments/สต็อก — ทิ้งรายละเอียดรายวันของ PLAN/IN/UNBOUND ทั้งหมดโดยตั้งใจ
     • `parseBoardSheet` (ตัวนี้) **เก็บทุกช่อง** เพราะปลายทางคือ "บอร์ดที่ทีมวางแผนทำงานบนนั้น"
       (user 01/10: "เค้าอยากทำในระบบเรา" + "เอาทุกชีททุกหน้าเลย")
   ⇒ คนละคำถาม จึงคนละตัว **แต่ใช้ตัวหาหัวคอลัมน์/คอลัมน์ป้าย/วันที่ชุดเดียวกัน**
     (ห้ามก๊อป findLabelCol/cellDate ไปไว้ที่อื่น — ไฟล์เดือนหน้าเลื่อนคอลัมน์ แก้ที่นี่ที่เดียว)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/** ป้ายในไฟล์ → คีย์แถวในระบบ · 🔴 ป้ายใหม่ที่ไม่รู้จักต้องรายงาน ห้ามข้ามเงียบ */
export const BOARD_ROW_KEY = {
  PLAN: 'plan',
  IN: 'in',
  UNBOUND: 'unbound',
  OUT: 'out',
  BALANCE: 'balance',
  WIP: 'wip',
  MIN: 'min',
  MAX: 'max',
  ORDERREQUIREMENT: 'order_req',
  PRODDATE: 'prod_date',
  STOCKWH: 'stock_wh',
  SENDTOGREAT: 'send',
};

/** หัวคอลัมน์ที่เป็น "แอตทริบิวต์ของพาร์ท" (ไม่ใช่คอลัมน์วันที่) */
const ATTR_HEADS = [
  ['part_no', ['PART NO.']],
  ['part_name', ['PART NAME', 'Part Name']],
  ['model', ['Model']],
  ['raw_mat', ['Raw material']],
  ['process', ['Process']],
  ['rack', ['Rack']],
  ['lot_qty', ['LOT']],
  ['packing', ['Packing', 'Packing/std.', 'P.STD.', 'Packing GREAT']],
  ['cost', ['Cost', 'cost']],
  ['ct_sec', ['Time']],
  ['fc', ['FC', 'Forecast']],
];
const NUM_ATTRS = new Set(['lot_qty', 'packing', 'cost', 'ct_sec', 'fc']);

/**
 * ชีทแบบบล็อก (110T/300T/250T/800T/600T/Argen) → เมทริกซ์เต็ม
 *
 * @param {Array<Array>} rows ทั้งแผ่น
 * @returns {{
 *   parts: Array<{mat_no, part_no, part_name, …, cells: Object<rowKey, Object<date, number>>,
 *                 texts: Object<rowKey, Object<date, string>>}>,
 *   dates: string[], rowKeys: string[], warnings: string[]
 * }}
 *
 * 🔴 ช่องว่างในไฟล์ **ไม่ถูกเก็บ** (sparse) — "ว่าง" คือข้อเท็จจริงว่าวันนั้นไม่มีของไหล
 *    ถ้าเก็บเป็น 0 ทุกช่อง เมทริกซ์เดียวจะกิน 106 × 34 × 7 = 25,228 แถว ทะลุเพดานคิวรีทันที
 */
export function parseBoardSheet(rows = []) {
  const warnings = [];
  const head = rows[0] || [];
  const matCol = findCol(head, MAT_HEADS);
  const labCol = findLabelCol(rows);
  if (matCol < 0 || labCol < 0) {
    return { parts: [], dates: [], rowKeys: [], warnings: ['ไม่พบคอลัมน์ Mat SAP หรือคอลัมน์ป้ายบล็อก'] };
  }

  /* แถววันที่: ชีทไลน์ปั๊มอยู่แถว 2 (แถว 1 เป็นชื่อวัน Wed/Thu) · Argen อยู่แถว 1
     ⇒ เลือกแถวที่มีวันที่มากกว่า แล้วจำว่าข้อมูลเริ่มแถวไหน (ตรรกะเดียวกับ parsePressSheet) */
  const dateRowOf = (r) => {
    const out = [];
    (rows[r] || []).forEach((c, i) => { const d = cellDate(c); if (d) out.push([i, d]); });
    return out;
  };
  const d0 = dateRowOf(0);
  const d1 = dateRowOf(1);
  const dateCols = d1.length >= d0.length ? d1 : d0;
  if (!dateCols.length) warnings.push('ไม่พบแถววันที่');
  const firstDataRow = dateCols === d1 ? 2 : 1;

  const attrCol = {};
  for (const [key, heads] of ATTR_HEADS) {
    const i = findCol(head, heads);
    if (i >= 0) attrCol[key] = i;
  }

  const parts = [];
  const rowKeys = [];
  const seenLabel = new Set();
  const unknownLabels = new Set();
  let cur = null;
  /* ⚠️ Argen วางแถว ORDER REQUIREMENT ไว้ **ก่อน** แถวที่มีเลข mat ของบล็อกนั้น
     (เหตุผลเดียวกับ pendingDemand ใน parsePressSheet — ถ้าเก็บใส่พาร์ทปัจจุบันตรงๆ
     ความต้องการจะเลื่อนไปเกาะพาร์ทก่อนหน้าทั้งไฟล์) */
  let pending = null;

  const bagOf = (part, rk) => {
    if (!part.cells[rk]) part.cells[rk] = {};
    return part.cells[rk];
  };

  for (let r = firstDataRow; r < rows.length; r++) {
    const row = rows[r] || [];
    const matRaw = row[matCol];
    const hasMat = matRaw !== undefined && matRaw !== null && String(matRaw).trim() !== '';

    if (hasMat) {
      cur = { mat_no: String(matRaw).trim(), cells: {}, texts: {} };
      for (const [key, i] of Object.entries(attrCol)) {
        const v = row[i];
        if (NUM_ATTRS.has(key)) {
          const n = num(v);
          cur[key] = n || null;
        } else {
          const s = String(v ?? '').trim();
          cur[key] = s || null;
        }
      }
      if (pending) { cur.cells = pending.cells; cur.texts = pending.texts; pending = null; }
      parts.push(cur);
    }

    const labRaw = row[labCol];
    if (labRaw === undefined || labRaw === null || String(labRaw).trim() === '') continue;
    const lab = normHead(labRaw);
    const rk = BOARD_ROW_KEY[lab];
    if (!rk) { unknownLabels.add(String(labRaw).trim()); continue; }
    if (!seenLabel.has(rk)) { seenLabel.add(rk); rowKeys.push(rk); }

    /* ป้ายที่มาก่อนเลข MAT = พักไว้ให้พาร์ทตัวถัดไป */
    const target = cur || (pending ||= { cells: {}, texts: {} });

    for (const [i, d] of dateCols) {
      const v = row[i];
      if (v === undefined || v === null || v === '') continue;
      /* แถว PROD. DATE เก็บ "วันที่" ไม่ใช่จำนวน ⇒ เก็บแยกใน texts */
      const asDate = cellDate(v);
      if (rk === 'prod_date' || (asDate && typeof v !== 'number')) {
        if (!target.texts[rk]) target.texts[rk] = {};
        target.texts[rk][d] = asDate || String(v).trim();
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;   // #N/A, #DIV/0!, ข้อความ → ข้าม
      const bag = bagOf(target, rk);
      bag[d] = (bag[d] || 0) + v;
    }
  }

  if (pending) warnings.push('มีบล็อกป้ายค้างท้ายไฟล์ที่ไม่มีพาร์ทรับ — ตรวจโครงชีท');
  if (unknownLabels.size) {
    warnings.push(`ป้ายแถวที่ระบบยังไม่รู้จัก: ${[...unknownLabels].join(', ')} — เพิ่มใน BOARD_ROW_KEY ก่อนใช้`);
  }
  return { parts, dates: dateCols.map(([, d]) => d), rowKeys, warnings };
}

/**
 * ชีทลูกค้ารายแร็ค (TSPK / TSESA+LA) → เมทริกซ์เต็ม
 * 1 พาร์ท = 1 แถว · คู่คอลัมน์ (Order, balance) ต่อวันส่ง
 * ⇒ แปลงเป็นแถว `order` รายวัน + ยอดตั้งต้น (FG Total) ใส่ช่อง balance ของคอลัมน์แรก
 *
 * 🔴 คอลัมน์ balance ในไฟล์ **ไม่ต้องอ่าน** — เป็นผลของสูตร `=Total-Back-ΣOrder` ซึ่ง
 *    `RECUR.deplete` คิดใหม่ให้เหมือนกันเป๊ะ · อ่านมาเก็บ = มี 2 แหล่งความจริง
 */
export function parseRackSheet(rows = []) {
  const base = parseCustomerSheet(rows);
  const warnings = [...base.warnings];
  const dates = base.dates || [];
  const seed = dates[0] || null;
  const parts = (base.parts || []).map((p) => {
    const cells = { order: {} };
    for (const o of p.orders || []) if (o.qty) cells.order[o.due_date] = o.qty;
    /* FG ที่มีอยู่ตอนนี้ = Stock W/H + ผลิต/WIP (ไฟล์: L = J+K) → เป็น "ยอดยกมา" ของคอลัมน์แรก */
    const fg = (typeof p.fg_stock === 'number' ? p.fg_stock : 0) + (typeof p.wip === 'number' ? p.wip : 0);
    if (seed && (p.fg_stock !== null || p.wip !== null)) cells.balance = { [seed]: fg };
    if (seed && p.min !== null && p.min !== undefined) cells.min = { [seed]: p.min };
    if (seed && p.max !== null && p.max !== undefined) cells.max = { [seed]: p.max };
    return {
      mat_no: p.mat_no,
      part_no: p.customer_part_no || null,
      packing: p.packing ?? null,
      cells,
      texts: {},
    };
  });
  return { parts, dates, rowKeys: ['order', 'balance', 'min', 'max'], warnings };
}

/**
 * ชีทวัตถุดิบม้วน (mat — DAILY REPORT STORE RAW MATERIAL R402) → รายการเหล็กม้วน
 * ไม่มีคอลัมน์วันที่ (เป็นภาพ ณ ปัจจุบัน) ⇒ ลงเป็นพาร์ทพร้อม `kg_per_piece` + ยอดคงเหลือวันนี้
 *
 * ⚠️ ไฟล์เดิมคนพิมพ์ `*2` / `/2` มือรายแถวสำหรับงานที่ปั๊มทีเดียวได้ 2 ชิ้น
 *    ⇒ แปลงเป็น `pieces_per_shot` (กฎเหล็ก "ชิ้น ≠ shot") **ห้ามให้คนพิมพ์ตัวคูณในหน้าซ้ำ**
 *    อ่านจากข้อความในคอลัมน์ "อัตราการใช้" เช่น "0.341 Kgs. (ได้ 2 ชิ้น)" / "(ได้ R/L)"
 */
export function parseRawSheet(rows = [], { asOf } = {}) {
  const warnings = [];
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    if (findCol(rows[i], MAT_HEADS) >= 0) { h = i; break; }
  }
  if (h < 0) return { parts: [], dates: [], rowKeys: [], warnings: ['ไม่พบคอลัมน์เลข MAT'] };
  const head = rows[h];
  const matCol = findCol(head, MAT_HEADS);
  const cDesc = findCol(head, ['Description']);
  const cSemi = findCol(head, ['Semi Part']);
  const cRateTxt = findCol(head, ['อัตราการใช้']);
  const cRate = findCol(head, ['อัตรา']);
  const cOnHand = findCol(head, ['คงเหลือ']);
  const cQueue = findCol(head, ['งานท้ายไลน์(ชิ้น)', 'งานท้ายไลน์']);
  const seed = asOf || null;

  const parts = [];
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const mat = String(row[matCol] ?? '').trim();
    if (!/^\d{6,}$/.test(mat)) continue;
    const rateTxt = cRateTxt >= 0 ? String(row[cRateTxt] ?? '') : '';
    /* "(ได้ 2 ชิ้น)" → 2 · "(ได้ R/L)" / "(ได้ R2...)" → 2 (ซ้าย-ขวาออกมาพร้อมกัน) */
    const mNum = rateTxt.match(/ได้\s*(\d+)\s*ชิ้น/);
    const pieces = mNum ? Number(mNum[1]) : (/ได้\s*R\s*\/?\s*L|ได้\s*R\d/i.test(rateTxt) ? 2 : null);
    const cells = {};
    if (seed) {
      const oh = cOnHand >= 0 ? row[cOnHand] : null;
      const q = cQueue >= 0 ? row[cQueue] : null;
      if (typeof oh === 'number' && Number.isFinite(oh)) cells.on_hand_kg = { [seed]: oh };
      if (typeof q === 'number' && Number.isFinite(q)) cells.queue_pcs = { [seed]: q };
    }
    parts.push({
      mat_no: mat,
      spec: cDesc >= 0 ? String(row[cDesc] ?? '').trim() || null : null,
      semi_part: cSemi >= 0 ? String(row[cSemi] ?? '').trim() || null : null,
      kg_per_piece: cRate >= 0 ? num(row[cRate]) || null : null,
      pieces_per_shot: pieces && pieces >= 1 && pieces <= 20 ? pieces : null,
      cells,
      texts: {},
    });
  }
  if (!seed) warnings.push('ไม่ได้ระบุวันอ้างอิง (asOf) — ยอดคงเหลือเหล็กไม่ถูกเก็บ');
  return { parts, dates: seed ? [seed] : [], rowKeys: ['on_hand_kg', 'queue_pcs'], warnings };
}

/* ── ชีทไหนกลายเป็นบอร์ดชนิดอะไร ───────────────────────────────────────────────────
   🔴 ชีทที่ไม่เข้าเกณฑ์ต้อง**คืนเหตุผล** ไม่ใช่คืน null เฉยๆ — ไฟล์เดือนหน้าอาจเพิ่มชีทใหม่
     แล้วถ้าจอบอกแค่ "ข้าม 3 ชีท" ไม่มีใครรู้ว่าข้ามเพราะอะไร (จอต้องบอกตรงๆ)

   ชีทที่**ตั้งใจไม่ทำเป็นบอร์ด** (ไม่ใช่ของตกหล่น):
     • `Vlookup Argen` = ตารางค้นหายอดลูกค้ารายสัปดาห์ที่ **ป้อนแถว ORDER REQUIREMENT ของชีท Argen**
       ⇒ เป็น "แหล่งข้อมูลของบอร์ด Argen" ไม่ใช่บอร์ดแยก · ทำเป็นบอร์ดจะได้ยอดลูกค้า 2 ที่
     • `Sheet1`, `Sheet1 (2)`, `รอบ RA` = กระดาษทดของทีมวางแผน (รายการ packing + โน้ตจิปาถะ)
       ไม่มีโครงตารางที่คงที่ ⇒ ยกเข้าระบบไม่ได้และไม่ควรยก                                 */
const SOURCE_SHEETS = ['VLOOKUPARGEN'];
const SCRATCH_SHEETS = ['SHEET1', 'SHEET12', 'ROBRA'];

export function boardKindOfSheet(name, rows = []) {
  const n = normHead(name);
  if (SOURCE_SHEETS.includes(n)) {
    return { kind: null, why: 'ตารางค้นหาที่ป้อนบอร์ด Argen (ไม่ใช่บอร์ดแยก)', intentional: true };
  }
  if (SCRATCH_SHEETS.includes(n) || /^SHEET\d/.test(n)) {
    return { kind: null, why: 'กระดาษทด ไม่มีโครงตารางคงที่', intentional: true };
  }
  /* ชีทไลน์ปั๊ม: ชื่อเป็นตันของเครื่อง (110T · 300T · 800T …) */
  if (/^\d+T$/.test(n)) return { kind: 'line', why: '' };
  /* ชีทวัตถุดิบม้วน: มีคอลัมน์ "อัตราการใช้" หรือหัวเรื่อง RAW MATERIAL */
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    if (findCol(rows[i], ['อัตราการใช้']) >= 0) return { kind: 'raw', why: '' };
  }
  if (/RAWMATERIAL/.test(normHead(rows[0]?.[0]))) return { kind: 'raw', why: '' };
  /* งานส่งชุบแบบบล็อก (824-825): ต้องเจอป้าย **ที่เป็นเอกลักษณ์** คือทิศทางการส่ง
     🔴 ห้ามใช้ 'Diff forecast' เป็นตัวตัดสิน — ชีท RA มีหัวคอลัมน์ 'Diff Forecast' ด้วย
       (เคยพลาดจริง 01/10: RA ถูกส่งเข้าตัวแกะแบบบล็อก แล้วได้ 0 ช่อง + เตือนป้ายมั่ว 10 ตัว) */
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    for (const c of rows[i] || []) {
      const k = VENDOR_LABELS[normHead(c)];
      if (k === 'to_vendor' || k === 'from_vendor' || k === 'at_vendor') return { kind: 'vendor', why: '', flat: false };
    }
  }
  const k = detectMonitoringKind(rows);
  if (k === 'customer') return { kind: 'rack', why: '' };
  if (k === 'press') return { kind: 'great', why: '' };
  if (k === 'grid') return { kind: 'vendor', why: '', flat: true };
  return { kind: null, why: 'แกะโครงไม่ได้ (ไม่พบคอลัมน์ MAT / คอลัมน์ป้าย / คอลัมน์วันที่)', intentional: false };
}

/**
 * ตัวเดียวที่หน้า import เรียก — เลือกตัวแกะให้ตามชนิดชีท
 * @returns {{kind, flat, why, intentional, parts, dates, rowKeys, warnings}}
 */
export function parseSheetForBoard(name, rows = [], { asOf } = {}) {
  const d = boardKindOfSheet(name, rows);
  if (!d.kind) return { ...d, parts: [], dates: [], rowKeys: [], warnings: [] };
  let r;
  if (d.kind === 'line' || d.kind === 'great') r = parseBoardSheet(rows);
  else if (d.kind === 'rack') r = parseRackSheet(rows);
  else if (d.kind === 'raw') r = parseRawSheet(rows, { asOf });
  else if (d.kind === 'vendor') r = d.flat ? parseVendorFlatSheet(rows) : parseVendorBlockSheet(rows);
  else r = { parts: [], dates: [], rowKeys: [], warnings: ['ชนิดบอร์ดที่ยังไม่มีตัวแกะ'] };
  const m = mergeDuplicateParts(r.parts);
  return { ...d, ...r, parts: m.parts, warnings: [...(r.warnings || []), ...m.warnings] };
}

/* ═══ เลข MAT ซ้ำในชีทเดียว → รวมเป็นพาร์ทเดียว (2026-10-05 · เคสจริงชีท Argen)
   ตาราง `monitor_board_parts` unique (board_id, mat_no) ⇒ ส่ง MAT ซ้ำใน upsert ก้อนเดียว
   = Postgres โยน *"ON CONFLICT DO UPDATE command cannot affect row a second time"* ⇒ **นำเข้าล้มทั้งบอร์ด**
   กติกา (ห้ามทิ้งแถวเงียบ · ห้ามเดาเกินหลักฐาน):
   · แถว "ยอดไหล" (PLAN/IN/OUT/ORDER REQUIREMENT/ส่งชุบ) = **บวกกัน** (ความต้องการ 2 บล็อกของ MAT เดียว = ต้องการรวม)
   · แถว "ระดับ/ยอดคงเหลือ" (BALANCE/UNBOUND/WIP/MIN/MAX/STOCK W/H/ค้างที่ร้านชุบ) + ข้อความ + แอตทริบิวต์
     = **แถวแรกชนะ** (ของชิ้นเดียวกันนับ 2 รอบ = สต็อกปลอม) · ค่าที่ขัดกันต้องขึ้นเป็นคำเตือน
   · ทุก MAT ที่ซ้ำต้องขึ้นคำเตือนบนจอ preview ให้ทีมวางแผนไปแก้ไฟล์ต้นทาง */
const FLOW_ROW_KEYS = new Set(['plan', 'in', 'out', 'order_req', 'send', 'order', 'to_vendor', 'from_vendor']);

export function mergeDuplicateParts(parts = []) {
  const byMat = new Map();
  const out = [];
  const dup = new Map();          // mat → จำนวนแถว
  const clash = new Set();        // mat ที่ค่าระดับ/คงเหลือขัดกัน
  for (const p of parts || []) {
    const k = String(p?.mat_no ?? '').trim();
    if (!k) { out.push(p); continue; }
    const first = byMat.get(k);
    if (!first) {
      const copy = { ...p, cells: {}, texts: {} };
      for (const [rk, m] of Object.entries(p.cells || {})) copy.cells[rk] = { ...m };
      for (const [rk, m] of Object.entries(p.texts || {})) copy.texts[rk] = { ...m };
      byMat.set(k, copy); out.push(copy);
      continue;
    }
    dup.set(k, (dup.get(k) || 1) + 1);
    for (const [key, v] of Object.entries(p)) {
      if (key === 'cells' || key === 'texts') continue;
      if ((first[key] === null || first[key] === undefined || first[key] === '') && v !== null && v !== undefined) first[key] = v;
    }
    for (const [rk, m] of Object.entries(p.cells || {})) {
      const bag = (first.cells[rk] ||= {});
      for (const [d, v] of Object.entries(m || {})) {
        if (FLOW_ROW_KEYS.has(rk)) bag[d] = (bag[d] || 0) + v;
        else if (bag[d] === undefined) bag[d] = v;
        else if (bag[d] !== v) clash.add(k);
      }
    }
    for (const [rk, m] of Object.entries(p.texts || {})) {
      const bag = (first.texts[rk] ||= {});
      for (const [d, v] of Object.entries(m || {})) if (bag[d] === undefined) bag[d] = v;
    }
  }
  const warnings = [];
  if (dup.size) {
    warnings.push(`เลข MAT ซ้ำในชีท ${dup.size} ตัว (${[...dup].map(([m, n]) => `${m} ×${n}`).join(', ')}) — `
      + 'รวมเป็นแถวเดียว: ยอดไหล (PLAN/IN/OUT/ความต้องการ) บวกกัน · ยอดคงเหลือ/MIN/MAX ใช้แถวแรก — ตรวจไฟล์ต้นทาง');
  }
  if (clash.size) warnings.push(`ยอดคงเหลือ/MIN/MAX ของ MAT ซ้ำไม่ตรงกัน: ${[...clash].join(', ')} — ใช้ค่าของแถวแรก`);
  return { parts: out, warnings };
}


/* ── ชีทงานส่งชุบข้างนอก (RA · 824-825) ────────────────────────────────────────────────
   🔴 **ห้ามเอาป้ายของ 2 ชีทนี้ไปใส่ `LABELS_PRESS`** — `detectMonitoringKind` ใช้ลิสต์นั้น
     ถ้าใส่เข้าไป ชีท 824-825 จะกลายเป็น kind='press' แล้ว MonitoringUpload (จอเดิม 23/09)
     จะเริ่มเขียน "ส่งไปชุบ" เป็นยอดส่งลูกค้า ซึ่งเป็นบั๊กที่คอมเมนต์ของมันเตือนไว้ตรงๆ
     ⇒ ตัวหาคอลัมน์ป้ายของ 2 ชีทนี้แยกเป็นของตัวเอง · blast radius = 0

   ⚠️ ข้อเท็จจริงที่ต้องบอกคนใช้: ในไฟล์เดือน ต.ค. **2 ชีทนี้ยังเป็นวันที่ ส.ค.-ก.ย.**
     = ทีมวางแผนไม่ได้อัพเดทมันรายเดือนเหมือนชีทไลน์ปั๊ม ⇒ จอต้องโชว์ว่าข้อมูลหยุดที่วันไหน */
const VENDOR_LABELS = {
  TSAT4TOJRPE: 'to_vendor',
  JRPETOTSAT4: 'from_vendor',
  STOCKVENDOR: 'at_vendor',
  DIFFFORECAST: 'diff_fc',
};

/** ชีท 824-825 — บล็อกป้ายของงานชุบ (ป้ายคนละชุดกับชีทไลน์ปั๊ม) */
export function parseVendorBlockSheet(rows = []) {
  const warnings = [];
  /* หาแถวหัว = แถวที่มีทั้งเลข MAT และคอลัมน์วันที่ */
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (findCol(rows[i], MAT_HEADS) >= 0 && (rows[i] || []).some((c) => cellDate(c))) { h = i; break; }
  }
  if (h < 0) return { parts: [], dates: [], rowKeys: [], warnings: ['ไม่พบแถวหัวที่มีทั้งเลข MAT และวันที่'] };
  const head = rows[h];
  const matCol = findCol(head, MAT_HEADS);
  const cPart = findCol(head, ['PART NO.']);
  const cFc = findCol(head, ['Forecast', 'FC']);
  const dateCols = [];
  head.forEach((c, i) => { const d = cellDate(c); if (d) dateCols.push([i, d]); });
  if (!dateCols.length) return { parts: [], dates: [], rowKeys: [], warnings: ['ไม่พบคอลัมน์วันที่'] };

  /* หาคอลัมน์ป้ายด้วยลิสต์ของชีทนี้เอง */
  let labCol = -1, bestHits = 0;
  const width = Math.max(...rows.slice(0, 20).map((r) => (r || []).length), 0);
  for (let c = 0; c < width; c++) {
    let hits = 0;
    for (let r = h; r < Math.min(rows.length, h + 20); r++) if (VENDOR_LABELS[normHead(rows[r]?.[c])]) hits++;
    if (hits > bestHits) { bestHits = hits; labCol = c; }
  }
  if (labCol < 0) return { parts: [], dates: [], rowKeys: [], warnings: ['ไม่พบคอลัมน์ป้าย (TSAT4 to JRPE / Stock Vendor …)'] };

  /* 🔴 ชีทนี้มี **คอลัมน์ยอดยกมาที่ไม่มีวันที่กำกับ** อยู่ก่อนคอลัมน์วันที่แรก
     (Stock Vendor = 849 ที่คอลัมน์ก่อน 2026-09-01 ซึ่งมี 599) = สต๊อกที่ร้านก่อนเริ่มช่วง
     ⇒ ยกให้เป็นคอลัมน์ "วันก่อนวันแรก" ให้โครงเหมือนชีทไลน์ปั๊ม (คอลัมน์แรก = ยอดยกมา)
     ถ้าทิ้งไป สูตร vendor_wip จะเริ่มจาก null = ทั้งแถวว่าง */
  const firstDateCol = dateCols[0][0];
  const seedCol = firstDateCol - 1 > labCol ? firstDateCol - 1 : -1;
  const seedDate = addDaysStr(dateCols[0][1], -1);

  /* 🔴 1 บล็อกในชีทนี้ = **1 พาร์ท แต่มีเลข SAP 2 ตัว** (ก่อนชุบ / หลังชุบ)
     งานชิ้นเดียวเปลี่ยนเลขตอนส่งไปชุบแล้วกลับมาเป็นอีกเลข ⇒ ถ้าเปิดพาร์ทใหม่ทุกครั้งที่เจอ
     เลข 6 หลัก จะได้ 2 พาร์ทที่แถวไม่ครบคนละครึ่ง (เคยพลาดจริง 01/10: พาร์ทแรกมีแต่ to_vendor
     พาร์ทที่สองมีแต่ from_vendor ⇒ สูตร vendor_wip คิดไม่ได้เลยทั้งใบ)
     ⇒ เปิดพาร์ทใหม่เมื่อเจอ "ก่อนชุบ" · เลข "หลังชุบ" เก็บเป็น mat_after ของพาร์ทเดิม */
  const stageCol = (() => {
    for (let c = 0; c <= Math.max(labCol, matCol); c++) {
      for (let r = h + 1; r < Math.min(rows.length, h + 20); r++) {
        if (/ก่อนชุบ/.test(String(rows[r]?.[c] ?? ''))) return c;
      }
    }
    return -1;
  })();
  if (stageCol < 0) warnings.push('ไม่พบคอลัมน์ขั้น (ก่อนชุบ/หลังชุบ) — แยกบล็อกด้วยเลข MAT แทน');

  const parts = [];
  const rowKeys = [];
  const seen = new Set();
  const unknown = new Set();
  let cur = null;
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const matRaw = String(row[matCol] ?? '').trim();
    const stage = stageCol >= 0 ? String(row[stageCol] ?? '') : '';
    const isMat = /^\d{6,}$/.test(matRaw);
    const startsBlock = stageCol >= 0 ? (/ก่อนชุบ/.test(stage) && isMat) : isMat;
    if (startsBlock) {
      cur = {
        mat_no: matRaw,
        mat_after: null,
        part_no: cPart >= 0 ? String(row[cPart] ?? '').trim() || null : null,
        fc: cFc >= 0 ? num(row[cFc]) || null : null,
        cells: {}, texts: {},
      };
      parts.push(cur);
    } else if (cur && isMat && /หลังชุบ/.test(stage)) {
      cur.mat_after = matRaw;
    }
    if (!cur) continue;
    const labRaw = row[labCol];
    if (labRaw === undefined || labRaw === null || String(labRaw).trim() === '') continue;
    const lab = normHead(labRaw);
    const rk = VENDOR_LABELS[lab];
    if (!rk) {
      /* "Diff % forecast" เป็นผลหารของ Diff forecast ⇒ ไม่เก็บโดยตั้งใจ (คิดสดได้) */
      if (lab !== 'DIFFFORECAST' && !/^DIFF/.test(lab)) unknown.add(String(labRaw).trim());
      continue;
    }
    if (!seen.has(rk)) { seen.add(rk); rowKeys.push(rk); }
    if (!cur.cells[rk]) cur.cells[rk] = {};
    if (seedCol >= 0) {
      const sv = row[seedCol];
      if (typeof sv === 'number' && Number.isFinite(sv)) cur.cells[rk][seedDate] = sv;
    }
    for (const [i, d] of dateCols) {
      const v = row[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      cur.cells[rk][d] = (cur.cells[rk][d] || 0) + v;
    }
  }
  if (unknown.size) warnings.push(`ป้ายงานชุบที่ยังไม่รู้จัก: ${[...unknown].join(', ')}`);
  return {
    parts,
    dates: [seedDate, ...dateCols.map(([, d]) => d)],
    rowKeys,
    warnings,
  };
}

/** ชีท RA — ตารางแบน 1 พาร์ท/แถว · คอลัมน์วันที่ = ยอดที่ส่งไปแล้วในวันนั้น */
export function parseVendorFlatSheet(rows = []) {
  const warnings = [];
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (findCol(rows[i], MAT_HEADS) >= 0 && (rows[i] || []).some((c) => cellDate(c))) { h = i; break; }
  }
  if (h < 0) return { parts: [], dates: [], rowKeys: [], warnings: ['ไม่พบแถวหัวที่มีทั้งเลข MAT และวันที่'] };
  const head = rows[h];
  const matCol = findCol(head, MAT_HEADS);
  const cName = findCol(head, ['Part Name', 'PART NAME']);
  const cFc = findCol(head, ['FC', 'Forecast']);
  const dateCols = [];
  head.forEach((c, i) => { const d = cellDate(c); if (d) dateCols.push([i, d]); });

  const parts = [];
  let blankRun = 0, skipped = 0;
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const mat = String(row[matCol] ?? '').trim();
    if (!/^\d{6,}$/.test(mat)) {
      if (dateCols.some(([i]) => num(row[i]) > 0)) skipped++;
      /* ชีท RA มีตารางที่ 2 (สรุปงานชุบ) ต่อท้าย ⇒ หยุดเมื่อไม่มี MAT ติดกัน 3 แถว
         (เหตุผลเดียวกับ parseGridSheet — ไล่จนสุดแผ่นจะเก็บขยะของตารางที่ 2 มาเป็นพาร์ท) */
      if (++blankRun >= 3) break;
      continue;
    }
    blankRun = 0;
    const bag = {};
    for (const [i, d] of dateCols) {
      const v = row[i];
      if (typeof v === 'number' && Number.isFinite(v) && v !== 0) bag[d] = (bag[d] || 0) + v;
    }
    parts.push({
      mat_no: mat,
      part_name: cName >= 0 ? String(row[cName] ?? '').trim() || null : null,
      fc: cFc >= 0 ? num(row[cFc]) || null : null,
      cells: { to_vendor: bag },
      texts: {},
    });
  }
  if (skipped) warnings.push(`ข้าม ${skipped} แถวที่มีตัวเลขแต่ช่อง MAT ว่าง — ไปเติมเลข SAP ในไฟล์ต้นทาง`);
  return { parts, dates: dateCols.map(([, d]) => d), rowKeys: ['to_vendor'], warnings };
}

/** บวกวันแบบ local (ห้ามใช้ toISOString — UTC เลื่อนวันสำหรับไทย) */
function addDaysStr(dateStr, n) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const t = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}
