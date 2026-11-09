/* เทส ประเภท Downtime → ประเภทเครื่อง — src/utils/dtMachineFilter.js (2026-11-09)
   🔴 ล็อก: ว่าง = ไม่จำกัด (พฤติกรรมเดิม) · เครื่องไม่มีประเภท ไม่เข้ากลุ่มที่กรอง · ไม่ติ๊ก = null ไม่ใช่ [] */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dtMachineTypeIds, machineFitsDtType, machineTypeIdsForDb } from '../dtMachineFilter.js';

test('ประเภท DT ไม่ได้ผูก = ไม่จำกัด ทุกเครื่องผ่าน', () => {
  for (const t of [null, {}, { machine_type_ids: null }, { machine_type_ids: [] }]) {
    const ids = dtMachineTypeIds(t);
    assert.equal(ids, null);
    assert.equal(machineFitsDtType({ machine_type_id: 'x' }, ids), true);
    assert.equal(machineFitsDtType({ machine_type_id: null }, ids), true);
  }
});

test('Robot (Alarm/Error) ผูก robot 2 ประเภท → เครื่องอื่นและเครื่องไม่มีประเภทไม่ผ่าน', () => {
  const ids = dtMachineTypeIds({ machine_type_ids: ['r-hand', 'r-arc'] });
  assert.equal(machineFitsDtType({ machine_type_id: 'r-hand' }, ids), true);
  assert.equal(machineFitsDtType({ machine_type_id: 'r-arc' }, ids), true);
  assert.equal(machineFitsDtType({ machine_type_id: 'jig' }, ids), false);
  assert.equal(machineFitsDtType({ machine_type_id: null }, ids), false);
});

test('ค่าที่เก็บลงฐาน: ไม่ติ๊ก = null · ตัดซ้ำ/ว่าง', () => {
  assert.equal(machineTypeIdsForDb([]), null);
  assert.equal(machineTypeIdsForDb(null), null);
  assert.deepEqual(machineTypeIdsForDb(['a', 'a', '', 'b']), ['a', 'b']);
});
