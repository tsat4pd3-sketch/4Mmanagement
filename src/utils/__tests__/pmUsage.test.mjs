// เทสตัวนับ usage ของ PM แบบ condition-based — src/utils/pmUsage.js (pure)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  usageQtyOf, sumUsage, piecesToShots, usageLevel, usageProgress, dailyRate, usageEta, addDays,
} from '../pmUsage.js';

const ROWS = [
  { line_name: 'HDF1', work_date: '2026-09-01', qty: 100 },
  { line_name: 'HDF1', work_date: '2026-09-05', qty: 200 },
  { line_name: 'HDF2', work_date: '2026-09-05', qty: 50 },
  { line_name: 'LINE A', work_date: '2026-09-06', qty: 999 },
];

test('นับจาก qty เท่านั้น — qty_ok/qty_actual ใช้ไม่ได้ (89% ของใบมี qty_actual = 0)', () => {
  assert.equal(usageQtyOf({ qty: 120, qty_ok: 5, qty_actual: 0 }), 120);
  assert.equal(usageQtyOf({ qty_ok: 999 }), 0, 'ไม่มี qty = 0 ห้ามไปหยิบ qty_ok มาแทน');
  assert.equal(usageQtyOf(null), 0);
  assert.equal(usageQtyOf({ qty: 'abc' }), 0);
});

test('รวมยอดตามครอบครัวไลน์ (ไลน์แม่-ลูกต้องนับรวมกัน)', () => {
  assert.equal(sumUsage(ROWS, { lines: ['HDF1', 'HDF2'] }).qty, 350);
  assert.equal(sumUsage(ROWS, { lines: ['HDF1'] }).qty, 300);
  assert.equal(sumUsage(ROWS).qty, 1349, 'ไม่ระบุไลน์ = ทั้งหมด');
  assert.equal(sumUsage(ROWS, { lines: [' hdf1 '] }).qty, 300, 'ชื่อไลน์ต้อง normalize');
  assert.equal(sumUsage(ROWS, { lines: ['ไม่มีไลน์นี้'] }).qty, 0);
});

test('since เป็น exclusive — ยอดของ "วัน PM" ต้องไม่ถูกนับเข้ารอบใหม่', () => {
  assert.equal(sumUsage(ROWS, { lines: ['HDF1'], since: '2026-09-01' }).qty, 200);
  assert.equal(sumUsage(ROWS, { lines: ['HDF1'], since: '2026-09-05' }).qty, 0);
  assert.equal(sumUsage(ROWS, { lines: ['HDF1'], since: '2026-08-31' }).qty, 300);
  // until เป็น inclusive
  assert.equal(sumUsage(ROWS, { lines: ['HDF1'], until: '2026-09-01' }).qty, 100);
});

test('sumUsage คืนจำนวน "วันที่เดินงานจริง" + ช่วงวัน', () => {
  const s = sumUsage(ROWS, { lines: ['HDF1', 'HDF2'] });
  assert.equal(s.days, 3);
  assert.equal(s.firstDate, '2026-09-01');
  assert.equal(s.lastDate, '2026-09-05');
});

test('ชิ้น → shot: งานคู่ 1 stroke = 2 ชิ้น · ไม่รู้ pieces_per_stroke ต้องคืน null ห้ามเดา', () => {
  assert.equal(piecesToShots(1000, 2), 500);
  assert.equal(piecesToShots(1000, 1), 1000);
  assert.equal(piecesToShots(1000, null), null);
  assert.equal(piecesToShots(1000, 0), null);
  assert.equal(piecesToShots(null, 2), null);
});

test('ระดับสัญญาณล้อ Andon: <70 เขียว · 70-89 เหลือง · 90-99 ส้ม · ≥100 แดง', () => {
  assert.equal(usageLevel(0), 'ok');
  assert.equal(usageLevel(69), 'ok');
  assert.equal(usageLevel(70), 'warn');
  assert.equal(usageLevel(90), 'due');
  assert.equal(usageLevel(100), 'over');
  assert.equal(usageLevel(250), 'over');
});

