/* เทส ประเภท Downtime → เครื่องที่เกี่ยวข้อง — src/utils/dtMachineFilter.js (2026-11-09)
   🔴 ล็อก: ว่างทั้งคู่ = ไม่จำกัด (พฤติกรรมเดิม) · ประเภทเครื่อง OR ชนิดอุปกรณ์ · ไม่ติ๊ก = null ไม่ใช่ [] */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dtMachineRule, machineFitsDtType, idsForDb } from '../dtMachineFilter.js';

test('ประเภท DT ไม่ได้ผูก = ไม่จำกัด ทุกเครื่องผ่าน', () => {
  for (const t of [null, {}, { machine_type_ids: null, equipment_kinds: null }, { machine_type_ids: [], equipment_kinds: [] }]) {
    const r = dtMachineRule(t);
    assert.equal(r, null);
    assert.equal(machineFitsDtType({ machine_type_id: 'x' }, r), true);
    assert.equal(machineFitsDtType({ machine_type_id: null, equipment_kind: 'die' }, r), true);
  }
});

test('Robot ผูกประเภทเครื่อง → เครื่องอื่น/ไม่มีประเภทไม่ผ่าน', () => {
  const r = dtMachineRule({ machine_type_ids: ['r-hand', 'r-arc'] });
  assert.equal(machineFitsDtType({ machine_type_id: 'r-hand' }, r), true);
  assert.equal(machineFitsDtType({ machine_type_id: 'jig' }, r), false);
  assert.equal(machineFitsDtType({ machine_type_id: null, equipment_kind: 'machine' }, r), false);
});

test('แม่พิมพ์ผูกด้วยชนิด — แม่พิมพ์ที่ไม่มีประเภทเครื่องผ่าน · เครื่องจักรไม่ผ่าน', () => {
  const r = dtMachineRule({ equipment_kinds: ['die'] });
  assert.equal(machineFitsDtType({ machine_type_id: null, equipment_kind: 'die' }, r), true);
  assert.equal(machineFitsDtType({ machine_type_id: 'hyd', equipment_kind: 'die' }, r), true);
  assert.equal(machineFitsDtType({ machine_type_id: null, equipment_kind: 'machine' }, r), false);
  assert.equal(machineFitsDtType({ machine_type_id: null, equipment_kind: null }, r), false);   // null = machine
});

test('ประเภทเครื่อง OR ชนิด', () => {
  const r = dtMachineRule({ machine_type_ids: ['grip'], equipment_kinds: ['jig'] });
  assert.equal(machineFitsDtType({ machine_type_id: 'grip', equipment_kind: 'machine' }, r), true);
  assert.equal(machineFitsDtType({ machine_type_id: 'conv', equipment_kind: 'jig' }, r), true);
  assert.equal(machineFitsDtType({ machine_type_id: 'conv', equipment_kind: 'machine' }, r), false);
});

test('ค่าที่เก็บลงฐาน: ไม่ติ๊ก = null · ตัดซ้ำ/ว่าง', () => {
  assert.equal(idsForDb([]), null);
  assert.equal(idsForDb(null), null);
  assert.deepEqual(idsForDb(['a', 'a', '', 'b']), ['a', 'b']);
});
