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

test('🔴 ยอดคงเหลือติดลบ = ความต้องการที่ยังไม่ผลิต ห้ามเอาไปตั้งยอดทับสต็อกจริง', () => {
  const rows = [
    ['Item', null, 'Mat SAP', 'PART NO.', 'PART NAME', null, 'LOT', 'Packing', 'REQUIREMENT DATE', null, D(2026, 9, 21)],
    [null, null, null, null, null, null, null, null, 'ส่งเกรท', null, D(2026, 9, 21)],
    [1, null, 20065107, 'X', 'ยังไม่ลงแผนผลิต', null, 2400, 300, 'PROD. DATE'],
    [null, null, null, null, null, null, null, null, 'BALANCE', null, -47168],
    [2, null, 20065733, 'Y', 'ปกติ', null, 2400, 300, 'PROD. DATE'],
    [null, null, null, null, null, null, null, null, 'BALANCE', null, 415],
  ];
  const parsed = parseMonitoringWorkbook([{ name: 'Argen', rows }], { asOf: '2026-09-23' });
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09', today: '2026-09-23', lineOfMat: () => 'LINE A ( 800 Ton )' });
  assert.deepEqual(rec.stock.map(s => s.mat_no), ['20065733'], 'ตัวติดลบต้องไม่อยู่ในกองที่จะเขียน');
  assert.deepEqual(rec.stockNegative.map(s => s.mat_no), ['20065107'], 'แต่ต้องยกออกมาให้คนเห็น ไม่ใช่ทิ้งเงียบ');
});

test('🔴 บล็อกซ้ำในชีทเดียว ต้องไม่ทำให้ความต้องการเป็น 2 เท่า', () => {
  const dup = [...ARGEN,
    [null, null, null, null, null, null, null, null, 'ORDER REQUIREMENT', null, 0, 1600, 1200],
    [9, null, 20065733, 'MB3B-E102D04-BC', 'BRKT ENG GRD', 50, 2400, 300, 'PROD. DATE'],
  ];
  const parsed = parseMonitoringWorkbook([{ name: 'Argen', rows: dup }], { asOf: '2026-01-19' });
  const rec = monitoringToRecords(parsed, { monthKey: '2026-09', today: '2025-01-01' });
  const same = rec.orders.filter(o => o.mat_no === '20065733' && o.due_date === '2025-12-22');
  assert.equal(same.length, 1, 'บล็อกซ้ำต้องเหลือแถวเดียว');
  assert.equal(same[0].qty, 1600, 'ห้ามบวกเป็น 3200');
  assert.equal(rec.orderDupes, 2, 'และต้องนับจำนวนที่ยุบไว้ให้เห็น');
});

/* ═══════════════════════════════════════════════════════════════════════════════
   🔎 recheck 2026-09-24 — feedback แพลนนิ่ง: "TSESA ไม่ขึ้น · RG01/RT50 ไม่ขึ้น ·
      ขอรอบขายวันนี้ขึ้นยอดเดิมเมื่อวาน"  ⇒ ไล่ไฟล์จริงแล้วทั้ง 3 ข้อคือ**เนื้อในไฟล์**
      แต่ระบบผิดที่ "เงียบ" — ล็อกพฤติกรรมใหม่ไว้ที่นี่
   ═══════════════════════════════════════════════════════════════════════════════ */
import { sheetCustomer, sheetReport } from '../monitoringSheet.js';

const CUSTOMERS = [
  { code: 'TSPK', name: 'TSPK', aliases: [] },
  { code: 'TSESA', name: 'TSESA', aliases: [] },
  { code: 'ARGENTINA', name: 'ARGENTINA', aliases: [] },
  { code: 'MYANMAR', name: 'Myanmar', aliases: ['MYANMAR'] },
];

test('sheetCustomer: ชื่อชีทมีช่องว่างท้าย ต้อง trim ก่อนเทียบ', () => {
  assert.equal(sheetCustomer('TSPK ', CUSTOMERS), 'TSPK');
});

