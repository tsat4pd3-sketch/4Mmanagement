/* 🗂️ laborTypeOfNode — "ของใต้หน่วยนี้เป็นสายผลิตหรือสนับสนุน"        2026-09-24
 *
 * ที่มา (feedback user): *"ลูกของ indirect ไม่น่าต้องเลือกไลน์ผลิตนะ"*
 * เคสจริง: กลุ่ม `Store Semi` ใต้ `PLN & STO › STORE` (indirect ทั้งคู่) แต่ฟอร์มแก้ไขกลุ่ม
 * ยังถาม "ผูกกับไลน์ผลิตจริง (production_lines)" ซึ่งหน่วยงานสโตร์ตอบไม่ได้
 *
 * 🔴 กลุ่ม (kind='line') **ไม่มีคอลัมน์ `labor_type` ของตัวเอง** — ตั้งได้แค่ระดับ
 *    section/department ⇒ ต้องไต่ขึ้นหาแม่ ห้ามอ่านจากตัวโหนดตรงๆ แล้วสรุปว่า "ไม่ได้ตั้ง"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laborTypeOfNode } from '../laborType.js';

/* ผังย่อจากของจริง (ตรวจกับฐาน 24/09): PLN & STO(indirect) › STORE(indirect) › Store Semi(ไม่ตั้ง) */
const NODES = [
  { id: 'sec-pln', kind: 'section',    name: 'PLN & STO', parent_id: null,      labor_type: 'indirect' },
  { id: 'dep-sto', kind: 'department', name: 'STORE',     parent_id: 'sec-pln', labor_type: 'indirect' },
  { id: 'grp-semi', kind: 'line',      name: 'Store Semi', parent_id: 'dep-sto', labor_type: null },
  { id: 'sec-pd3', kind: 'section',    name: 'PD3',       parent_id: null,      labor_type: 'direct' },
  { id: 'dep-hdf', kind: 'department', name: 'HYDROFORM', parent_id: 'sec-pd3', labor_type: null },
  { id: 'grp-h1',  kind: 'line',       name: 'HDF1',      parent_id: 'dep-hdf', labor_type: null },
  { id: 'lost',    kind: 'line',       name: 'ลอยๆ',      parent_id: null,      labor_type: null },
];

test('กลุ่มตกทอดประเภทจากแผนกแม่ (ไม่มีคอลัมน์ของตัวเอง)', () => {
  assert.equal(laborTypeOfNode('grp-semi', NODES), 'indirect', 'Store Semi ← STORE');
});

test('ไต่ข้ามชั้นที่ไม่ได้ตั้งค่า ขึ้นไปถึงส่วนงาน', () => {
  // HYDROFORM ไม่ได้ตั้ง labor_type ⇒ ต้องข้ามขึ้นไปเอาของ PD3
  assert.equal(laborTypeOfNode('grp-h1', NODES), 'direct');
  assert.equal(laborTypeOfNode('dep-hdf', NODES), 'direct');
});

test('ไม่มีบรรพบุรุษตัวไหนตั้งไว้ = null (ห้ามเดาแทน)', () => {
  assert.equal(laborTypeOfNode('lost', NODES), null,
    'เดาแทน = ซ่อน/โชว์ช่องผิดโดยที่คนตั้งค่าไม่รู้ว่าระบบเดาให้');
  assert.equal(laborTypeOfNode('ไม่มีโหนดนี้', NODES), null);
  assert.equal(laborTypeOfNode(null, NODES), null);
});

test('ผังที่ parent วนกลับมาหาตัวเอง ต้องไม่ค้างลูป', () => {
  const cyclic = [
    { id: 'a', parent_id: 'b', labor_type: null },
    { id: 'b', parent_id: 'a', labor_type: null },
  ];
  assert.equal(laborTypeOfNode('a', cyclic), null);   // ต้องคืนค่า ไม่ใช่แขวนค้าง
});
