import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sapEquivalent } from '../sapView.js';

test('มุม SAP: ชิ้นผ่านขั้นแปลงกลับเป็นของที่ขั้นกิน + ไล่โซ่ + ขั้นไม่ผูกต้องบอก', () => {
  const inputsOf = new Map([
    ['STEP1', [{ mat_no: 'STEEL', qty_per_unit: 1, is_op_output: false }]],
    ['HDF', [{ mat_no: 'TUBE', qty_per_unit: 1, is_op_output: false }]],
    ['LASER', [{ mat_no: 'HDF', qty_per_unit: 1, is_op_output: true }]],
    ['BEND', []],
  ]);
  const r = sapEquivalent([
    { mat_no: 'STEEL', qty: 500 }, { mat_no: 'STEP1', qty: 234 },
    { mat_no: 'HDF', qty: 10 }, { mat_no: 'LASER', qty: 5 }, { mat_no: 'BEND', qty: 7 }, { mat_no: 'NUT', qty: 99 },
  ], inputsOf);
  const by = Object.fromEntries(r.rows.map(x => [x.mat_no, x]));
  assert.deepEqual([by.STEEL.own, by.STEEL.fromOps, by.STEEL.sap], [500, 234, 734]);   // ตัวอย่างที่คุยกับ user
  assert.equal(by.TUBE.sap, 15);                                                        // HDF 10 + LASER 5 ไล่ลงไปเป็นท่อ
  assert.equal(by.NUT, undefined, 'ของที่ไม่เกี่ยวกับขั้น ไม่ต้องขึ้นในกล่องมุม SAP');
  assert.equal(r.ops.find(o => o.mat_no === 'BEND').unmapped, true);
});