test('sheetCustomer: "TSESA+LA " → TSESA (ตัดส่วนต่อท้ายหลัง +)', () => {
  assert.equal(sheetCustomer('TSESA+LA ', CUSTOMERS), 'TSESA');
});

test('sheetCustomer: เทียบ alias ได้ และคืน name ของทะเบียน ไม่ใช่ชื่อชีทดิบ', () => {
  assert.equal(sheetCustomer('myanmar', CUSTOMERS), 'Myanmar');
});

test('sheetCustomer: ไม่มีในทะเบียน = null ห้ามยัดชื่อชีทดิบเป็นลูกค้า', () => {
  assert.equal(sheetCustomer('110T', CUSTOMERS), null);
  assert.equal(sheetCustomer('', CUSTOMERS), null);
  assert.equal(sheetCustomer('TSPK', []), null);
});

/* ── monitoringToRecords ต้องติดชื่อลูกค้าไปกับใบ ─────────────────────────── */
const PARSED_CUST = {
  press: [], customer: [{
    sheet: 'TSESA+LA ', dates: ['2026-09-25'],
    parts: [{ mat_no: 'A1', orders: [{ due_date: '2026-09-25', qty: 100 }], min: 0, packing: 0 }],
  }],
};

test('monitoringToRecords: ใบจากชีทลูกค้าต้องมี customer (เดิม null ทั้ง 232 ใบ = จอ Delivery จัดกลุ่มไม่ได้)', () => {
  const r = monitoringToRecords(PARSED_CUST, { today: '2026-09-24', customers: CUSTOMERS, lineOfMat: () => null });
  assert.equal(r.orders.length, 1);
  assert.equal(r.orders[0].customer, 'TSESA');
});

test('monitoringToRecords: ไม่ส่งทะเบียนลูกค้ามา = customer null ไม่ใช่ชื่อชีท (ห้ามเดา)', () => {
  const r = monitoringToRecords(PARSED_CUST, { today: '2026-09-24', lineOfMat: () => null });
  assert.equal(r.orders[0].customer, null);
});

/* ── sheetReport — "อ่านถูกแล้วไม่มีของ" ต้องไม่หน้าตาเหมือน "อ่านไม่ออก" ──── */
const PARSED_MIX = {
  customer: [
    { sheet: 'TSPK', dates: ['2026-09-23', '2026-09-24'],
      parts: [{ mat_no: 'A', orders: [{ due_date: '2026-09-24', qty: 300 }] },
              { mat_no: 'B', orders: [] }] },
    // เคสจริง: ชีท TSESA ในไฟล์ ก.ย. ยังเป็นรอบ ก.ค.-ส.ค. และ Order ว่างทั้งแผ่น
    { sheet: 'TSESA+LA ', dates: ['2026-07-23', '2026-08-06'],
      parts: [{ mat_no: 'C', orders: [] }, { mat_no: 'D', orders: [] }] },
    { sheet: 'พัง', dates: [], parts: [] },
  ],
  press: [],
};

test('sheetReport: ชีทที่ให้ 0 ใบ ต้องบอกเหตุผล + วันที่ล่าสุดในชีท + เก่ากี่วัน', () => {
  const rep = sheetReport(PARSED_MIX, { today: '2026-09-24', customers: CUSTOMERS });
  const tsesa = rep.find(r => r.sheet.startsWith('TSESA'));
  assert.equal(tsesa.orders, 0);
  assert.equal(tsesa.lastDate, '2026-08-06');
  assert.equal(tsesa.staleDays, 49);
  assert.match(tsesa.note, /ช่อง Order ว่าง/);
  assert.match(tsesa.note, /2026-08-06/);
});

