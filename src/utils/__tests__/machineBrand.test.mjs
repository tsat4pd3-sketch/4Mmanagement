/* ยี่ห้อเครื่อง (20/10) — จับจากคำขึ้นต้นเท่านั้น ห้ามเดาจากชื่อรุ่น */
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestBrand, normalizeBrand, brandProposals } from '../machineBrand.js';

test('จับยี่ห้อจากคำขึ้นต้น · MOTOMAN = YASKAWA', () => {
  assert.equal(suggestBrand('ABB IRB6700'), 'ABB');
  assert.equal(suggestBrand('Yaskawa ES165D'), 'YASKAWA');
  assert.equal(suggestBrand('MOTOMAN-ES165D'), 'YASKAWA');
  assert.equal(suggestBrand('  denyo  spot'), 'DENYO');
});

test('ไม่เดาจากชื่อรุ่น/สะกดเพี้ยน — ว่าง = null', () => {
  assert.equal(suggestBrand('TRULASER 3030'), null);
  assert.equal(suggestBrand('STANLY drill'), null);
  assert.equal(suggestBrand(''), null);
  assert.equal(suggestBrand(null), null);
  assert.equal(suggestBrand('CO2 Welder'), null);
});

test('ยี่ห้อที่บันทึกแล้วในทะเบียน ใช้จับต่อได้', () => {
  assert.equal(suggestBrand('Trumpf TruLaser', ['trumpf']), 'TRUMPF');
});

test('normalize + ข้อเสนอเฉพาะแถวที่ยังไม่มียี่ห้อ', () => {
  assert.equal(normalizeBrand('  abb  robotics '), 'ABB ROBOTICS');
  assert.equal(normalizeBrand(' '), null);
  const p = brandProposals([
    { id: 1, machine_name: 'ABB IRB', brand: null },
    { id: 2, machine_name: 'ABB IRB', brand: 'ABB' },
    { id: 3, machine_name: 'CO2 Welder', brand: '' },
  ]);
  assert.deepEqual(p.map(x => [x.m.id, x.brand]), [[1, 'ABB']]);
});
