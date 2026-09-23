/* ═══ เทสตัวแกะไฟล์ Monitoring ของแพลนนิ่ง — 2026-09-23 ═══
   เคสทั้งหมดถอดจากไฟล์จริง 1.Monitoring-Sep.xlsx (15 ชีท) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellDate, detectMonitoringKind, parsePressSheet, parseCustomerSheet, parseGridSheet,
  parseMonitoringWorkbook, monitoringToRecords,
} from '../monitoringSheet.js';

const D = (y, m, d) => new Date(y, m - 1, d);

/* ── ชีทไลน์ปั๊ม: ล้อโครง 300T จริง (ไม่มีคอลัมน์ Process) ───────────────────── */
const PRESS = [
  ['Item', 'Picture', 'Mat SAP', 'PART NO.', 'PART NAME', 'Raw material', 'Model', 'LOT', 'Packing', 'Cost', 'FC', 'Total SL', 'Diff FC', '%SL', 'PLAN', 'Sun', 'Mon', 'Tue'],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, D(2026, 9, 1), D(2026, 9, 2), D(2026, 9, 3)],
  [1, 'FORD', 20058481, 'MB3B-16A127-AA', 'GST FRT FNDR', '50027079 COIL', 'P703_U704', 6000, 2000, 10.3, 19000, 16000, -3000, 0.84, 'PLAN', null, 6000, null],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'IN', null, 4000, 2000],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'UNBOUND', 0, -2000, 0],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'OUT', 2000, null, 2000],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'BALANCE', 6000, 4000, 2000],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'WIP'],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'MIN', 6000, 6000, 6000],
];

test('รู้ว่าเป็นชีทไลน์ปั๊ม (บล็อกป้าย PLAN/IN/OUT เรียงลงมา)', () => {
  assert.equal(detectMonitoringKind(PRESS), 'press');
});

test('แกะหัวพาร์ท + PLAN/OUT รายวันได้ถูกช่อง', () => {
  const { parts, dates } = parsePressSheet(PRESS);
  assert.equal(parts.length, 1);
  const p = parts[0];
  assert.equal(p.mat_no, '20058481');
  assert.equal(p.customer_part_no, 'MB3B-16A127-AA');
  assert.equal(p.fc, 19000);
  assert.equal(p.lot, 6000);
  assert.equal(p.packing, 2000);
  assert.deepEqual(p.plan, { '2026-09-02': 6000 });
  assert.deepEqual(p.out, { '2026-09-01': 2000, '2026-09-03': 2000 });
  assert.deepEqual(dates, ['2026-09-01', '2026-09-02', '2026-09-03']);
});

test('🔴 MIN/BALANCE เป็นยอดคงเหลือ ต้องเอาช่องล่าสุด ห้ามบวกทุกวัน', () => {
  const { parts } = parsePressSheet(PRESS);
  assert.equal(parts[0].min, 6000, 'ไม่ใช่ 18000');
  assert.equal(parts[0].balance, 2000, 'ช่องขวาสุดที่มีเลข = ล่าสุด');
});

test('🔴 คอลัมน์เลื่อน (110T มี Process แทรก) ต้องยังแกะถูก — ห้ามตรึง index', () => {
  const shifted = PRESS.map((r, i) => {
    if (i === 0) return [...r.slice(0, 10), 'Process', ...r.slice(10)];
    return [...r.slice(0, 10), null, ...r.slice(10)];
  });
  const { parts } = parsePressSheet(shifted);
  assert.equal(parts[0].mat_no, '20058481');
  assert.equal(parts[0].fc, 19000, 'FC ต้องยังอ่านจากหัว ไม่ใช่ตำแหน่งเดิม');
  assert.deepEqual(parts[0].out, { '2026-09-01': 2000, '2026-09-03': 2000 });
});