test('sheetReport: "อ่านพาร์ทไม่ได้เลย" ต้องเป็นข้อความคนละอันกับ "อ่านได้แต่ไม่มีออเดอร์"', () => {
  const rep = sheetReport(PARSED_MIX, { today: '2026-09-24', customers: CUSTOMERS });
  const broken = rep.find(r => r.sheet === 'พัง');
  const tsesa  = rep.find(r => r.sheet.startsWith('TSESA'));
  assert.match(broken.note, /อ่านพาร์ทไม่ได้เลย/);
  assert.notEqual(broken.note, tsesa.note, 'สองอาการนี้แก้คนละวิธี ห้ามใช้ข้อความเดียวกัน');
});

test('sheetReport: ชีทที่มีออเดอร์ = note null (ไม่ต้องเตือน) + นับใบ/ยอดถูก', () => {
  const rep = sheetReport(PARSED_MIX, { today: '2026-09-24', customers: CUSTOMERS });
  const tspk = rep.find(r => r.sheet === 'TSPK');
  assert.equal(tspk.note, null);
  assert.equal(tspk.orders, 1);
  assert.equal(tspk.orderQty, 300);
  assert.equal(tspk.customer, 'TSPK');
  assert.equal(tspk.lastDate, '2026-09-24');
  assert.equal(tspk.staleDays, 0, 'ชีทครอบคลุมถึงวันนี้ = ไม่เก่า');
});

/* ═══ ตัวแกะ "เต็มเมทริกซ์" สำหรับบอร์ด Monitoring — 2026-10-01 ════════════════════════
   เคสทั้งหมดถอดจากไฟล์จริง 1.Monitoring-Oct.xlsx (13 ชีท) · ตัวเลขที่ยืนยันแล้วว่าตรงไฟล์ */
import {
  parseBoardSheet, parseRackSheet, parseRawSheet,
  parseVendorBlockSheet, parseVendorFlatSheet,
  boardKindOfSheet, parseSheetForBoard, BOARD_ROW_KEY,
} from '../monitoringSheet.js';

const DT = (s) => new Date(`${s}T00:00:00`);

/* โครงชีท 800T ย่อ (หัวแถว 1 · วันที่แถว 2 · คอลัมน์ป้าย = หลัง %SL) */
const SHEET_800T = [
  ['NO', 'Mat SAP', 'PART NO.', 'PART NAME', 'Model', 'Time', 'LOT', 'Cost', 'Packing/std.', 'FC', '%SL', 'PLAN', 'Wed', 'Thu', 'Fri'],
  [null, null, null, null, null, null, null, null, null, null, null, null, DT('2026-09-30'), DT('2026-10-01'), DT('2026-10-02')],
  [1, '10076603', 'BHS07706', 'BRACKET LH', 'RG01', 5, 2000, 121.5, 100, 11800, null, 'PLAN', 2000, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, 'IN', 100, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, 'UNBOUND', -1700, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, 'OUT', 700, 700, 800],
  [null, null, null, null, null, null, null, null, null, null, null, 'BALANCE', 200, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, 'MIN', 1800, null, null],
];

