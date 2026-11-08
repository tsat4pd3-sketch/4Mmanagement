import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openOrderDemand } from '../openOrderDemand.js';

const products = [
  { id: 'fg1', mat_no: '20058490', name: 'FG', is_active: true, is_operation: false },
  { id: 'op1', mat_no: '20099999', name: 'OP', is_active: true, is_operation: true },
  { id: 'c-op', mat_no: '20077777', name: 'child op', is_active: true, is_operation: true },
];
const bom = [
  { product_id: 'fg1', mat_no: '50027085', part_name: 'SHEET', qty_per_unit: 0.321, uom: 'PC', is_active: true },
  { product_id: 'fg1', mat_no: '20077777', part_name: 'op child', qty_per_unit: 1, is_active: true },
  { product_id: 'fg1', mat_no: '30000001', part_name: 'off', qty_per_unit: 2, is_active: false },
  { product_id: 'other', mat_no: '50027085', qty_per_unit: 0.321, is_active: true },   // ใบอื่น ห้ามนับ
];

test('ระเบิดเฉพาะใบ BOM ของ FG เอง · ข้ามลูก OP/แถวปิด · หักยอดหน้าไลน์', () => {
  const r = openOrderDemand({
    orders: [{ id: 'o1', mat_no: '20058490', qty: 300, prod_no: 'P1', line_name: 'LINE D' },
             { id: 'o2', mat_no: '20058490', qty: 100, prod_no: 'P2', line_name: 'LINE D' }],
    products, bom,
    stockAt: (l, m) => (l === 'LINE D' && m === '50027085' ? 50 : null),
  });
  assert.equal(r.rows.length, 1);
  const x = r.rows[0];
  assert.equal(x.mat_no, '50027085');
  assert.ok(Math.abs(x.need - 128.4) < 1e-9);
  assert.equal(x.atLine, 50);
  assert.ok(Math.abs(x.shortAtLine - 78.4) < 1e-9);
  assert.equal(x.orders.length, 2);
  assert.equal(r.orders, 2);
});

test('ไม่รู้ยอดหน้าไลน์ = null ห้ามเป็น 0 · FG ไม่เจอ/ไม่มี BOM/ชั้น OP ต้องคืนออกมา', () => {
  const r = openOrderDemand({
    orders: [{ id: 'a', mat_no: '20058490', qty: 10, line_name: 'L' },
             { id: 'b', mat_no: '1NOTFOUND', qty: 5, line_name: 'L' },
             { id: 'c', mat_no: '20099999', qty: 5, line_name: 'L' }],
    products: [...products, { id: 'nb', mat_no: '2NOBOM', is_active: true }], bom,
  });
  assert.equal(r.rows[0].atLine, null);
  assert.equal(r.rows[0].shortAtLine, null);
  assert.deepEqual(r.noProduct, ['1NOTFOUND']);
  assert.equal(r.opOrders, 1);
  const r2 = openOrderDemand({ orders: [{ id: 'd', mat_no: '2NOBOM', qty: 1, line_name: 'L' }], products: [...products, { id: 'nb', mat_no: '2NOBOM', is_active: true }], bom });
  assert.deepEqual(r2.noBom, ['2NOBOM']);
});
