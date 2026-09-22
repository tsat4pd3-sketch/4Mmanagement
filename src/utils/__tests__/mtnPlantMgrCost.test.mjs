/* ผจก.โรงงานเซ็นเฉพาะงบเกินแสน — อยู่ **นอกลูป 9 ขั้น** (user 2026-09-22)
   "ลายเซ็นทั้งหมด 7 จุด ไม่รวม ผจก.โรงงาน ที่เซ็นเฉพาะงบเกินแสน
    ตรงนั้นจะต้องปริ้นออกมาให้เซ็น แล้วส่งบัญชี"
   ล็อกไว้ว่า: ยังไม่รู้ยอด = ห้ามเตือน · เกินเพดานถึงเตือน · ไม่ไปยุ่งกับการบล็อกก่อนเริ่มงาน */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANT_MGR_COST_LIMIT, orderCostTotal, needsPlantMgrByCost,
  needsPlantManager, mtnApprovalState,
} from '../mtnMoForm.js';

test('เพดานคือแสน และต้อง "เกิน" ไม่ใช่ "ถึง"', () => {
  assert.equal(PLANT_MGR_COST_LIMIT, 100000);
  assert.equal(needsPlantMgrByCost({ labor_cost: 100000, parts_cost: 0 }), false);
  assert.equal(needsPlantMgrByCost({ labor_cost: 100000, parts_cost: 1 }), true);
});

test('ยังไม่ลงค่าใช้จ่าย = ไม่รู้ยอด ⇒ ห้ามเตือน (null ไม่ใช่ 0)', () => {
  assert.equal(orderCostTotal({}), null);
  assert.equal(needsPlantMgrByCost({}), false);
  assert.equal(needsPlantMgrByCost({ labor_cost: null, parts_cost: null }), false);
  // ลง 0 จริง = รู้แล้วว่าฟรี → ยังไม่เกินเพดาน
  assert.equal(orderCostTotal({ labor_cost: 0 }), 0);
  assert.equal(needsPlantMgrByCost({ labor_cost: 0 }), false);
});

test('รวมค่าแรง + ค่าอะไหล่ · แถวจริงชนะค่าสรุปในใบ', () => {
  assert.equal(orderCostTotal({ labor_cost: 40000, parts_cost: 70000 }), 110000);
  const labor = [{ rate_per_hour: 200, hours: 10 }];        // 2,000
  const parts = [{ qty: 2, unit_price: 60000 }];            // 120,000
  assert.equal(orderCostTotal({ labor_cost: 1, parts_cost: 1 }, labor, parts), 122000);
  assert.equal(needsPlantMgrByCost({}, labor, parts), true);
});

test('🔴 กติกาเกินแสน ต้องไม่ไปบล็อกใบก่อนเริ่มงาน (คนละจังหวะกัน)', () => {
  const pricey = { purpose: 'repair', labor_cost: 500000, dept_manager_at: null };
  assert.equal(needsPlantMgrByCost(pricey), true);
  const st = mtnApprovalState(pricey);
  assert.equal(st.blocked, false, 'งานซ่อมราคาแพงต้องเริ่มงานได้ทันที ห้ามรอลายเซ็น');
  assert.equal(st.needPlant, false, 'needPlant = กติกา purpose เดิมเท่านั้น ห้ามถูกกลืนด้วยกติกาเงิน');
  // กติกาเดิมของงานสร้างต้องไม่เปลี่ยน
  assert.equal(needsPlantManager('build'), true);
  assert.equal(needsPlantManager('repair'), false);
  assert.equal(mtnApprovalState({ purpose: 'build' }).blocked, true);
});
