// เทสสูตรเงิน/คะแนนของใบ M/O ทีม MTN — src/utils/mtnMoForm.js (pure)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laborAmount, partAmount, sumLabor, sumParts, grandTotal, satScore, needsPlantManager, needsApprovalFirst, qaAppliesTo, mtnApprovalState, purposeOfPrint } from '../mtnMoForm.js';

test('ค่าแรง: rate × hours · มี amount ที่กรอกเองให้ใช้ค่านั้น', () => {
  assert.equal(laborAmount({ rate_per_hour: 100, hours: 1 }), 100);
  assert.equal(laborAmount({ rate_per_hour: 200, hours: 2.5 }), 500);
  assert.equal(laborAmount({ rate_per_hour: 100, hours: 1, amount: 120 }), 120, 'ใบจริงปัดเลขเองได้');
  assert.equal(laborAmount({ worker_name: 'ก' }), null, 'ยังไม่กรอก = null ห้ามเป็น 0');
});

test('อะไหล่: qty × unit_price', () => {
  assert.equal(partAmount({ qty: 4, unit_price: 110 }), 440);
  assert.equal(partAmount({ qty: 4 }), null, 'ไม่รู้ราคา = null');
});

test('รวมยอดตามใบตัวอย่างจริง (MTN.2026/06-59)', () => {
  const labor = [
    { worker_name: 'เจนณรงค์', rate_per_hour: 100, hours: 1 },
    { worker_name: 'พิพัฒน์',  rate_per_hour: 100, hours: 1 },
    {}, {}, {},                                    // แถวว่างบนฟอร์ม
  ];
  const parts = [
    { part_name: 'เต้ารับ', qty: 4, unit_price: 110 },      // 440
    { part_name: 'ฝาครอบ 3 ช่อง', qty: 4, unit_price: 20 }, //  80
    { part_name: 'บล็อกลอย', qty: 4, unit_price: 15 },      //  60
  ];
  assert.equal(sumLabor(labor), 200);
  assert.equal(sumParts(parts), 580);
  assert.equal(grandTotal(labor, parts), 780);
});

test('ไม่มีใครกรอกเงินเลย = null (ช่องบนใบว่าง ไม่ใช่ 0)', () => {
  assert.equal(sumLabor([{}, {}]), null);
  assert.equal(sumParts([]), null);
  assert.equal(grandTotal([], []), null);
});

test('ยังไม่มีตารางรายคน ให้ถอยไปใช้ยอดรวมเดิมที่พิมพ์มือไว้ (ใบเก่า)', () => {
  assert.equal(grandTotal([], [], 200, 580), 780);
  assert.equal(grandTotal([{ rate_per_hour: 100, hours: 3 }], [], 999, 580), 880, 'ตารางชนะ fallback');
});

test('คะแนนความพึงพอใจ: คิด % จากข้อที่ให้คะแนนมาจริง', () => {
  const keys = ['quality', 'response', 'problem', 'politeness', 'readiness'];
  assert.deepEqual(satScore({ quality: 3, response: 3, problem: 3, politeness: 3, readiness: 3 }, keys),
    { sum: 15, max: 15, pct: 100, n: 5 });
  assert.deepEqual(satScore({ quality: 2, response: 3 }, keys), { sum: 5, max: 6, pct: 83, n: 2 });
  assert.deepEqual(satScore(null, keys), { sum: null, max: null, pct: null, n: 0 });
});

test('งาน "สร้าง" ต้องผ่านผู้จัดการโรงงาน', () => {
  assert.equal(needsPlantManager('build'), true);
  assert.equal(needsPlantManager('repair'), false);
  assert.equal(needsPlantManager(null), false);
});

/* ── ขั้นตอนเฉพาะของใบ MTN (2026-09-15) ───────────────────────────────── */

