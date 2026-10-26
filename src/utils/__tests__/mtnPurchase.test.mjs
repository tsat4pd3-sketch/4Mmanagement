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

test('เลข PR จาก SAP — normalize + รอเลข', async () => {
  const { normalizePrNo, isAwaitingPrNo } = await import('../mtnPurchase.js');
  assert.equal(normalizePrNo(' 1000 2345 '), '10002345');
  assert.equal(normalizePrNo('pr-12a'), 'PR-12A');
  assert.equal(normalizePrNo('  '), null);
  assert.equal(normalizePrNo(null), null);
  assert.equal(isAwaitingPrNo({ status: 'requested', pr_no: null }), true);
  assert.equal(isAwaitingPrNo({ status: 'ordered', pr_no: '' }), true);
  assert.equal(isAwaitingPrNo({ status: 'requested', pr_no: '10002345' }), false);
  assert.equal(isAwaitingPrNo({ status: 'cancelled', pr_no: null }), false);   // ยกเลิกแล้ว ไม่ต้องรอเลข
  assert.equal(isAwaitingPrNo({ status: 'received', pr_no: null }), false);
});

test('ใบ MO ที่ต้องเปิด PR แต่ยังไม่มีรายการ — ขึ้นคิว ห้ามตกหล่น', async () => {
  const { mosNeedingPr, NEEDS_PR_PATHS } = await import('../mtnPurchase.js');
  const orders = [
    { id: 'a', repair_path: 'inhouse_pr', status: 'assigned', report_at: '2026-10-02' },
    { id: 'b', repair_path: 'outsource', status: 'assigned', report_at: '2026-10-01' },
    { id: 'c', repair_path: 'inhouse', status: 'assigned' },                 // ไม่ต้องเปิด PR
    { id: 'd', repair_path: 'inhouse_pr', status: 'closed' },                // ปิดแล้ว
    { id: 'e', repair_path: 'inhouse_pr', status: 'assigned' },              // มี PR แล้ว
    { id: 'f', repair_path: 'inhouse_pr', status: 'assigned', report_at: '2026-10-03' },  // มีแต่ใบที่ยกเลิก
    { id: 'g', repair_path: null, status: 'assigned' },                      // ยังไม่ระบุเส้นทาง
  ];
  const prs = [{ order_id: 'e', status: 'requested' }, { order_id: 'f', status: 'cancelled' }];
  const out = mosNeedingPr(orders, prs, o => o.status !== 'closed').map(o => o.id);
  assert.deepEqual(out, ['b', 'a', 'f']);   // เก่าสุดก่อน
  assert.ok(NEEDS_PR_PATHS().includes('inhouse_pr') && NEEDS_PR_PATHS().includes('outsource'));
});

test('สถานะงาน PR ของใบ MO — ตัวกรองรายการ MO', async () => {
  const { prQueueStateOf } = await import('../mtnPurchase.js');
  assert.equal(prQueueStateOf({ repair_path: 'inhouse_pr' }, []), 'need');
  assert.equal(prQueueStateOf({ repair_path: 'outsource' }, [{ status: 'cancelled' }]), 'need');
  assert.equal(prQueueStateOf({ repair_path: 'inhouse_pr' }, [{ status: 'requested', pr_no: null }, { status: 'ordered', pr_no: '1000' }]), 'no_no');
  assert.equal(prQueueStateOf({ repair_path: 'inhouse_pr' }, [{ status: 'ordered', pr_no: '1000' }]), 'open');
  assert.equal(prQueueStateOf({ repair_path: 'inhouse_pr' }, [{ status: 'received', pr_no: '1000' }]), null);
  assert.equal(prQueueStateOf({ repair_path: 'inhouse' }, []), null);
  assert.equal(prQueueStateOf({ repair_path: null }, [{ status: 'requested', pr_no: '' }]), 'no_no');   // เปิดจากคลังโดยไม่ตั้งเส้นทาง ก็ยังรอเลข
});
