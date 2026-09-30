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

import { focusDomain } from '../chartAxis.js';
test('focusDomain — ยกพื้นแกนขึ้นใกล้ค่าต่ำสุด · ทุกค่า (แท่ง/T/C) อยู่ในช่วง · tick สวย', () => {
  const vals = [1.49, 1.16, 1.34, 1.55, 1.31, 1.07, 1.02, 1.49, 1.3042, 1.3445];
  const f = focusDomain(vals, { max: 100 });
  assert.ok(f && f.truncated);
  assert.ok(f.domain[0] > 0 && f.domain[0] <= Math.min(...vals), `lo ${f.domain[0]}`);
  assert.ok(f.domain[1] >= Math.max(...vals), `hi ${f.domain[1]}`);
  assert.ok(f.ticks.length >= 3 && f.ticks[0] === f.domain[0] && f.ticks.at(-1) === f.domain[1]);
  for (const tk of f.ticks) assert.equal(String(tk).length <= 6, true, `tick ไม่สวย ${tk}`);
});
test('focusDomain — ค่าที่มี 0 / ติดลบ / ว่าง ⇒ null (แกนปกติ ห้ามซ่อนศูนย์)', () => {
  assert.equal(focusDomain([0, 5, 8]), null);
  assert.equal(focusDomain([-1, 5]), null);
  assert.equal(focusDomain([]), null);
  assert.equal(focusDomain([null, undefined, 'x']), null);
});
test('focusDomain — ค่าเท่ากันหมด ยังได้ช่วงที่มองเห็น · เพดาน % ไม่เกิน 100', () => {
  const f = focusDomain([95, 95, 95], { max: 100 });
  assert.ok(f && f.domain[0] < 95 && f.domain[1] >= 95 && f.domain[1] <= 100);
  const g = focusDomain([98, 99.5, 100], { max: 100 });
  assert.equal(g.domain[1], 100);
});
test('focusDomain — เดือนว่าง (null) ต้องไม่นับเป็น 0 (Number(null)=0 เคยทำให้โฟกัสไม่ทำงานทั้งบอร์ด 30/09)', () => {
  const f = focusDomain([null, 93.1, 95.2, null, 95.8, undefined, 95], { max: 100 });
  assert.ok(f && f.domain[0] > 0 && f.domain[0] <= 93.1 && f.domain[1] >= 95.8 && f.domain[1] <= 100);
});