test('parseBoardSheet — เก็บทุกช่อง + หัวตารางครบ (ชีท 800T)', () => {
  const r = parseBoardSheet(SHEET_800T);
  assert.equal(r.parts.length, 1);
  const p = r.parts[0];
  assert.equal(p.mat_no, '10076603');
  assert.equal(p.part_no, 'BHS07706');
  assert.equal(p.model, 'RG01');
  assert.equal(p.ct_sec, 5);
  assert.equal(p.lot_qty, 2000);
  assert.equal(p.cost, 121.5);
  assert.equal(p.packing, 100);
  assert.equal(p.fc, 11800);
  assert.deepEqual(r.dates, ['2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(r.rowKeys, ['plan', 'in', 'unbound', 'out', 'balance', 'min']);
  /* ค่าจริงจากไฟล์ */
  assert.deepEqual(p.cells.out, { '2026-09-30': 700, '2026-10-01': 700, '2026-10-02': 800 });
  assert.deepEqual(p.cells.balance, { '2026-09-30': 200 });
  assert.equal(p.cells.unbound['2026-09-30'], -1700);
});

test('parseBoardSheet — ช่องว่างไม่ถูกเก็บ (sparse — ไม่งั้นเมทริกซ์เดียวทะลุเพดานคิวรี)', () => {
  const p = parseBoardSheet(SHEET_800T).parts[0];
  assert.equal(Object.keys(p.cells.plan).length, 1, 'PLAN มีค่าวันเดียวในไฟล์');
  assert.equal(p.cells.plan['2026-10-01'], undefined);
});

test('parseBoardSheet — ชีทที่มี WIP ได้ 7 แถว · ชีทที่ไม่มีได้ 6 แถว (ชุดแถวไม่ hardcode)', () => {
  const withWip = SHEET_800T.map((r) => [...r]);
  withWip.splice(7, 0, [null, null, null, null, null, null, null, null, null, null, null, 'WIP', 5, null, null]);
  assert.deepEqual(parseBoardSheet(withWip).rowKeys, ['plan', 'in', 'unbound', 'out', 'balance', 'wip', 'min']);
  assert.deepEqual(parseBoardSheet(SHEET_800T).rowKeys, ['plan', 'in', 'unbound', 'out', 'balance', 'min']);
});

test('parseBoardSheet — ป้ายที่ยังไม่รู้จักต้องรายงาน ห้ามข้ามเงียบ', () => {
  const rows = SHEET_800T.map((r) => [...r]);
  rows.push([null, null, null, null, null, null, null, null, null, null, null, 'ป้ายใหม่ที่ไม่รู้จัก', 1, null, null]);
  const r = parseBoardSheet(rows);
  assert.ok(r.warnings.some((w) => w.includes('ป้ายใหม่ที่ไม่รู้จัก')), 'ต้องมีคำเตือนบอกชื่อป้าย');
});

test('parseBoardSheet — #N/A / #DIV/0! / ข้อความ ในช่องตัวเลข ถูกข้าม ไม่กลายเป็น 0', () => {
  const rows = SHEET_800T.map((r) => [...r]);
  rows[5] = [null, null, null, null, null, null, null, null, null, null, null, 'OUT', '#N/A', 700, '#DIV/0!'];
  const p = parseBoardSheet(rows).parts[0];
  assert.deepEqual(p.cells.out, { '2026-10-01': 700 });
});

test('BOARD_ROW_KEY ครอบคลุมป้ายทุกตัวที่เจอในไฟล์จริง 13 ชีท', () => {
  for (const lab of ['PLAN', 'IN', 'UNBOUND', 'OUT', 'BALANCE', 'WIP', 'MIN',
    'ORDERREQUIREMENT', 'PRODDATE', 'STOCKWH', 'SENDTOGREAT']) {
    assert.ok(BOARD_ROW_KEY[lab], `ขาดป้าย ${lab}`);
  }
});

/* ── ชีท Argen: แถว ORDER REQUIREMENT มาก่อนเลข MAT ของบล็อกนั้น ───────────────────── */
test('parseBoardSheet — Argen: ความต้องการที่อยู่ก่อนเลข MAT ต้องไปเกาะพาร์ทถัดไป ไม่เลื่อน', () => {
  const rows = [
    ['Item', 'Mat SAP', 'PART NO.', 'PART NAME', 'LOT', 'Packing', 'REQUIREMENT DATE', null],
    [null, null, null, null, null, null, 'ส่งเกรท', DT('2026-10-05'), DT('2026-10-12')],
    [1, null, null, null, null, null, 'ORDER REQUIREMENT', 1600, 1200],
    [null, '20065733', 'MB3B-E102D04', 'BRKT ENG GRD', 2400, 300, 'PLAN', 2400, null],
    [null, null, null, null, null, null, 'BALANCE', 2253, null],
  ];
  const r = parseBoardSheet(rows);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].mat_no, '20065733');
  assert.deepEqual(r.parts[0].cells.order_req, { '2026-10-05': 1600, '2026-10-12': 1200 },
    'ความต้องการต้องอยู่กับพาร์ทที่เปิดบล็อกถัดมา');
});

