import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisTick, shortTick, CHART_MARGIN } from '../chartAxis.js';

test('axisTick — ฟอนต์ไม่ต่ำกว่า 11 แม้ส่งเล็กกว่ามา', () => {
  assert.equal(axisTick({ fontSize: 9 }).fontSize, 11);
  assert.equal(axisTick({ fontSize: 14 }).fontSize, 14);
  assert.equal(axisTick().fontSize, 11);
});
test('shortTick — ตัดด้วย … ที่ความยาวกำหนด ไม่ตัดของสั้น', () => {
  assert.equal(shortTick(12)('LINE APRON ASSY (HYDROFORM)'), 'LINE APRON …');
  assert.equal(shortTick(12)('LINE A'), 'LINE A');
  assert.equal(shortTick(5)(null), '');
});
test('CHART_MARGIN — ซ้ายไม่ติดลบ', () => { assert.ok(CHART_MARGIN.left >= 0); });

import { fmtAxis } from '../chartAxis.js';
test('fmtAxis — ย่อเลขใหญ่ ไม่แตะเลขเล็ก/ร้อยละ', () => {
  assert.equal(fmtAxis(1250000), '1.25M');
  assert.equal(fmtAxis(350000), '350k');
  assert.equal(fmtAxis(12500), '12.5k');
  assert.equal(fmtAxis(1500), '1,500');
  assert.equal(fmtAxis(100), '100');
  assert.equal(fmtAxis(0.35), '0.35');
  assert.equal(fmtAxis(-20000), '-20k');
});

import { alignedYWidth } from '../chartAxis.js';
test('alignedYWidth — กว้างพอสำหรับป้ายที่ยาวที่สุดของทุกกราฟในคู่', () => {
  assert.ok(alignedYWidth(['1,830', '0.45']) >= alignedYWidth(['100']));
  assert.ok(alignedYWidth(['1,250,000']) > 60);
  assert.equal(alignedYWidth([]), 36);
});
