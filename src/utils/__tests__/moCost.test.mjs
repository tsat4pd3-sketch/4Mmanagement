import test from 'node:test';
import assert from 'node:assert/strict';
import { moCostOf, moCostYearRows, moCostDateOf } from '../moCost.js';

test('วันที่นับ = ho_at ตามเวลาไทย (ข้ามเที่ยงคืน UTC) · ไม่มี ho_at = ไม่นับ', () => {
  assert.equal(moCostDateOf({ ho_at: '2026-11-03T18:30:00Z' }), '2026-11-04');   // 01:30 ไทย วันถัดไป
  assert.equal(moCostDateOf({ ho_at: null }), null);
});

test('ยอดต่อใบ = แถวรายคน/อะไหล่ก่อน · ไม่มีแถวถอยไป labor_cost/parts_cost · ใบไม่รู้ยอดนับ nNoCost ไม่ใช่ 0 · cancelled ไม่นับ', () => {
  const orders = [
    { id: 'a', status: 'closed', ho_at: '2026-11-03T02:00:00Z', labor_cost: 100, parts_cost: 50 },          // ไม่มีแถว → 150
    { id: 'b', status: 'closed', ho_at: '2026-11-03T02:00:00Z', labor_cost: 999, parts_cost: null },        // มีแถวค่าแรง 2×200=400 ชนะ header · อะไหล่ qty×price 3×10=30
    { id: 'c', status: 'handover', ho_at: '2026-11-04T02:00:00Z', labor_cost: null, parts_cost: null },     // ยังไม่ลงค่าใช้จ่าย
    { id: 'd', status: 'cancelled', ho_at: '2026-11-04T02:00:00Z', labor_cost: 5000, parts_cost: 0 },       // ยกเลิก = ไม่นับ
    { id: 'e', status: 'closed', ho_at: null, labor_cost: 70, parts_cost: 0 },                              // ยังไม่รับมอบ = ไม่นับ
  ];
  const r = moCostOf({ orders, laborByOrder: { b: [{ rate_per_hour: 200, hours: 2 }] }, partsByOrder: { b: [{ qty: 3, unit_price: 10 }] } });
  assert.equal(r.n, 3); assert.equal(r.nCost, 2); assert.equal(r.nNoCost, 1);
  assert.equal(r.baht, 150 + 430);
  assert.equal(r.byDate['2026-11-03'].baht, 580); assert.equal(r.byDate['2026-11-03'].n, 2);
  assert.equal(r.byDate['2026-11-04'], undefined);
  assert.equal(moCostOf({ orders: [] }).baht, 0);
});

test('โหมดปี: รวม labor+parts ต่อเดือน · นับใบไม่รู้ยอดแยก', () => {
  const y = moCostYearRows([
    { m: '2026-01', line: 'A', n: 3, n_nocost: 1, labor: 100, parts: 50.4 },
    { m: '2026-01', line: 'B', n: 1, n_nocost: 0, labor: 10, parts: 0 },
    { m: '2026-02', line: 'A', n: 2, n_nocost: 2, labor: null, parts: null },
  ]);
  assert.deepEqual(y.rows, [{ m: '2026-01', dt: 0, ng: 0, ot: 0, mo: 160 }, { m: '2026-02', dt: 0, ng: 0, ot: 0, mo: 0 }]);
  assert.equal(y.n, 6); assert.equal(y.nNoCost, 3);
});