/* ── ชีท TSPK/TSESA รายแร็ค ───────────────────────────────────────────────────────── */
const SHEET_RACK = [
  ['ITEM', 'PICTURE', "Mat'l", 'PART NO.', 'Model', 'P.STD.', 'Rack', 'MIN', 'MAX', 'FG', null, null, 'Back', DT('2026-10-01'), null, DT('2026-10-02'), null],
  [null, null, null, null, null, null, null, null, null, 'Stock W/H', 'ผลิต/WIP', 'Total', null, 'Order', 'balance', 'Order', 'balance'],
  [1, null, '10076603', 'BHS07706 (LH)', '20TF/RG01', 100, 1, 1800, 3800, 100, null, 100, null, 700, -600, 800, -1400],
];

test('parseRackSheet — ยอดยกมา = Stock W/H + ผลิต/WIP · คอลัมน์ balance ในไฟล์ไม่ถูกอ่าน', () => {
  const r = parseRackSheet(SHEET_RACK);
  assert.equal(r.parts.length, 1);
  const p = r.parts[0];
  assert.equal(p.mat_no, '10076603');
  assert.equal(p.packing, 100);
  assert.deepEqual(p.cells.order, { '2026-10-01': 700, '2026-10-02': 800 });
  assert.deepEqual(p.cells.balance, { '2026-10-01': 100 }, 'ยอดยกมาอยู่คอลัมน์แรกเท่านั้น');
  assert.deepEqual(p.cells.min, { '2026-10-01': 1800 });
  assert.deepEqual(p.cells.max, { '2026-10-01': 3800 });
  /* ❗ ค่า −600 / −1400 ในไฟล์เป็นผลของสูตร ⇒ ห้ามเก็บ (RECUR.deplete คิดใหม่ให้เหมือนกัน) */
  assert.equal(Object.keys(p.cells.balance).length, 1);
});

/* ── ชีท mat (R402) วัตถุดิบม้วน ──────────────────────────────────────────────────── */
const SHEET_MAT = [
  ['DAILY REPORT STORE RAW MATERIAL (R402)'],
  ['Item', " Mat'l SAP", 'Description', 'PICTURE', 'Semi Part', 'อัตราการใช้', 'อัตรา', 'คงเหลือ', 'จำนวนชิ้น', 'งานท้ายไลน์(ชิ้น)', 'คำนวณเหล็ก'],
  [1, '50027079', 'WSS-M1A365-A11 1.40 X 187', null, 'GST FRT FNDR APR LH', '0.148 Kgs.', 0.148, 699, 4722.97, 2446, 362.008],
  [2, '50027083', 'WSS-M1A367-A33 1.70 X 350', null, 'WAL BRKT', '0.341 Kgs. (ได้ 2 ชิ้น)', 0.341, 1135, 6656.89, null, null],
  [3, '50027085', 'WSS-M1A367-A36 1.50 X 368', null, 'REINF FRT S/M', '0.641 Kgs. (ได้ R/L)', 0.641, null, 0, 221, 141.661],
];

test('parseRawSheet — อ่านอัตรา/คงเหลือ/งานท้ายไลน์ · ไม่เก็บช่องที่เป็นสูตร', () => {
  const r = parseRawSheet(SHEET_MAT, { asOf: '2026-10-01' });
  assert.equal(r.parts.length, 3);
  const [a, b, c] = r.parts;
  assert.equal(a.mat_no, '50027079');
  assert.equal(a.kg_per_piece, 0.148);
  assert.deepEqual(a.cells.on_hand_kg, { '2026-10-01': 699 });
  assert.deepEqual(a.cells.queue_pcs, { '2026-10-01': 2446 });
  /* "จำนวนชิ้น" และ "คำนวณเหล็ก" เป็นสูตร ⇒ ไม่มีคีย์ไหนเก็บไว้ */
  assert.deepEqual(Object.keys(a.cells).sort(), ['on_hand_kg', 'queue_pcs']);
  /* งานคู่: "(ได้ 2 ชิ้น)" → 2 · "(ได้ R/L)" → 2 · ไม่ระบุ → null (ห้ามเดา 1) */
  assert.equal(a.pieces_per_shot, null);
  assert.equal(b.pieces_per_shot, 2);
  assert.equal(c.pieces_per_shot, 2);
  assert.equal(c.cells.on_hand_kg, undefined, 'คงเหลือว่าง = ไม่เก็บ ไม่ใช่ 0');
});

