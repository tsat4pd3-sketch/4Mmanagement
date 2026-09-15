// เทสสูตรเงิน/คะแนนของใบ M/O ทีม MTN — src/utils/mtnMoForm.js (pure)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laborAmount, partAmount, sumLabor, sumParts, grandTotal, satScore, needsPlantManager } from '../mtnMoForm.js';

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
