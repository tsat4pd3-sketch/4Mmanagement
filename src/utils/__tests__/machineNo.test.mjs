import test from 'node:test';
import assert from 'node:assert/strict';
import { machineKey, buildMachineKeyMap, snapMachineNo } from '../machineNo.js';

/* ทะเบียนจริง (ตัดมาจาก machines ฝั่ง DR) + ค่าที่พนักงานพิมพ์จริงใน downtime_logs */
const REG = ['LS-01', 'LS-04', 'LS-10', 'LS-11', 'RB-102', 'RB-127', 'SP-78', 'LWR-306'];
const MAP = buildMachineKeyMap(REG.map((machine_no) => ({ machine_no })));

test('คีย์ตัดเฉพาะ "รูปแบบ" — ตัวพิมพ์ · ช่องว่าง · ขีด · ศูนย์นำหน้า', () => {
  assert.equal(machineKey('LS-10'), 'LS10');
  assert.equal(machineKey('ls10'), 'LS10');
  assert.equal(machineKey('LS 010'), 'LS10');
  assert.equal(machineKey('RB 102'), 'RB102');
  assert.equal(machineKey('Lwr306'), 'LWR306');
});

test('🔴 สะกดต่างกันแต่เป็นเครื่องเดียวกัน → คืนเลขตามทะเบียน', () => {
  assert.equal(snapMachineNo('LS10', MAP), 'LS-10');
  assert.equal(snapMachineNo('RB 102', MAP), 'RB-102');
  assert.equal(snapMachineNo('sp78', MAP), 'SP-78');
  assert.equal(snapMachineNo('Lwr306', MAP), 'LWR-306');
});

test('ตรงทะเบียนอยู่แล้ว = ไม่ต้องแก้ (คืน null ไม่ใช่ค่าเดิม)', () => {
  assert.equal(snapMachineNo('LS-10', MAP), null);
});

test('🔴 ห้ามเดาตัวตนเครื่อง — ทับศัพท์/ชื่อย่อ ต้องไม่ถูกแตะ', () => {
  for (const v of ['เลเซอร์04', 'Laser4', 'laser', 'LWR', 'gor', 'ปืนรีเวท', 'SP-99']) {
    assert.equal(snapMachineNo(v, MAP), null, `${v} ต้องไม่ถูกดัด`);
  }
});

test('🔴 คีย์ที่ชี้ได้หลายเครื่อง = กำกวม ต้องไม่แมป', () => {
  const amb = buildMachineKeyMap([{ machine_no: 'A-01' }, { machine_no: 'A-1' }]);
  assert.equal(amb.has('A1'), false);
  assert.equal(snapMachineNo('a1', amb), null);
});

test('ข้อมูลเพี้ยนต้องไม่โยน error', () => {
  for (const v of [null, undefined, '', '   ', 123, {}]) {
    assert.doesNotThrow(() => { machineKey(v); snapMachineNo(v, MAP); });
  }
  assert.equal(snapMachineNo('LS10', null), null);
  assert.equal(buildMachineKeyMap(null).size, 0);
});