test('หลายพาร์ทในชีทเดียว — บล็อกต้องไม่ปนกัน', () => {
  const two = [...PRESS,
    [2, null, 20066663, 'RB3B-E02446-BA', 'SUPT FRT', 'coil', 'P703', 4800, 800, 12, 18980, 17600, -1380, 0.92, 'PLAN', 4800, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, 'OUT', null, 800, null],
  ];
  const { parts } = parsePressSheet(two);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].out, { '2026-09-01': 2000, '2026-09-03': 2000 }, 'ของตัวแรกต้องไม่ถูกเติมจากบล็อกที่ 2');
  assert.deepEqual(parts[1].plan, { '2026-09-01': 4800 });
});

test('ชีทที่ไม่มีหัว Mat / ไม่มีป้าย ต้องคืนค่าว่างพร้อมคำเตือน ไม่โยน error', () => {
  const r = parsePressSheet([['a', 'b'], [1, 2]]);
  assert.deepEqual(r.parts, []);
  assert.ok(r.warnings.length > 0);
  assert.equal(detectMonitoringKind([]), null);
  assert.equal(detectMonitoringKind([['ก'], ['ข']]), null);
});

/* ── ชีทลูกค้า: ล้อโครง TSPK จริง ───────────────────────────────────────────── */
const CUST = [
  ['ITEM', 'PICTURE', "Mat'l", 'PART NO.', 'Model', 'P.STD.', 'Rack', 'MIN', 'MAX', 'FG', null, null, 'Back', D(2026, 9, 23), null, D(2026, 9, 24), null, 'Total'],
  [null, null, null, null, null, null, null, null, null, 'Stock W/H', 'ผลิต/WIP', 'Total', null, 'Order', 'balance', 'Order', 'balance'],
  [1, null, 10076603, 'BHS07706 (LH)', '20TF/RG01', 100, 32, 1800, 3800, 3200, null, 3200, null, 300, 2900, 300, 2600],
  [2, null, 10076604, 'BHS08555 (RH)', '20TF/RG01', 100, 52, 1800, 3800, 5200, null, 5200, null, null, 4900, 300, 4600],
  [null, null, null, null, null, null, null, '#N/A', '#N/A', '#N/A'],   // แถวเสียของจริง
];

test('รู้ว่าเป็นชีทลูกค้า + แกะออเดอร์ตามวันส่งได้', () => {
  assert.equal(detectMonitoringKind(CUST), 'customer');
  const { parts } = parseCustomerSheet(CUST);
  assert.equal(parts.length, 2, 'แถว #N/A ต้องถูกข้าม');
  assert.deepEqual(parts[0].orders, [{ due_date: '2026-09-23', qty: 300 }, { due_date: '2026-09-24', qty: 300 }]);
  assert.deepEqual(parts[1].orders, [{ due_date: '2026-09-24', qty: 300 }], 'ช่องว่าง = ไม่มีออเดอร์ ไม่ใช่ 0');
  assert.equal(parts[0].min, 1800);
  assert.equal(parts[0].max, 3800);
  assert.equal(parts[0].fg_stock, 3200);
  assert.equal(parts[0].packing, 100);
});

test('🔴 ค่า #N/A / ข้อความ ต้องไม่กลายเป็นตัวเลข 0 ที่เอาไปเขียนสต็อกทับของจริง', () => {
  const { parts } = parseCustomerSheet(CUST);
  assert.ok(parts.every(p => p.fg_stock === null || typeof p.fg_stock === 'number'));
  const bad = parseCustomerSheet([
    ['ITEM', "Mat'l", 'MIN', 'MAX', 'FG', D(2026, 9, 23)],
    [null, null, null, null, 'Stock W/H', 'Order'],
    [1, 10076603, '#N/A', '#N/A', '#N/A', 500],
  ]);
  assert.equal(bad.parts[0].min, null);
  assert.equal(bad.parts[0].fg_stock, null, 'ห้ามเป็น 0 — 0 แปลว่า "ของหมด" ซึ่งคนละเรื่องกับ "ไม่รู้"');
});

test('คอลัมน์ Order ที่ไม่มีวันที่กำกับ ต้องข้าม + เตือน', () => {
  const r = parseCustomerSheet([
    ['ITEM', "Mat'l", 'Back', null],
    [null, null, 'Order', 'balance'],
    [1, 10076603, 500, 0],
  ]);
  assert.equal(r.parts[0].orders.length, 0);
  assert.ok(r.warnings.some(w => w.includes('ไม่มีวันที่')));
});