test('parseRawSheet — ไม่ระบุวันอ้างอิง = เตือน ไม่เก็บยอดคงเหลือ', () => {
  const r = parseRawSheet(SHEET_MAT, {});
  assert.ok(r.warnings.some((w) => w.includes('asOf')));
  assert.deepEqual(r.parts[0].cells, {});
});

/* ── ชีทงานส่งชุบ ─────────────────────────────────────────────────────────────────── */
const SHEET_824 = [
  [],
  [null, 'Mat.SAP', 'PART NO.', 'Forecast', 'Total SL', null, null, 'WIP Vendor', DT('2026-09-01'), DT('2026-09-02'), DT('2026-09-03')],
  ['ก่อนชุบ', '20066542', 'R1WB-17K824-AAW', 3383.6, 3634, 'TSAT4 to JRPE', null, null, null, 398, null],
  ['หลังชุบ', '20066540', null, null, null, 'JRPE to TSAT4', null, null, 250, 150, 200],
  [null, 1.074, null, null, null, 'Stock Vendor', null, 849, 599, 847, 647],
];

test('parseVendorBlockSheet — 1 บล็อก = 1 พาร์ท ที่มีเลข SAP ก่อน/หลังชุบ', () => {
  const r = parseVendorBlockSheet(SHEET_824);
  assert.equal(r.parts.length, 1, 'ก่อนชุบ+หลังชุบ = พาร์ทเดียว ไม่ใช่ 2');
  const p = r.parts[0];
  assert.equal(p.mat_no, '20066542');
  assert.equal(p.mat_after, '20066540');
  assert.equal(p.fc, 3383.6);
  /* ยอดยกมาที่ไม่มีวันที่กำกับ ถูกยกให้เป็นคอลัมน์ "วันก่อนวันแรก" */
  assert.equal(r.dates[0], '2026-08-31');
  assert.equal(p.cells.at_vendor['2026-08-31'], 849);
  assert.equal(p.cells.at_vendor['2026-09-01'], 599);
  assert.equal(p.cells.from_vendor['2026-09-01'], 250);
  assert.equal(p.cells.to_vendor['2026-09-02'], 398);
});

test('parseVendorFlatSheet — ชีท RA: 1 พาร์ท/แถว · หยุดเมื่อเจอตารางที่ 2', () => {
  const rows = [
    ['No', 'Mat.SAP', null, 'Part Name', 'FC', 'Sum', 'Total', 'Diff Forecast', '%SL', DT('2026-09-01'), DT('2026-09-02')],
    [1, '10094690', '73022056', 'N1WB-E20022-AB', 10138, 920, 7760, -2378, 0.765, 40, 40],
    [1, '10087199', '73022058', 'N1WB-E20022-FTM', null, 2280, null, null, null, 240, 200],
    [null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null],
    [null, 'Sum total', 'FG', null, null, null, null, null, null, 999, 999],
    [null, '99999999', 'ของตารางที่ 2 ห้ามเก็บ', null, null, null, null, null, null, 5, 5],
  ];
  const r = parseVendorFlatSheet(rows);
  assert.equal(r.parts.length, 2, 'ต้องหยุดก่อนถึงตารางที่ 2');
  assert.equal(r.parts[0].fc, 10138);
  assert.deepEqual(r.parts[0].cells.to_vendor, { '2026-09-01': 40, '2026-09-02': 40 });
  assert.equal(r.parts[1].fc, null, 'แถวแปรย่อยไม่มี FC = null ห้ามเดา');
});

