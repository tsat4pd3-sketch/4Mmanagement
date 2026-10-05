/* เลข MAT ซ้ำในชีทเดียว (เคสจริง Argen 05/10) — ต้องรวมเป็นพาร์ทเดียว ไม่งั้น upsert ล้มทั้งบอร์ด
   ("ON CONFLICT DO UPDATE command cannot affect row a second time") */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDuplicateParts } from '../monitoringSheet.js';

const P = (mat, cells, extra = {}) => ({ mat_no: mat, cells, texts: {}, ...extra });

test('🔴 MAT ซ้ำรวมเป็นแถวเดียว · ยอดไหลบวก · ยอดคงเหลือใช้แถวแรก · มีคำเตือน', () => {
  const { parts, warnings } = mergeDuplicateParts([
    P('10100001', { order_req: { '2026-10-06': 100 }, balance: { '2026-10-05': 50 } }, { part_name: null }),
    P('10100002', { plan: { '2026-10-06': 10 } }),
    P('10100001', { order_req: { '2026-10-06': 40, '2026-10-07': 5 }, balance: { '2026-10-05': 50 } }, { part_name: 'X' }),
  ]);
  assert.equal(parts.length, 2);
  const a = parts.find(p => p.mat_no === '10100001');
  assert.deepEqual(a.cells.order_req, { '2026-10-06': 140, '2026-10-07': 5 });
  assert.deepEqual(a.cells.balance, { '2026-10-05': 50 });
  assert.equal(a.part_name, 'X', 'แอตทริบิวต์ว่างของแถวแรกเติมจากแถวหลัง');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /10100001 ×2/);
});

test('ยอดคงเหลือขัดกันต้องเตือน · ไม่ซ้ำ = ไม่เตือน · ไม่แก้ object เดิม', () => {
  const src = [P('A', { balance: { d: 1 } }), P('A', { balance: { d: 2 } })];
  const { parts, warnings } = mergeDuplicateParts(src);
  assert.equal(parts[0].cells.balance.d, 1);
  assert.equal(warnings.length, 2);
  assert.equal(src[0].cells.balance.d, 1);
  assert.deepEqual(mergeDuplicateParts([P('A', {}), P('B', {})]).warnings, []);
});
