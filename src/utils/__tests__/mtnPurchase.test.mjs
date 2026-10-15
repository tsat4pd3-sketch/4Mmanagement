/* ใบขอซื้อ (PR) งานช่าง · GL · จ่ายหลายช่าง (2026-10-14) — ล็อกกฎที่ผิดแล้วเงียบ */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBelowMin, suggestReorderQty, openPrQtyByPart, prNumbersOf, prPlacement,
  assignedTechsOf, joinTechs, defaultGlFor, glCategoryForPr, isPrOpen, repairPathMeta,
} from '../mtnPurchase.js';

test('Min ไม่ได้ตั้ง = ไม่ติด Min (ไม่รู้ ≠ ขาด)', () => {
  assert.equal(isBelowMin({ min_qty: null, stock_qty: 0 }), false);
  assert.equal(isBelowMin({ min_qty: 0, stock_qty: 0 }), false);
  assert.equal(isBelowMin({ min_qty: 5, stock_qty: 5 }), true);
  assert.equal(isBelowMin({ min_qty: 5, stock_qty: 6 }), false);
  assert.equal(isBelowMin({ min_qty: 5, stock_qty: null }), true);
});

test('จำนวนสั่ง = เติมถึง Max · ไม่มี Max = 2×Min · หักใบค้าง กันสั่งซ้ำ', () => {
  assert.equal(suggestReorderQty({ min_qty: 5, max_qty: 20, stock_qty: 3 }), 17);
  assert.equal(suggestReorderQty({ min_qty: 5, stock_qty: 3 }), 7);
  assert.equal(suggestReorderQty({ min_qty: 5, max_qty: 20, stock_qty: 3 }, 17), 0);
  assert.equal(suggestReorderQty({ min_qty: 5, max_qty: 20, stock_qty: 10 }), 0);   // ไม่ติด min
});

test('ยอดเปิดค้างต่ออะไหล่ นับเฉพาะ requested/ordered', () => {
  const m = openPrQtyByPart([
    { part_id: 'a', qty: 3, status: 'requested' }, { part_id: 'a', qty: 2, status: 'ordered' },
    { part_id: 'a', qty: 9, status: 'received' }, { part_id: 'a', qty: 9, status: 'cancelled' },
    { part_id: null, qty: 4, status: 'requested' },
  ]);
  assert.deepEqual(m, { a: 5 });
  assert.equal(isPrOpen({ status: 'ordered' }), true);
  assert.equal(isPrOpen({ status: 'received' }), false);
});

test('PR เดียว → ช่องข้างบน · หลายใบ → ช่องรายละเอียด (ช่องบนว่าง)', () => {
  const o = { id: 'o1', pr_no: null };
  assert.deepEqual(prPlacement(o, []), { header: null, detail: [] });
  assert.deepEqual(prPlacement(o, [{ order_id: 'o1', pr_no: 'PR2610-0001', status: 'requested' }]),
    { header: 'PR2610-0001', detail: [] });
  const two = prPlacement(o, [
    { order_id: 'o1', pr_no: 'PR2610-0001', status: 'ordered' },
    { order_id: 'o1', pr_no: 'PR2610-0002', status: 'received' },
    { order_id: 'o1', pr_no: 'PR2610-0003', status: 'cancelled' },
  ]);
  assert.equal(two.header, null);
  assert.deepEqual(two.detail, ['PR2610-0001', 'PR2610-0002']);
});

test('เลข PR ที่กรอกมือเดิม (mtn_orders.pr_no) ยังนับ และไม่ซ้ำ', () => {
  const o = { id: 'o1', pr_no: 'PR2610-0001' };
  assert.deepEqual(prNumbersOf(o, [{ order_id: 'o1', pr_no: 'PR2610-0001', status: 'requested' }]), ['PR2610-0001']);
  assert.deepEqual(prPlacement({ id: 'o1', pr_no: 'MANUAL1' }, [{ order_id: 'o1', pr_no: 'PR2610-0009', status: 'ordered' }]).detail,
    ['MANUAL1', 'PR2610-0009']);
});

test('ช่างหลายคน — assigned_techs ชนะ · ใบเก่าแยกจาก assigned_to', () => {
  assert.deepEqual(assignedTechsOf({ assigned_techs: ['ก', 'ข', 'ก'] }), ['ก', 'ข']);
  assert.deepEqual(assignedTechsOf({ assigned_to: 'สมชาย' }), ['สมชาย']);
  assert.deepEqual(assignedTechsOf({ assigned_to: 'ก, ข' }), ['ก', 'ข']);
  assert.deepEqual(assignedTechsOf({}), []);
  assert.equal(joinTechs(['ก', ' ', 'ข']), 'ก, ข');
});

test('GL ตั้งต้น — is_default ก่อน · แถวเดียวใช้แถวนั้น · หลายแถวไม่มี default = null', () => {
  const gl = [
    { category: 'service', gl_code: '6100', is_default: false },
    { category: 'spare_part', gl_code: '5200' }, { category: 'spare_part', gl_code: '5201', is_default: true },
  ];
  assert.equal(defaultGlFor('service', gl).gl_code, '6100');
  assert.equal(defaultGlFor('spare_part', gl).gl_code, '5201');
  assert.equal(defaultGlFor('spare_part', gl.slice(0, 2)).gl_code, '5200');
  assert.equal(defaultGlFor('spare_part', [...gl.slice(0, 2), { category: 'spare_part', gl_code: '5299' }]), null);
  assert.equal(glCategoryForPr({ partId: 'x', repairPath: 'outsource' }), 'spare_part');
  assert.equal(glCategoryForPr({ repairPath: 'outsource' }), 'service');
  assert.equal(repairPathMeta('outsource').outsource, true);
  assert.equal(repairPathMeta(null), null);
});