test('ชีทลูกค้าที่มีเลข 2 ระบบ (MAT.TSESA + MAT\'L NO.) ต้องเอาเลข SAP ฝั่งเรา', () => {
  const r = parseCustomerSheet([
    ['ITEM', 'MAT.TSESA', "MAT'L NO.", 'PART NO.', D(2026, 8, 6)],
    [null, null, null, null, 'Order'],
    [1, 30027973, 10057225, 'EB3B-41108A70-AA', 490],
  ]);
  assert.equal(r.parts[0].mat_no, '10057225');
});

/* ── cellDate ────────────────────────────────────────────────────────────────── */
test('cellDate ใช้เวลาท้องถิ่น ไม่ใช่ UTC (กฎ Date/Time ของโปรเจค)', () => {
  assert.equal(cellDate(D(2026, 1, 1)), '2026-01-01');
  assert.equal(cellDate(D(2026, 12, 31)), '2026-12-31');
  assert.equal(cellDate('2026-09-23'), '2026-09-23');
  assert.equal(cellDate('ไม่ใช่วันที่'), null);
  assert.equal(cellDate(null), null);
  assert.equal(cellDate(new Date('x')), null);
});

/* ── ทั้งไฟล์ + แปลงเป็นเรคคอร์ด ─────────────────────────────────────────────── */
test('ชีทที่แกะไม่ได้ต้องถูกรายงานชื่อ ห้ามหายเงียบ', () => {
  const r = parseMonitoringWorkbook([
    { name: '300T', rows: PRESS },
    { name: 'TSPK', rows: CUST },
    { name: 'mat', rows: [['DAILY REPORT STORE RAW MATERIAL'], ['Item', "Mat'l SAP", 'Description']] },
  ]);
  assert.equal(r.press.length, 1);
  assert.equal(r.customer.length, 1);
  assert.deepEqual(r.skipped, ['mat']);
});

test('แปลงเป็นเรคคอร์ด — FC เข้า forecast · order ชีทลูกค้าเข้า order · OUT ไปกอง shipped', () => {
  const parsed = parseMonitoringWorkbook([{ name: '300T', rows: PRESS }, { name: 'TSPK', rows: CUST }]);
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09', lineOfMat: () => 'LINE C ( 200&250 Ton )' });
  assert.equal(rec.forecasts.length, 1);
  assert.equal(rec.forecasts[0].qty, 19000);
  assert.equal(rec.forecasts[0].period_month, '2026-09-01');
  assert.equal(rec.forecasts[0].source, 'monitoring');
  assert.equal(rec.orders.length, 3, 'ออเดอร์ล่วงหน้ามาจากชีทลูกค้าเท่านั้น');
  assert.ok(rec.orders.every(o => o.source === 'monitoring'));
  assert.equal(rec.shipped.length, 2, 'OUT = ประวัติการส่ง แยกกองไว้ ห้ามปนกับ orders');
  assert.ok(rec.shipped.every(s => !('source' in s) || s.source !== 'order'));
});

test('🔴 พาร์ทที่ยังไม่รู้ไลน์ ห้ามเขียน min/สต็อกมั่วไปไลน์ใดไลน์หนึ่ง', () => {
  const parsed = parseMonitoringWorkbook([{ name: '300T', rows: PRESS }]);
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09', lineOfMat: () => null });
  assert.equal(rec.levels.length, 0);
  assert.equal(rec.stock.length, 0);
  assert.equal(rec.forecasts.length, 1, 'แต่ FC ยังต้องเข้า — ไม่ต้องรู้ไลน์ก็เก็บได้');
});

test('FG ของชีทลูกค้าต้องลงคลัง FG ไม่ใช่ไลน์ (ยอดที่ไลน์เชื่อไม่ได้)', () => {
  const parsed = parseMonitoringWorkbook([{ name: 'TSPK', rows: CUST }]);
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09', lineOfMat: () => 'LINE B ( 600 Ton )' });
  const fg = rec.stock.filter(s => s.line_name === 'FG WAREHOUSE');
  assert.equal(fg.length, 2);
  assert.equal(fg[0].qty, 3200);
});

