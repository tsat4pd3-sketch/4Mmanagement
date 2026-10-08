/* rateFor ถอยไปใช้ rate เก่าสุดเมื่อไม่มีแถวที่มีผลก่อนวันอ้างอิง — ต้องตรวจจับได้ (QC 05/10) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rateFor, rateIsFallback } from '../costSaving.js';

const rates = [
  { cost_center: 'P411', effective_from: '2026-01-01', dl_rate: 100 },
  { cost_center: 'P411', effective_from: '2027-01-01', dl_rate: 120 },
];

test('มี rate ที่มีผลก่อนวันอ้างอิง = ไม่ใช่ตัวถอย', () => {
  const r = rateFor(rates, 'P411', '2026-06-01');
  assert.equal(r.effective_from, '2026-01-01');
  assert.equal(rateIsFallback(r, '2026-06-01'), false);
  assert.equal(rateFor(rates, 'P411', '2027-03-01').dl_rate, 120);
});

test('วันอ้างอิงก่อน rate แถวแรก = ถอยไปแถวเก่าสุด และติดธง', () => {
  const r = rateFor(rates, 'P411', '2025-05-01');
  assert.equal(r.effective_from, '2026-01-01');
  assert.equal(rateIsFallback(r, '2025-05-01'), true);
});

test('ไม่มี rate / ไม่มีวันอ้างอิง = ไม่ติดธง', () => {
  assert.equal(rateIsFallback(null, '2026-01-01'), false);
  assert.equal(rateIsFallback(rates[0], null), false);
});
