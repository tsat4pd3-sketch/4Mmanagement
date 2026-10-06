import test from 'node:test';
import assert from 'node:assert/strict';
import { orderPlanQty, orderProducedQty } from '../oee.js';

/* "เป้า" ของใบผลิต — QC audit 05/10: จอเดโม (Obeya/FactoryMap/GroupOverview/DeptDashboard)
   นับเป้าใบยกยอดซ้ำ ⇒ ยอดผลิต vs แผน 71% ทั้งที่งานจบครบ · MorningMeeting ตัดทิ้งทั้งใบ ⇒ เกิน 100% */

test('⭐ ใบยกยอด: ต้นทาง(imported) + ปลายทาง = เป้าเดิม ไม่นับซ้ำ', () => {
  const source = { status: 'imported', qty: 35, qty_actual: 5 };
  const next = { status: 'confirmed', qty: 30, qty_ok: 30 };   // handleImportCarryOrders ออกใบ qty − qty_actual
  assert.equal(orderPlanQty(source) + orderPlanQty(next), 35);
  assert.equal(orderProducedQty(source) + orderProducedQty(next), 35);   // ⇒ 100% พอดี
});

test('ยกยอด 2 ทอด ก็ยังนับเป้าครั้งเดียว', () => {
  const a = { status: 'imported', qty: 100, qty_actual: 40 };
  const b = { status: 'imported', qty: 60, qty_actual: 20 };
  const c = { status: 'open', qty: 40, qty_actual: 0 };
  assert.equal(orderPlanQty(a) + orderPlanQty(b) + orderPlanQty(c), 100);
});

test('carry_over ที่ยังไม่มีใครรับ = เป้าเต็ม (ส่วนที่เหลือยังไม่ถูกออกใบที่ไหน)', () => {
  assert.equal(orderPlanQty({ status: 'carry_over', qty: 35, qty_actual: 5 }), 35);
});

test('cancelled = 0 · imported ผลิตเกินเป้า = เพดานที่เป้า', () => {
  assert.equal(orderPlanQty({ status: 'cancelled', qty: 50, qty_actual: 7 }), 0);
  assert.equal(orderPlanQty({ status: 'imported', qty: 35, qty_actual: 40 }), 35);
});

test('qty_target ชนะ qty (ใบ manual / ปิดยอดเศษ เก็บเป้าเดิมไว้ที่ qty_target)', () => {
  assert.equal(orderPlanQty({ status: 'confirmed', qty: 20, qty_target: 50, qty_ok: 20 }), 50);
  assert.equal(orderPlanQty({ status: 'open', qty: 50, qty_target: null }), 50);
});

test('แถวพัง/ค่าว่าง ไม่ระเบิด ไม่คืน NaN', () => {
  assert.equal(orderPlanQty(null), 0);
  assert.equal(orderPlanQty({}), 0);
  assert.equal(orderPlanQty({ status: 'imported', qty: 'x', qty_actual: null }), 0);
});