test('ไม่มี monthKey = ไม่สร้าง forecast (ดีกว่าลงเดือนมั่ว)', () => {
  const parsed = parseMonitoringWorkbook([{ name: '300T', rows: PRESS }]);
  assert.equal(monitoringToRecords(parsed, {}).forecasts.length, 0);
});

test('ข้อมูลว่าง/ไม่ส่งอะไรเลย ต้องไม่โยน error', () => {
  assert.deepEqual(parseMonitoringWorkbook().skipped, []);
  const r = monitoringToRecords(undefined, {});
  assert.deepEqual(r.forecasts, []);
  assert.deepEqual(r.orders, []);
});

/* ── ชีท Argen: ป้ายบล็อกคนละชุด + ORDER REQUIREMENT มาก่อนแถว MAT ─────────────── */
const ARGEN = [
  ['Item', 'Picture', 'Mat SAP', 'PART NO.', 'PART NAME', 'Packing GREAT', 'LOT', 'Packing', 'REQUIREMENT DATE', null, D(2026, 1, 5), D(2026, 1, 12), D(2026, 1, 19)],
  [null, null, null, null, null, null, null, null, 'ส่งเกรท', null, D(2025, 12, 15), D(2025, 12, 22), D(2025, 12, 29)],
  [null, null, null, null, null, null, null, null, 'ORDER REQUIREMENT', null, 0, 1600, 1200],
  [1, null, 20065733, 'MB3B-E102D04-BC', 'BRKT ENG GRD', 50, 2400, 300, 'PROD. DATE', null, null, null, null],
  [null, null, null, null, null, null, null, null, 'PLAN', null, null, 2400, null],
  [null, null, null, null, null, null, null, null, 'UNBOUND', null, 0, 0, 0],
  [null, null, null, null, null, null, null, null, 'IN', null, null, 2400, null],
  [null, null, null, null, null, null, null, null, 'STOCK W/H', null, 0, 0, 0],
  [null, null, null, null, null, null, null, null, 'SEND TO GREAT', null, null, 2400, null],
  [null, null, null, null, null, null, null, null, 'BALANCE', null, 2253, 4653, 3053],
  [null, null, null, null, null, null, null, null, 'ORDER REQUIREMENT', null, 0, 384, 1920],
  [2, null, 20059976, 'MB3B-16E025-CC', 'REINF MTNG LWR LH', 12, 2400, 400, 'PROD. DATE'],
  [null, null, null, null, null, null, null, null, 'PLAN', null, 1200, null, null],
  [null, null, null, null, null, null, null, null, 'BALANCE', null, 100, 200, 300],
];

test('🔴 ชีท Argen: คอลัมน์ป้ายชื่อ "REQUIREMENT DATE" ไม่ใช่ "PLAN" — ต้องยังจับได้', () => {
  assert.equal(detectMonitoringKind(ARGEN), 'press');
  const { parts } = parsePressSheet(ARGEN);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].mat_no, '20065733');
});

test('🔴 ORDER REQUIREMENT อยู่ "เหนือ" แถว MAT — ต้องยกให้พาร์ทถัดไป ห้ามเกาะพาร์ทก่อนหน้า', () => {
  const { parts } = parsePressSheet(ARGEN);
  // ⚠️ วันที่ที่ผูกกับตัวเลข = แถว "ส่งเกรท" (วันที่ **เรา** ต้องส่ง) ไม่ใช่ REQUIREMENT DATE ของลูกค้า
  assert.deepEqual(parts[0].demand, { '2025-12-22': 1600, '2025-12-29': 1200 });
  assert.deepEqual(parts[1].demand, { '2025-12-22': 384, '2025-12-29': 1920 },
    'ถ้าเลื่อนผิด 1 ตัว ความต้องการทั้งไฟล์จะไปผิดพาร์ททั้งหมด');
});