/* ── การจัดชนิดชีท ───────────────────────────────────────────────────────────────── */
test('boardKindOfSheet — ชีทไลน์ปั๊มตามชื่อตัน', () => {
  for (const n of ['110T', '300T', '250T', '800T', '600T']) {
    assert.equal(boardKindOfSheet(n, SHEET_800T).kind, 'line', n);
  }
});

test('boardKindOfSheet — ชีทที่ตั้งใจไม่ทำเป็นบอร์ด ต้องบอกเหตุผล + ติดธง intentional', () => {
  const v = boardKindOfSheet('Vlookup Argen', [['', 'Mat.#1', 'Mat.#2', 'Part No.']]);
  assert.equal(v.kind, null);
  assert.equal(v.intentional, true);
  assert.ok(v.why.includes('Argen'));
  const s = boardKindOfSheet('Sheet1 (2)', [['Picture', 'Mat SAP']]);
  assert.equal(s.kind, null);
  assert.equal(s.intentional, true);
});

test('boardKindOfSheet — ชีทที่แกะไม่ได้จริง ต้องติดธง intentional=false (ของตกหล่น ไม่ใช่ของที่ข้ามเอง)', () => {
  const r = boardKindOfSheet('ชีทใหม่เดือนหน้า', [['อะไรก็ไม่รู้']]);
  assert.equal(r.kind, null);
  assert.equal(r.intentional, false);
  assert.ok(r.why.length > 0);
});

test('boardKindOfSheet — RA ต้องเป็น vendor แบบแบน ไม่ใช่แบบบล็อก (Diff Forecast ชนกับป้ายงานชุบ)', () => {
  const rows = [
    ['No', 'Mat.SAP', null, 'Part Name', 'FC', 'Sum', 'Total', 'Diff Forecast', '%SL', DT('2026-09-01')],
    [1, '10094690', '73022056', 'N1WB', 10138, 920, 7760, -2378, 0.765, 40],
  ];
  const d = boardKindOfSheet('RA', rows);
  assert.equal(d.kind, 'vendor');
  assert.equal(d.flat, true, 'RA เป็นตารางแบน — เคยถูกส่งเข้าตัวแกะแบบบล็อกแล้วได้ 0 ช่อง');
  assert.equal(boardKindOfSheet('824-825', SHEET_824).flat, false);
});

test('parseSheetForBoard — เลือกตัวแกะให้ถูกตามชนิด + ส่งเหตุผลต่อเมื่อไม่ทำ', () => {
  assert.equal(parseSheetForBoard('800T', SHEET_800T).parts.length, 1);
  assert.equal(parseSheetForBoard('TSPK', SHEET_RACK).parts.length, 1);
  assert.equal(parseSheetForBoard('mat', SHEET_MAT, { asOf: '2026-10-01' }).parts.length, 3);
  assert.equal(parseSheetForBoard('824-825', SHEET_824).parts.length, 1);
  const skip = parseSheetForBoard('Vlookup Argen', [['', 'Mat.#1']]);
  assert.equal(skip.kind, null);
  assert.deepEqual(skip.parts, []);
  assert.equal(skip.intentional, true);
});

/* ── 🔴 กันของเดิมพัง: การเพิ่ม 'MATLSAP' ต้องไม่เปลี่ยนชนิดชีทที่ MonitoringUpload เห็น ── */
test('เพิ่ม MATLSAP แล้วชีท mat ยังคืน null จาก detectMonitoringKind (MonitoringUpload ยังข้ามเหมือนเดิม)', () => {
  assert.equal(detectMonitoringKind(SHEET_MAT), null);
});

/* ═══ 🔴 FG ห้ามลงเป็น min/max ที่ไลน์ (2026-10-02 · user แจ้งจากหน้างานสโตร์) ═══════════
   "เลข mat sap ที่โชว์คือ FG หลังกระบวนการผลิตจบ แต่สโตร์จะไม่รู้เลขนี้ สโตร์จะมองหาเลขที่
    เค้าต้องตัดจ่ายเข้าไลน์ผลิตคือพวก 5xxx 3xxx 2xxx"
   วัดจริงตอนเจอ: line_part_levels ใช้งานอยู่ 60 แถว เป็น FG 28 แถว ทุกแถวชี้ไลน์ที่ผลิตมันเอง */