test('ต้องอนุมัติก่อนเริ่มงาน = ปรับปรุง/สร้างเท่านั้น — ซ่อม/บริการเริ่มได้ทันที (ไลน์ห้ามหยุดรออนุมัติ)', () => {
  assert.equal(needsApprovalFirst({ purpose: 'improve' }), true);
  assert.equal(needsApprovalFirst({ purpose: 'build' }), true);
  assert.equal(needsApprovalFirst({ purpose: 'repair' }), false);
  assert.equal(needsApprovalFirst({ purpose: 'service' }), false);
  assert.equal(needsApprovalFirst({}), false, 'ใบเก่า/ทีมอื่นที่ไม่มี purpose ต้องไม่ถูกบล็อก');
});

test('ต้องผ่าน QA = ซ่อม/บริการ · ใบที่ purpose ว่างหรือค่าแปลก = ต้องผ่าน (fail-safe)', () => {
  assert.equal(qaAppliesTo({ purpose: 'repair' }), true);
  assert.equal(qaAppliesTo({ purpose: 'service' }), true);
  assert.equal(qaAppliesTo({ purpose: 'improve' }), false);
  assert.equal(qaAppliesTo({ purpose: 'build' }), false);
  assert.equal(qaAppliesTo({}), true);
  assert.equal(qaAppliesTo({ purpose: 'อะไรไม่รู้' }), true);
});

test('mtnApprovalState: งานปรับปรุง = บล็อกจนเซ็น · งานซ่อม = แค่ค้างเซ็นรับทราบ', () => {
  const improve = mtnApprovalState({ purpose: 'improve' });
  assert.equal(improve.blocked, true);
  assert.deepEqual(improve.missing, ['dept']);
  assert.equal(improve.needPlant, false);

  const improveSigned = mtnApprovalState({ purpose: 'improve', dept_manager_at: '2026-09-15T02:00:00Z' });
  assert.equal(improveSigned.blocked, false);
  assert.deepEqual(improveSigned.missing, []);

  const repair = mtnApprovalState({ purpose: 'repair' });
  assert.equal(repair.blocked, false, 'งานซ่อมห้ามบล็อกเด็ดขาด');
  assert.equal(repair.ackPending, true, 'แต่ต้องรู้ว่ายังค้างเซ็นรับทราบ');
  assert.equal(mtnApprovalState({ purpose: 'repair', dept_manager_at: 'x' }).ackPending, false);
});

test('งานสร้างต้องครบ 2 ลายเซ็น (ต้นสังกัด + ผจก.โรงงาน)', () => {
  assert.deepEqual(mtnApprovalState({ purpose: 'build' }).missing, ['dept', 'plant']);
  const half = mtnApprovalState({ purpose: 'build', dept_manager_at: 'x' });
  assert.deepEqual(half.missing, ['plant']);
  assert.equal(half.blocked, true, 'เซ็นครึ่งเดียวยังเริ่มงานไม่ได้');
  assert.equal(mtnApprovalState({ purpose: 'build', dept_manager_at: 'x', plant_manager_at: 'y' }).blocked, false);
});

test('ใบเก่าที่ไม่มี purpose: ไม่บล็อก ไม่ค้างเซ็น (ทีม JIG/DIE/PRODUCTION ต้องไม่กระทบ)', () => {
  const legacy = mtnApprovalState({ status: 'pending' });
  assert.equal(legacy.blocked, false);
  assert.equal(legacy.blocking, false);
});

test('ช่องติ๊กจุดประสงค์บนใบพิมพ์เดาจาก repair_type ได้ (คนละตัวกับด่านกั้นงาน)', () => {
  assert.equal(purposeOfPrint({ purpose: 'service' }), 'service');
  assert.equal(purposeOfPrint({ repair_type: 'งานปรับปรุง (IM)' }), 'improve');
  assert.equal(purposeOfPrint({ repair_type: 'BM' }), 'repair');
  assert.equal(needsApprovalFirst({ repair_type: 'งานปรับปรุง (IM)' }), false, 'ด่านกั้นงานต้องไม่เดาจาก repair_type');
});