test('SEND TO GREAT = ยอดส่งจริง (เทียบเท่า OUT) · BALANCE ชนะ STOCK W/H', () => {
  const { parts } = parsePressSheet(ARGEN);
  assert.deepEqual(parts[0].out, { '2025-12-22': 2400 });
  assert.equal(parts[0].balance, 3053, 'ต้องเป็น BALANCE ช่องล่าสุด ไม่ใช่ STOCK W/H = 0');
});

test('ORDER REQUIREMENT ของ Argen ต้องกลายเป็น "ออเดอร์" ไม่ใช่ประวัติการส่ง', () => {
  const parsed = parseMonitoringWorkbook([{ name: 'Argen', rows: ARGEN }]);
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09', lineOfMat: () => null });
  assert.equal(rec.orders.length, 4);
  assert.equal(rec.orders.reduce((s, o) => s + o.qty, 0), 1600 + 1200 + 384 + 1920);
  assert.ok(rec.orders.every(o => o.source === 'monitoring'));
  assert.equal(rec.shipped.length, 1, 'SEND TO GREAT ไปกอง shipped');
});

/* ── ชีทตารางแบน (RA) ────────────────────────────────────────────────────────── */
const GRID = [
  [],
  ['No', 'Mat.SAP', null, 'Part Name', 'FC', 'Sum', 'Total ', 'Diff Forecast', '%SL', D(2026, 8, 31), D(2026, 9, 1)],
  [1, 10094690, 73022056, 'N1WB-E20022-AB - AAT', 15732, 920, 6920, -8812, 0.44, null, 40],
  [1, 10087199, 73022058, 'N1WB-E20022-AB - FTM', null, 2280, null, null, null, 240, 200],
  [1, null, 10100286, 'R1WB-17E850-AB', 3299.6, 2760, null, -539.6, 0.836, 600, null],
  [1, null, null, null, 1236, 728, null, -508, 0.589, 224, null],
  [null, null, null, null, null, null, null, null, null, null, null],
  // ตารางที่ 2 ซ้อนในชีทเดียวกัน — ต้องไม่ถูกดูดเข้ามา
  [null, null, null, 'SEMI', 'ก่อนชุบ', 'ร้านชุบ', 'หลังชุบ', 'FG', 'Total', D(2026, 9, 23)],
  [59450, '022', null, null, null, null, null, null, 0, 360],
];

test('ชีทตารางแบน (RA) — แกะ FC + ยอดส่งรายวันได้ และไม่ถูกจับเป็น press/customer', () => {
  assert.equal(detectMonitoringKind(GRID), 'grid');
  const { parts } = parseGridSheet(GRID);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].mat_no, '10094690');
  assert.equal(parts[0].fc, 15732);
  assert.deepEqual(parts[0].out, { '2026-09-01': 40 });
  assert.equal(parts[1].fc, null, 'แถวที่ไม่มี FC ต้องเป็น null ไม่ใช่ 0');
});

test('🔴 ชีทเดียวมี 2 ตาราง — ต้องหยุดที่ท้ายตารางแรก ไม่ดูดขยะของตารางที่ 2', () => {
  const r = parseGridSheet(GRID);
  assert.ok(r.parts.every(p => /^\d{8}$/.test(p.mat_no)));
  assert.equal(r.parts.length, 2);
  assert.ok(r.warnings.some(w => w.includes('ช่อง MAT ว่าง')), 'แถวที่ตกเลข SAP ต้องถูกรายงาน');
});

test('ชีทงานชุบ (มี Forecast แต่ไม่มี %SL · 1 พาร์ทหลายแถวตามทิศทางการไหล) ต้องถูกข้ามอย่างตั้งใจ', () => {
  const plating = [
    [],
    [null, 'Mat.SAP', 'PART NO.', 'Forecast', 'Total SL', null, null, 'WIP Vendor', D(2026, 9, 1)],
    ['ก่อนชุบ', 20066542, 'R1WB-17K824-AAW', 3299.6, 3634, 'TSAT4 to JRPE', null, null, 398],
    ['หลังชุบ', 20066540, null, null, null, 'JRPE to TSAT4', null, null, 250],
  ];
  assert.equal(detectMonitoringKind(plating), null);
  assert.deepEqual(parseMonitoringWorkbook([{ name: '824-825', rows: plating }]).skipped, ['824-825']);
});

