/**
 * vsmModel — สร้างโมเดล Value Stream Map จากข้อมูลจริงในระบบ (pure ไม่แตะ DB/DOM)
 *
 * ⚠️ กฎเหล็ก: ตัวเลขทุกตัวต้องมาจาก util กลางเดิม ห้ามเขียนสูตรใหม่ที่นี่
 *    OEE/พัก/CT → utils/oee.js · จำนวนคน → utils/stdManpower.js · วันทำงาน → utils/companyCalendar.js
 *    ไม่งั้นจะได้ OEE คนละชุดกับ /oee-analytics ทันที (บทเรียนจาก audit 2026-08-05)
 *
 * ⚠️ ห้ามเดาค่าที่ไม่มีข้อมูล — คืน null แล้วใส่เหตุผลลง `warnings` ให้หน้าจอแสดง
 *
 * ── สูตร %VA (ถอดจากใบจริง TSAT 2 ใบ ตรงทั้งคู่) ─────────────────────────────
 *   VA  = PT (เวลางานจริงรวม, วินาที)
 *   NVA = PLT (วัน) × AT (วินาที/วัน)      ← ไม่ใช่ × 86,400
 *   %VA = VA ÷ (VA + NVA) × 100
 *   พิสูจน์: REINF ASY BDY SD RR → 81 × 56,400 + 48,162 = 4,616,562 = ตัวหารในใบเป๊ะ
 *            P/8 RADIATOR GRL   → 82.65 × 56,400 + 53,100 = 4,714,560 → 1.13% ตรงใบ
 *   (ถ้าใช้ 86,400 จะได้ตัวหาร 7 ล้าน = %VA ต่ำกว่าใบจริงเกือบเท่าตัว)
 */
import { matDigit } from '../utils/matPrefix';
import { wavg, wLoad, ctForMat, policyBreakForShift } from '../utils/oee';
import { stdCapacityOf } from '../utils/stdManpower';
import { stepsFor } from '../utils/routing';

const num = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(+v) ? +v : null));
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/* ── formatter ตามธรรมเนียมใบ VSM จริงของ TSAT (skill: vsm-tsat-reference · 2026-08-20) ──
   ใบจริงเขียน PT เป็น "X min Y second" (ไม่ใช่วินาทีดิบ) และมี MCT เป็น headline ตัวแดงใหญ่
   เช่น "MCT = 8.97 Days 4 min 17 second" — format ที่นี่จุดเดียว ใช้ทั้งจอ/ใบพิมพ์ ห้ามเขียนซ้ำ */
export function fmtMinSec(sec) {
  if (sec == null || !Number.isFinite(+sec)) return null;
  const m = Math.floor(+sec / 60), s = Math.round(+sec % 60);
  return m > 0 ? `${m} min ${s} second` : `${s} second`;
}
/** MCT (Manufacturing Cycle Time) = PLT (วัน) + PT (นาที/วินาที) */
export function fmtMct(pltDays, ptSec) {
  const parts = [];
  if (pltDays != null) parts.push(`${pltDays} Days`);
  const ms = fmtMinSec(ptSec);
  if (ms && ptSec > 0) parts.push(ms);
  return parts.length ? parts.join(' ') : null;
}