test('monitoringToRecords — FG (1xxx) ไม่ลง line_part_levels · ชิ้นส่วน 2/3/5 ลงตามปกติ', () => {
  const parsed = {
    press: [{
      sheet: '600T',
      parts: [
        { mat_no: '10088639', part_name: 'FG ของไลน์นี้', min: 500, fc: 0, out: {}, plan: {}, demand: {} },
        { mat_no: '20066630', part_name: 'ชิ้นส่วนผลิตเอง', min: 300, fc: 0, out: {}, plan: {}, demand: {} },
        { mat_no: '30047585', part_name: 'ชิ้นส่วนซื้อ', min: 200, fc: 0, out: {}, plan: {}, demand: {} },
        { mat_no: '50027079', part_name: 'วัตถุดิบ', min: 100, fc: 0, out: {}, plan: {}, demand: {} },
      ],
    }],
    customer: [],
  };
  const r = monitoringToRecords(parsed, { monthKey: '2026-10', today: '2026-10-02', lineOfMat: () => 'LINE B ( 600 Ton )' });
  const mats = r.levels.map((l) => l.mat_no).sort();
  assert.deepEqual(mats, ['20066630', '30047585', '50027079'],
    'FG ต้องไม่อยู่ใน levels — ไลน์ไม่เบิกของที่ตัวเองผลิต');
  assert.equal(r.fgLevelsSkipped, 1, 'ต้องนับ FG ที่กันออก แล้วรายงานให้คนนำเข้าเห็น ห้ามข้ามเงียบ');
});

test('monitoringToRecords — ชีทลูกค้า (rack) ก็กัน FG ออกเหมือนกัน', () => {
  const parsed = {
    press: [],
    customer: [{
      sheet: 'TSPK',
      parts: [
        { mat_no: '10076603', min: 1800, max: 3800, packing: 100, orders: [] },
        { mat_no: '20058481', min: 900, max: 2400, packing: 50, orders: [] },
      ],
    }],
  };
  const r = monitoringToRecords(parsed, { monthKey: '2026-10', today: '2026-10-02', lineOfMat: () => 'LINE A ( 800 Ton )' });
  assert.deepEqual(r.levels.map((l) => l.mat_no), ['20058481']);
  assert.equal(r.fgLevelsSkipped, 1);
});

test('monitoringToRecords — ไม่มี FG เลย = fgLevelsSkipped 0 (ไม่เตือนพร่ำเพรื่อ)', () => {
  const parsed = {
    press: [{ sheet: '600T', parts: [{ mat_no: '20066630', min: 300, fc: 0, out: {}, plan: {}, demand: {} }] }],
    customer: [],
  };
  const r = monitoringToRecords(parsed, { monthKey: '2026-10', today: '2026-10-02', lineOfMat: () => 'LINE B ( 600 Ton )' });
  assert.equal(r.fgLevelsSkipped, 0);
  assert.equal(r.levels.length, 1);
});

test('FG ยังลง forecast/ออเดอร์ได้ตามปกติ — กันเฉพาะ min/max ที่ไลน์เท่านั้น', () => {
  const parsed = {
    press: [{ sheet: '600T', parts: [{ mat_no: '10088639', part_name: 'FG', min: 500, fc: 11800, out: {}, plan: {}, demand: {} }] }],
    customer: [],
  };
  const r = monitoringToRecords(parsed, { monthKey: '2026-10', today: '2026-10-02', lineOfMat: () => 'LINE B ( 600 Ton )' });
  assert.equal(r.levels.length, 0, 'ไม่ลง min/max ที่ไลน์');
  assert.equal(r.forecasts.length, 1, 'แต่ยังเป็น forecast ของ FG ได้ — คนละเรื่องกัน');
  assert.equal(r.forecasts[0].mat_no, '10088639');
});
