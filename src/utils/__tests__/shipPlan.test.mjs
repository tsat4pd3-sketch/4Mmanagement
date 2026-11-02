import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEsmartManaged, isEsmartPlanRow } from '../shipPlan.js';

const M = buildEsmartManaged([{ customer: 'GRBNA', mat_no: '10100385' }, { customer: 'GRBNA', mat_no: null }]);
const o = (x = {}) => ({ customer: 'GRBNA', mat_no: '10100385', source: 'edi_862', status: 'pending', pull_batch_id: null, ...x });

test('ใบ 862 pending ของพาร์ทที่ e-SMART คุม = แผน (ไม่ใช่ order เลยเวลา)', () => {
  assert.equal(isEsmartPlanRow(o(), M), true);
});

test('ยืนยันแล้ว / ไฟล์ e-SMART จองแล้ว / คีย์มือ / พาร์ทที่ e-SMART ไม่เคยคุม / ship-to อื่น = order ปกติ', () => {
  assert.equal(isEsmartPlanRow(o({ status: 'confirmed' }), M), false);
  assert.equal(isEsmartPlanRow(o({ pull_batch_id: 'b' }), M), false);
  assert.equal(isEsmartPlanRow(o({ source: 'manual' }), M), false);
  assert.equal(isEsmartPlanRow(o({ mat_no: '10100814' }), M), false);
  assert.equal(isEsmartPlanRow(o({ customer: 'GBL9A' }), M), false);
});

test('โหลดชุดไม่ได้ (ว่าง) = order ปกติทั้งหมด (พฤติกรรมเดิม ไม่ซ่อนอะไร)', () => {
  assert.equal(isEsmartPlanRow(o(), new Set()), false);
  assert.equal(isEsmartPlanRow(o(), null), false);
});