/** ค่ากลาง (median) — ทนค่าโดดกว่าค่าเฉลี่ย ใช้กับเวลา setup ที่มีทั้งเคสปกติและเคสพัง */
export function median(arr) {
  const a = arr.filter(x => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** เวลาที่มีให้ผลิตต่อวัน (วินาที) = Σ ต่อกะ (เวลากะ − พักตามนโยบาย) */
export function availableTimeSec({ sessions = [], breakPolicies = [], processType = null }) {
  const byShift = new Map();               // เอากะละ 1 ตัวแทน (ค่ากลางของ shift_min)
  sessions.forEach(s => {
    if (!s.shift) return;
    if (!byShift.has(s.shift)) byShift.set(s.shift, []);
    byShift.get(s.shift).push(num(s.shift_min) || 0);
  });
  if (!byShift.size) return { atSec: null, shifts: 0 };
  let total = 0;
  byShift.forEach((mins, shift) => {
    const shiftMin = median(mins) || 0;
    const brk = policyBreakForShift({ policies: breakPolicies, shift, shiftMin, processType });
    total += Math.max(0, shiftMin - brk) * 60;
  });
  return { atSec: total, shifts: byShift.size };
}

/** ตัวเลขความต้องการลูกค้า — ต่อปี/เดือน/วัน (วันทำงานจากปฏิทินบริษัท ห้าม hardcode 21/22) */
export function demandOf({ forecasts = [], orders = [], monthKey, workingDays }) {
  const inMonth = forecasts.filter(f => String(f.period_month || '').slice(0, 7) === monthKey);
  // รวม source เดียวกัน กัน double-count (กฎเดียวกับ Kanban Auto-Calc: EDI 830 ชนะ manual)
  const hasEdi = inMonth.some(f => f.source === 'edi_830');
  const picked = hasEdi ? inMonth.filter(f => f.source === 'edi_830') : inMonth;
  let perMonth = picked.reduce((s, f) => s + (num(f.qty) || 0), 0);
  let src = picked.length ? 'forecast' : null;

  if (!perMonth && orders.length) {          // ไม่มี forecast → ใช้ order จริงที่ส่งในช่วง
    perMonth = orders.reduce((s, o) => s + (num(o.qty) || 0), 0);
    src = 'order';
  }
  const perYear = picked.length
    ? forecasts.reduce((s, f) => s + (num(f.qty) || 0), 0)   // ทุกเดือนที่มี forecast
    : (perMonth ? perMonth * 12 : 0);
  const wd = workingDays || 0;
  return {
    perYear: perYear || null,
    perMonth: perMonth || null,
    perDay: perMonth && wd ? Math.round(perMonth / wd) : null,
    source: src,
  };
}

/** ค่าที่คนแก้ทับ ชนะค่าที่ระบบคำนวณเสมอ — เก็บที่มาไว้ให้ UI บอกได้ว่าเลขไหนมาจากไหน */
const pick = (over, auto, srcAuto) =>
  (over != null && over !== '' ? { value: num(over), src: 'manual' } : { value: auto, src: auto == null ? null : srcAuto });

/**
 * เมตริกของกล่องกระบวนการ 1 กล่อง
 * @returns { name, line, ct, ttSec, setupSec, oeePct, shifts, atSec, lotSize, operators, ... }
 */
export function processBox({ step, matNo, ctx, overrides = {} }) {
  const { products, kanbanStds, lines, sessionsByLine, downtimesByLine, breakPolicies, ttSec } = ctx;
  const line = step.line_name || null;
  const sess = (line && sessionsByLine[line]) || [];
  const dts = (line && downtimesByLine[line]) || [];

  // CT — routing ทับ master ได้ (บางขั้นเร็ว/ช้าต่างจากค่ากลางของพาร์ท)
  const ctAuto = num(step.ct_sec) ?? ctForMat(matNo, { kanbanStds, products });
  const ct = pick(overrides.ct_sec, ctAuto, num(step.ct_sec) != null ? 'routing' : 'master');

  // %OEE — ถ่วงน้ำหนักด้วยเวลารับภาระ (กฎ CLAUDE.md ห้าม mean-of-percentages)
  const oeeAuto = sess.length ? wavg(sess, s => num(s.oee), wLoad) : null;
  const oee = pick(overrides.oee_pct, oeeAuto == null ? null : round(oeeAuto, 1), 'sessions');

  // C/O — ค่ากลางของ downtime ที่ถูกจัดหมวด six_big_loss = 'setup' (ได้จากงาน Lean 2026-08-05)
  const setupMins = dts.filter(d => d.six_big_loss === 'setup').map(d => num(d.duration_min)).filter(Boolean);
  const setupAuto = num(step.setup_sec) ?? (setupMins.length ? median(setupMins) * 60 : null);
  const setup = pick(overrides.setup_sec, setupAuto, num(step.setup_sec) != null ? 'routing' : 'downtime');

  const { atSec, shifts } = availableTimeSec({ sessions: sess, breakPolicies, processType: step.process_type });

  const ks = (kanbanStds || []).find(k => k.mat_no === matNo);
  const lotAuto = num(step.lot_size) ?? num(ks?.lot_size);
  const lot = pick(overrides.lot_size, lotAuto, num(step.lot_size) != null ? 'routing' : 'kanban');

  const opAuto = num(step.operators) ?? (line ? (stdCapacityOf(lines, line, 'day') || null) : null);
  const op = pick(overrides.operators, opAuto, num(step.operators) != null ? 'routing' : 'std_manpower');

  return {
    key: `${matNo}#${step.seq}`,
    matNo, seq: step.seq,
    name: step.step_name,
    line, machineNo: step.machine_no || null,
    processType: step.process_type || null,
    isOutsourced: !!step.is_outsourced,
    vendor: step.vendor_name || null,
    isFallback: !!step.is_fallback,
    ct: ct.value, ctSrc: ct.src,
    ttSec,
    setupSec: setup.value, setupSrc: setup.src,
    oeePct: oee.value, oeeSrc: oee.src,
    shifts, atSec,
    lotSize: lot.value, lotSrc: lot.src,
    operators: op.value, opSrc: op.src,
    wipLabel: step.wip_label || null,
    wipQty: num(overrides.wip_qty) ?? num(step.wip_qty),
  };
}

/**
 * สร้างโมเดล VSM ทั้งใบ
 * โครงสาย: [วัตถุดิบ/supplier] → [ขั้นของพาร์ทลูกสายหลัก] → [ขั้นของ FG] → [ลูกค้า]
 * พาร์ทลูกตัวอื่น = สายป้อน (feeder) วาดแยกแถว · PLT/PT คิดบน "สายหลัก" (critical path) ตามตำรา
 */
export function buildVsmModel(input) {
  const {
    fg, bomItems = [], products = [], partsMaster = [], routings = {},
    kanbanStds = [], lines = [], sessions = [], downtimes = [], breakPolicies = [],
    stockByMat = {}, forecasts = [], shippingOrders = [],
    monthKey, workingDays, overrides = {}, deliveryRounds = [],
  } = input;

  const warnings = [];
  // code = ตัวจับคู่ให้ worklist (lib/vsmGaps.js) ผูกลิงก์ "ไปแก้ที่ไหน" — code ใหม่ต้องไปเติม FIX ที่นั่นด้วย
  const W = (level, text, code = null) => warnings.push({ level, text, code });

  const sessionsByLine = {}, downtimesByLine = {};
  sessions.forEach(s => { (sessionsByLine[s.line_name] ||= []).push(s); });
  downtimes.forEach(d => { (downtimesByLine[d.line_name] ||= []).push(d); });

  // ── ความต้องการลูกค้า + TT ────────────────────────────────────────────────
  const demand = demandOf({ forecasts, orders: shippingOrders, monthKey, workingDays });
  if (!demand.perMonth) W('error', 'ไม่มี forecast/ออเดอร์ของพาร์ทนี้ในเดือนที่เลือก — TT และ PLT คำนวณไม่ได้', 'no_demand');
  else if (demand.source === 'order') W('warn', 'ไม่มี forecast — ใช้ยอดออเดอร์จริงที่ส่งในช่วงแทน', 'demand_from_order');
  if (!workingDays) W('error', 'ปฏิทินบริษัทยังไม่ได้ตั้งวันทำงานของเดือนนี้', 'no_working_days');

  const fgSess = sessionsByLine[fg.line_name] || [];
  const { atSec: lineAt } = availableTimeSec({ sessions: fgSess, breakPolicies, processType: fg.process_type });
  const atSec = num(overrides.__at_sec) ?? lineAt;
  if (!atSec) W('error', `ไม่มีกะที่ปิดแล้วของไลน์ ${fg.line_name || '—'} ในช่วงที่เลือก — AT/TT/%OEE คำนวณไม่ได้`, 'no_sessions');

  const ttSec = atSec && demand.perDay ? round(atSec / demand.perDay, 1) : null;

  const ctx = { products, kanbanStds, lines, sessionsByLine, downtimesByLine, breakPolicies, ttSec };
  const boxOf = (step, matNo) => processBox({ step, matNo, ctx, overrides: overrides[`${matNo}#${step.seq}`] || {} });

  // ── แตกโครงสาย ────────────────────────────────────────────────────────────
  const fgSteps = stepsFor(fg.mat_no, routings, products);
  if (!fgSteps.length) W('error', `${fg.mat_no} ยังไม่ได้ลงลำดับกระบวนการ และไม่มีไลน์ผลิตใน Product Master`, 'no_routing');
  else if (fgSteps.some(s => s.is_fallback)) W('warn', `${fg.mat_no} ยังไม่ได้ลงลำดับกระบวนการ — ใช้ไลน์เดียวจาก Product Master ไปก่อน (ลงที่ Product Master → 🔀 Routing)`, 'fallback_routing');

  const children = bomItems.map(b => {
    const prod = products.find(p => p.mat_no === b.mat_no);
    const pm = partsMaster.find(p => p.mat_no === b.mat_no);
    const steps = prod ? stepsFor(b.mat_no, routings, products) : [];
    return {
      matNo: b.mat_no,
      name: b.part_name || pm?.part_name || prod?.name || b.mat_no,
      qtyPerUnit: num(b.qty_per_unit) || 1,
      inHouse: !!prod && steps.length > 0,
      supplier: b.supplier || pm?.supplier || null,
      steps,
    };
  });

  const inHouse = children.filter(c => c.inHouse);
  // สายหลัก = ลูกที่มีขั้นมากสุด (เส้นทางยาวสุด = critical path ตามตำรา VSM)
  const mainChild = inHouse.slice().sort((a, b) => b.steps.length - a.steps.length)[0] || null;
  const feeders = inHouse.filter(c => c !== mainChild);

  const suppliers = children.filter(c => !c.inHouse).map(c => ({
    matNo: c.matNo, name: c.name,
    supplier: c.supplier,
    qty: num(stockByMat[c.matNo]),
    days: demand.perDay && stockByMat[c.matNo] != null ? round(stockByMat[c.matNo] / (demand.perDay * c.qtyPerUnit), 2) : null,
    // ❌ ระบบยังไม่เก็บรอบส่ง supplier (7:1:1) — รับจากที่คนกรอกในใบเท่านั้น ห้ามเดา
    deliveryPattern: (overrides.__supplier_pattern || {})[c.matNo] || null,
  }));
  if (suppliers.length && suppliers.every(s => s.qty == null)) W('warn', 'ยังไม่มียอดคงคลังของพาร์ทซื้อนอกในระบบ — ▲ ฝั่ง supplier จะว่าง', 'no_supplier_stock');
  if (suppliers.length) W('info', 'รอบส่งของ supplier (เช่น 7:1:1) ระบบยังไม่เก็บ — กรอกเองในใบ', 'supplier_pattern');

  // ── สายหลัก: ขั้นของลูกสายหลัก + ขั้นของ FG ───────────────────────────────
  const chain = [
    ...(mainChild ? mainChild.steps.map(s => boxOf(s, mainChild.matNo)) : []),
    ...fgSteps.map(s => boxOf(s, fg.mat_no)),
  ];
  chain.forEach(b => {
    if (b.ct == null) W('warn', `ขั้น "${b.name}" ยังไม่มี Cycle Time — ตั้งที่ Product Master หรือกรอกทับในใบ`, 'no_ct');
    if (b.isOutsourced && !b.vendor) W('warn', `ขั้น "${b.name}" เป็นงานจ้างนอกแต่ยังไม่ได้ระบุผู้รับจ้าง`, 'no_vendor');
  });
  // %OEE / C/O ที่ยังไม่มีข้อมูล — รวมเป็นรายการเดียวต่อเรื่อง (จาก audit 2026-08-20: ไลน์ปั๊มยังไม่เปิดกะ
  // + C/O มีเฉพาะไลน์ที่จัดหมวด setup แล้ว) · จ้างนอกไม่นับ (ไม่มีกะ/ดาวไทม์ของเราให้วัด)
  const listNames = arr => arr.slice(0, 3).map(b => `"${b.name}"`).join(', ') + (arr.length > 3 ? ` +อีก ${arr.length - 3} ขั้น` : '');
  const noOee = chain.filter(b => !b.isOutsourced && b.oeePct == null);
  if (noOee.length) W('warn', `ขั้น ${listNames(noOee)} ยังไม่มี %OEE — ไลน์ยังไม่มีกะที่ปิดแล้วในเดือนที่เลือก`, 'no_oee');
  const noSetup = chain.filter(b => !b.isOutsourced && b.setupSec == null);
  if (noSetup.length) W('info', `C/O (เวลาตั้งเครื่อง) ยังไม่มีข้อมูลในขั้น ${listNames(noSetup)} — ต้องมี downtime ที่จัดหมวด "ตั้งเครื่อง (setup)" หรือกรอกทับในตาราง`, 'no_setup');

  // ── คงคลังระหว่างทาง ──────────────────────────────────────────────────────
  const invDays = qty => (demand.perDay && qty != null ? round(qty / demand.perDay, 2) : null);
  // จุดที่มี kanban = จุดดึง (pull) → ผังวาดเป็น supermarket + kanban post แทนสามเหลี่ยมเปล่า
  const kbOf = mat => (kanbanStds || []).find(k => k.mat_no === mat) || null;
  const rawChild = children.find(c => matDigit(c.matNo) === '5');
  const inventories = [];
  const rawPm = rawChild ? partsMaster.find(p => p.mat_no === rawChild.matNo) : null;
  inventories.push({
    pos: 'raw', label: rawChild ? 'Store Raw Material' : 'Store',
    matNo: rawChild?.matNo || null,
    qty: rawChild ? num(stockByMat[rawChild.matNo]) : null,
    days: rawChild ? invDays(num(stockByMat[rawChild.matNo])) : null,
    uom: rawPm?.uom || null,
    manual: false, kanban: rawChild ? kbOf(rawChild.matNo) : null,
  });
  chain.forEach((b, i) => {
    const isLast = i === chain.length - 1;
    if (isLast) return;                         // ท้ายสายใช้ FG warehouse ด้านล่าง
    inventories.push({
      pos: `after:${b.key}`, label: b.wipLabel || 'WIP',
      matNo: b.matNo, qty: b.wipQty, days: invDays(b.wipQty),
      manual: true,                             // ระบบไม่เก็บ WIP กลางทาง → ต้องกรอก
      kanban: kbOf(b.matNo),
    });
  });
  const fgQty = num(stockByMat[fg.mat_no]);
  inventories.push({ pos: 'fg', label: 'FG Warehouse', matNo: fg.mat_no, qty: fgQty, days: invDays(fgQty),
    manual: false, kanban: kbOf(fg.mat_no) });

  const missingWip = inventories.filter(v => v.manual && v.qty == null).length;
  if (missingWip) W('warn', `คงคลังระหว่างทาง ${missingWip} จุดยังไม่ได้กรอก — PLT จะต่ำกว่าความจริง (กรอกในตารางด้านล่าง)`, 'missing_wip');

  // ── บันไดเวลา / PLT / PT / %VA ────────────────────────────────────────────
  const ptSec = chain.reduce((s, b) => s + (b.ct || 0), 0);
  const pltDays = round(inventories.reduce((s, v) => s + (v.days || 0), 0), 2);
  const vaSec = ptSec;
  const nvaSec = (pltDays || 0) * (atSec || 0);       // ⚠️ × AT ไม่ใช่ × 86,400 (ดูหัวไฟล์)
  const vaPct = (vaSec + nvaSec) > 0 ? round((vaSec / (vaSec + nvaSec)) * 100, 2) : null;

  const custRounds = (deliveryRounds || []).length;

  return {
    header: {
      matNo: fg.mat_no, partName: fg.name, partNo: fg.p_no || null,
      model: fg.model || null, customer: fg.customer || null,
    },
    info: {
      workingDays, monthKey,
      orderYear: demand.perYear, orderMonth: demand.perMonth, orderDay: demand.perDay,
      demandSource: demand.source,
      atSec, ttSec,
    },
    suppliers,
    chain,
    feeders: feeders.map(c => ({ matNo: c.matNo, name: c.name, boxes: c.steps.map(s => boxOf(s, c.matNo)) })),
    inventories,
    customer: {
      name: fg.customer || null,
      roundsPerDay: custRounds || null,
      pattern: overrides.__customer_pattern || null,
    },
    totals: { ptSec, pltDays, vaSec, nvaSec, vaPct },
    warnings,
  };
}
