import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCcIndex } from '../ccScope.js';
import { sectionsFromCcs, ccsForSections, effectiveSections } from '../scopePicker.js';

const NODES = [
  { id: 1, kind: 'section',    code: 'PD1', name: 'PD1',        parent_id: null, cost_center: '2140461000' },
  { id: 2, kind: 'department', code: null,  name: 'BIG PRESS',  parent_id: 1,    cost_center: '2140561001' },
  { id: 3, kind: 'line',       code: null,  name: 'LINE A',     parent_id: 2,    cost_center: '2140661101' },
  { id: 5, kind: 'department', code: null,  name: 'Inspection', parent_id: 4,    cost_center: null },        // ตกทอดจาก QA
  { id: 6, kind: 'department', code: null,  name: 'JIG MTN',    parent_id: null, cost_center: '2140481000' }, // แผนกขึ้นตรงฝ่าย
  { id: 7, kind: 'department', code: null,  name: 'NO-CC ROOT', parent_id: null, cost_center: null },
  // ชื่อซ้ำ 2 ชั้นของจริง: แผนกสำนักงาน "QA" ใต้ส่วนงาน "QA" — วางไว้ *ก่อน* section ในลิสต์เพื่อจับบั๊ก .find ตัวแรก
  { id: 8, kind: 'department', code: null,  name: 'QA',         parent_id: 4,    cost_center: '214055654' },
  { id: 4, kind: 'section',    code: null,  name: 'QA',         parent_id: null, cost_center: '2140441000' },
];

test('🔴 ชื่อซ้ำ 2 ชั้น (section QA / department QA) ต้องเลือก section — ไม่งั้นแคบลงเงียบ', () => {
  assert.deepEqual(ccsForSections(idx, NODES, ['QA']).ccs, ['2140441000']);
});
const idx = buildCcIndex(NODES);

test('ติ๊กไลน์/แผนก ⇒ เห็นส่วนงานแม่ (ขึ้นไปถึง section)', () => {
  assert.deepEqual(sectionsFromCcs(idx, ['2140661101']).sections, ['PD1']);
  assert.deepEqual(sectionsFromCcs(idx, ['2140561001', '2140461000']).sections, ['PD1'], 'ซ้ำส่วนงานเดียว = 1 ค่า');
});

test('แผนกขึ้นตรงฝ่าย (ไม่มี section) ใช้ตัวเองเป็นขอบเขต', () => {
  assert.deepEqual(sectionsFromCcs(idx, ['2140481000']).sections, ['JIG MTN']);
});

test('รหัสที่ผังไม่รู้จัก = unknown ไม่เงียบ', () => {
  const r = sectionsFromCcs(idx, ['9999999999']);
  assert.deepEqual(r.sections, []);
  assert.deepEqual(r.unknown, ['9999999999']);
});

test('ค่า sections เดิม → CC ที่ควรติ๊ก · เฉพาะโหนดที่มีรหัสของตัวเอง', () => {
  const r = ccsForSections(idx, NODES, ['PD1', 'qa', 'JIG MTN']);
  assert.deepEqual(r.ccs, ['2140461000', '2140441000', '2140481000']);
  assert.deepEqual(r.unmapped, []);
});

test('🔴 ค่าเดิมที่แปลงไม่ได้ต้องคงไว้ (หน่วยไม่มีรหัส / หายจากผัง / รหัสตกทอด)', () => {
  const r = ccsForSections(idx, NODES, ['NO-CC ROOT', 'หน่วยที่ถูกลบ', 'Inspection']);
  assert.deepEqual(r.ccs, []);
  assert.deepEqual(r.unmapped, ['NO-CC ROOT', 'หน่วยที่ถูกลบ', 'Inspection']);
});

test('🔴 ไม่ติ๊ก CC เลย ⇒ sections เดิมเป๊ะ (บัญชีเก่าไม่เปลี่ยน)', () => {
  assert.deepEqual(effectiveSections(idx, NODES, [], ['PD3', 'หน่วยที่ถูกลบ']), ['PD3', 'หน่วยที่ถูกลบ']);
  assert.deepEqual(effectiveSections(idx, NODES, [], []), []);
});

test('ติ๊กแล้ว ⇒ derive ∪ ค่าเดิมที่แปลงไม่ได้ · ไม่แคบกว่าเดิม', () => {
  const eff = effectiveSections(idx, NODES, ['2140661101'], ['PD1', 'หน่วยที่ถูกลบ']);
  assert.deepEqual(eff.sort(), ['PD1', 'หน่วยที่ถูกลบ'].sort());
  // ค่าเดิมที่ map ได้ (PD1) ไม่ถูกซ้ำ · ค่าที่ map ไม่ได้ยังอยู่
  assert.equal(eff.filter(s => s === 'PD1').length, 1);
});

test('round-trip: sections → CC → sections ได้ชุดเดิม', () => {
  const legacy = ['PD1', 'QA'];
  const { ccs } = ccsForSections(idx, NODES, legacy);
  assert.deepEqual(effectiveSections(idx, NODES, ccs, legacy).sort(), legacy.sort());
});
