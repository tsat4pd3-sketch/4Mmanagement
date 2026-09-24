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

const MAT_HEADS = ['MATSAP', 'MATL', 'MATLNO', 'MATSAP2', 'MATNO'];
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
export function monitoringToRecords(parsed, { monthKey, lineOfMat, today, customers = [] } = {}) {
  /* 🔴 ชื่อลูกค้าต้องติดไปกับใบเสมอ (เพิ่ม 24/09) — เดิมไม่เขียนเลย ⇒ ใบทั้ง 232 ใบ customer = null
     จอ 🚚 Delivery จัดกลุ่มตามลูกค้า ⇒ ของจากไฟล์นี้ไปกองรวมใน "— ไม่ระบุลูกค้า —"
     แพลนนิ่งจึงรายงานว่า "ลูกค้า TSESA ไม่ขึ้น" ทั้งที่ระบบอ่านชีทได้
     · ชื่อมาจากทะเบียน `customers` เท่านั้น — ไม่มีในทะเบียน = null (ห้ามยัดชื่อชีทดิบเป็นลูกค้า) */
  const custOf = (sheet) => sheetCustomer(sheet, customers);
  const forecasts = [], orders = [], levels = [], lots = [], stock = [], shipped = [];
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
      if (p.min > 0 && line) levels.push({ line_name: line, mat_no: p.mat_no, min_qty: p.min, max_qty: null, note: `Monitoring · ${sheet}` });
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
        if (line) levels.push({ line_name: line, mat_no: p.mat_no, min_qty: p.min, max_qty: p.max || null, note: `Monitoring · ${sheet}` });
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

  const stockUniq = [...new Map(stock.map(s => [`${s.line_name}|${s.mat_no}`, s])).values()];
  /* 🔴 ยอดคงเหลือติดลบในไฟล์นี้ = "ความต้องการที่ยังไม่ได้ผลิต" ไม่ใช่ของติดลบในคลัง
     (วัดจริง 23/09: ชีท Argen มี 5 พาร์ทที่ BALANCE ถึง −47,168 เพราะลงความต้องการล่วงหน้าไว้
      แต่ยังไม่ลงแผนผลิต) ⇒ ห้ามเอาไปตั้งยอดทับสต็อกจริง · แยกออกมาให้คนดู */
  const stockOk = stockUniq.filter(s => s.qty >= 0);
  const stockNegative = stockUniq.filter(s => s.qty < 0);
  return { forecasts, orders: ordersUniq, orderDupes, levels, lots, stock: stockOk, stockNegative,
           stockDupes: stock.length - stockUniq.length, shipped };
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