test('usageProgress: ยังไม่ตั้งเกณฑ์ ต้องคืน null ไม่ใช่ 0% (จอต้องแยก 2 อย่างนี้ออก)', () => {
  const none = usageProgress(500, null);
  assert.equal(none.hasThreshold, false);
  assert.equal(none.pct, null);
  assert.equal(none.accum, 500, 'ยอดสะสมยังต้องบอกได้แม้ไม่มีเกณฑ์');

  const p = usageProgress(750, 1000);
  assert.deepEqual([p.pct, p.remaining, p.level, p.hasThreshold], [75, 250, 'warn', true]);
  assert.equal(usageProgress(1200, 1000).level, 'over');
  assert.equal(usageProgress(1200, 1000).remaining, -200);
  assert.equal(usageProgress(0, 0).hasThreshold, false, 'เกณฑ์ 0 = ยังไม่ตั้ง');
});

test('อัตรา/วัน หารด้วย "วันที่เดินงานจริง" ไม่ใช่วันปฏิทิน', () => {
  const rows = [
    { line_name: 'L', work_date: '2026-09-10', qty: 300 },
    { line_name: 'L', work_date: '2026-09-14', qty: 300 },
  ];
  const r = dailyRate(rows, { lines: ['L'], days: 30, todayStr: '2026-09-15' });
  assert.equal(r.activeDays, 2);
  assert.equal(r.rate, 300, 'เดิน 2 วัน ได้ 600 ⇒ 300/วันเดินงาน (ไม่ใช่ 600/30 = 20)');
  assert.equal(dailyRate([], { todayStr: '2026-09-15' }).rate, 0);
  assert.equal(dailyRate(rows, { lines: ['L'] }).rate, 0, 'ไม่มี todayStr = คำนวณไม่ได้ ต้องไม่ระเบิด');
});

test('addDays ทำงานบนสตริง ไม่แตะ timezone (ห้ามใช้ toISOString)', () => {
  assert.equal(addDays('2026-09-15', 10), '2026-09-25');
  assert.equal(addDays('2026-12-28', 7), '2027-01-04');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-09-15', 0), '2026-09-15');
});

test('คาดวันครบเกณฑ์: ต้องยืดตามสัดส่วนวันที่เดินงานจริง (เดินไม่ทุกวัน = ถึงช้ากว่า)', () => {
  // เหลือ 600 ชิ้น · เดินวันละ 300 ⇒ อีก 2 วันเดินงาน
  const full = usageEta({ accum: 400, threshold: 1000, rate: 300, activeDays: 30, windowDays: 30, todayStr: '2026-09-15' });
  assert.equal(full.daysLeft, 2);
  assert.equal(full.etaDate, '2026-09-17');
  // เดินแค่ 10 ใน 30 วัน (1 ใน 3) ⇒ 2 วันเดินงาน = ~6 วันปฏิทิน
  const part = usageEta({ accum: 400, threshold: 1000, rate: 300, activeDays: 10, windowDays: 30, todayStr: '2026-09-15' });
  assert.equal(part.daysLeft, 6);
});

test('คาดวันครบเกณฑ์: เลยเกณฑ์แล้ว = วันนี้ · ไม่มีเกณฑ์/ไม่เดินงาน = null (ห้ามเดาวัน)', () => {
  assert.equal(usageEta({ accum: 1200, threshold: 1000, rate: 100, todayStr: '2026-09-15' }).daysLeft, 0);
  assert.equal(usageEta({ accum: 100, threshold: 1000, rate: 0, todayStr: '2026-09-15' }).etaDate, null);
  assert.equal(usageEta({ accum: 100, threshold: null, rate: 500, todayStr: '2026-09-15' }).etaDate, null);
  assert.equal(usageEta({ accum: 100, threshold: 1000, rate: 500 }).etaDate, null, 'ไม่มี todayStr');
});