/* ── 🔴 กับดักที่เจอตอนลงข้อมูลจริง 23/09 ────────────────────────────────────── */
test('🔴 ยอดคงเหลือต้องอ่าน ณ วันอ้างอิง — ช่องอนาคตของ Argen เป็นยอดพยากรณ์ติดลบเป็นแสน', () => {
  const future = [
    ['Item', null, 'Mat SAP', 'PART NO.', 'PART NAME', null, 'LOT', 'Packing', 'REQUIREMENT DATE', null, D(2026, 9, 21), D(2026, 9, 28), D(2027, 3, 8)],
    [null, null, null, null, null, null, null, null, 'ส่งเกรท', null, D(2026, 9, 21), D(2026, 9, 28), D(2027, 3, 8)],
    [1, null, 20065107, 'X', 'Y', null, 2400, 300, 'PROD. DATE'],
    [null, null, null, null, null, null, null, null, 'PLAN', null, 1200, null, null],
    [null, null, null, null, null, null, null, null, 'BALANCE', null, 5000, 3000, -82896],
    [null, null, null, null, null, null, null, null, 'MIN', null, 2400, 2400, 2400],
  ];
  const now = parsePressSheet(future, { asOf: '2026-09-23' });
  assert.equal(now.parts[0].balance, 5000, 'ต้องเป็นยอด ณ วันอ้างอิง ไม่ใช่ −82,896 ของปีหน้า');
  assert.equal(now.parts[0].min, 2400);
  const naive = parsePressSheet(future);
  assert.equal(naive.parts[0].balance, -82896, 'ไม่ส่ง asOf = ได้ยอดพยากรณ์');
  assert.ok(naive.warnings.some(w => w.includes('asOf')), 'และต้องเตือนว่าไม่ได้ระบุวันอ้างอิง');
});

test('🔴 ออเดอร์ที่ดิวเก่ากว่าวันนี้ ต้องติดธง past — ห้ามกลายเป็น backlog ปลอม', () => {
  const parsed = parseMonitoringWorkbook([{ name: 'Argen', rows: ARGEN }], { asOf: '2026-09-23' });
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09', today: '2026-09-23' });
  assert.equal(rec.orders.length, 4);
  assert.ok(rec.orders.every(o => o.past === true), 'ทั้งหมดเป็นดิวปี 2025 ⇒ ต้องเป็นอดีต');
  const mixed = monitoringToRecords(parsed, { monthKey: '2026-09', today: '2025-12-01' });
  assert.ok(mixed.orders.every(o => o.past === false));
});

test('ไม่ส่ง today = ไม่ตีว่าอดีต (ผู้เรียกต้องตัดสินเอง) แต่ฟิลด์ต้องมีเสมอ', () => {
  const parsed = parseMonitoringWorkbook([{ name: 'Argen', rows: ARGEN }], { asOf: '2026-09-23' });
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09' });
  assert.ok(rec.orders.every(o => o.past === false));
  assert.ok(rec.orders.every(o => 'past' in o));
});

test('พาร์ทซ้ำ 2 บล็อกในชีทเดียว — สต็อกต้องเหลือแถวเดียวและนับจำนวนซ้ำไว้', () => {
  const dup = [...ARGEN,
    [null, null, null, null, null, null, null, null, 'ORDER REQUIREMENT', null, 0, 100, 0],
    [3, null, 20065733, 'MB3B-E102D04-BC', 'BRKT ENG GRD', 50, 2400, 300, 'PROD. DATE'],
    [null, null, null, null, null, null, null, null, 'BALANCE', null, 99, 99, 99],
  ];
  const parsed = parseMonitoringWorkbook([{ name: 'Argen', rows: dup }], { asOf: '2026-01-19' });
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09', lineOfMat: () => 'LINE A ( 800 Ton )', today: '2026-09-23' });
  const mats = rec.stock.map(s => s.mat_no);
  assert.equal(new Set(mats).size, mats.length, 'ห้ามมี mat ซ้ำในกองสต็อก');
  assert.equal(rec.stockDupes, 1);
});
