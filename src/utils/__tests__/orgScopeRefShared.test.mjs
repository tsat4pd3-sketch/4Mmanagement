/* 🔗 ผังองค์กรกับทะเบียนไลน์เป็น **2 แกนคนละเรื่อง แค่ ref กัน** (user ยืนยัน 06/10)
   ⇒ 1 โหนดผังครอบไลน์ย่อยหลายไลน์ได้ · หลายหน่วยชี้ไลน์กายภาพตัวเดียวกันได้ **ตามปกติ ไม่ใช่ผูกผิด**
   แต่ตัวเลขผลิตเกาะอยู่กับ "ไลน์" ⇒ หน่วยที่ใช้ไลน์ร่วมกันได้เลขชุดเดียวกันเป๊ะ **แยกตามหน่วยไม่ได้**
   เคสจริง MAIN 06/10: Assembly Line A1/B1/C1 ชี้ ref_line_id 12 ทั้ง 3 ตัว ⇒ 4 แผนก PD2 ครอบไลน์ชุดเดียวกัน
   ⇒ โค้ดต้องติดธง `refShared` ให้จอเขียนบอกว่า "ใช้ไลน์ร่วมกับหน่วยอื่น" — ห้ามเงียบ ห้ามหาว่าข้อมูลผิด */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgScope } from '../orgScope.js';

const NODES = [
  { id: 'PD2', kind: 'section', code: 'PD2', name: 'PD2', parent_id: null },
  { id: 'dA', kind: 'department', code: 'Assy A', name: 'Assy A', parent_id: 'PD2', sort_order: 1 },
  { id: 'dB', kind: 'department', code: 'Assy B', name: 'Assy B', parent_id: 'PD2', sort_order: 2 },
  { id: 'dD', kind: 'department', code: 'Assy D', name: 'Assy D', parent_id: 'PD2', sort_order: 3 },
  // A1 กับ B1 ใช้ไลน์กายภาพเดียวกัน (id 12) แต่คนละแผนก = เลขแยกไม่ได้ ต้องเขียนบอก
  { id: 'nA1', kind: 'line', code: 'A1', name: 'A1', parent_id: 'dA', ref_line_id: 12 },
  { id: 'nB1', kind: 'line', code: 'B1', name: 'B1', parent_id: 'dB', ref_line_id: 12 },
  // D1 กับ D2 ชี้ไลน์เดียวกัน (id 9) แต่อยู่แผนกเดียวกัน = ไม่เข้าข่าย
  { id: 'nD1', kind: 'line', code: 'D1', name: 'D1', parent_id: 'dD', ref_line_id: 9 },
  { id: 'nD2', kind: 'line', code: 'D2', name: 'D2', parent_id: 'dD', ref_line_id: 9 },
];
const LINES = [
  { id: 9, name: 'ASSEMBLY 1', section: 'PD2', parent_line_name: null },
  { id: 12, name: 'SPARE PART', section: 'PD2', parent_line_name: 'ASSEMBLY 1' },
];
const optOf = (idx, kind, value) => idx.options.find(o => o.kind === kind && o.value === value);

test('refShared: แผนกที่ใช้ไลน์ร่วมกับแผนกอื่น ต้องติดธงพร้อมชื่อโหนดที่ใช้ร่วม', () => {
  const idx = buildOrgScope({ nodes: NODES, lines: LINES });
  assert.deepEqual(optOf(idx, 'department', 'Assy A').refShared, ['A1']);
  assert.deepEqual(optOf(idx, 'department', 'Assy B').refShared, ['B1']);
});

test('refShared: ชี้ไลน์เดียวกันแต่อยู่แผนกเดียวกัน = ไม่ติดธง (ชุดไลน์ของแผนกยังถูก)', () => {
  const idx = buildOrgScope({ nodes: NODES, lines: LINES });
  assert.equal(optOf(idx, 'department', 'Assy D').refShared, undefined,
    'ยุบเป็นกลุ่มเดียวในบ้านตัวเอง ไม่ได้ไปใช้ร่วมกับหน่วยอื่น');
});

test('refShared: หน่วยที่มีไลน์ของตัวเอง (ref ไม่ซ้ำ) ต้องไม่มีธงเลย — ห้ามเตือนหมาหอน', () => {
  const ok = buildOrgScope({
    nodes: [
      { id: 'PD2', kind: 'section', code: 'PD2', name: 'PD2', parent_id: null },
      { id: 'dA', kind: 'department', code: 'Assy A', name: 'Assy A', parent_id: 'PD2' },
      { id: 'dB', kind: 'department', code: 'Assy B', name: 'Assy B', parent_id: 'PD2' },
      { id: 'nA', kind: 'line', code: 'A', name: 'A', parent_id: 'dA', ref_line_id: 9 },
      { id: 'nB', kind: 'line', code: 'B', name: 'B', parent_id: 'dB', ref_line_id: 12 },
    ],
    lines: [
      { id: 9, name: 'LINE A', section: 'PD2', parent_line_name: null },
      { id: 12, name: 'LINE B', section: 'PD2', parent_line_name: null },
    ],
  });
  assert.ok(ok.options.filter(o => o.refShared).length === 0);
});

test('refShared: โหนดไลน์ที่ไม่ผูกไลน์ผลิต (ref null) หลายตัว ต้องไม่ถูกนับว่าซ้ำกัน', () => {
  const idx = buildOrgScope({
    nodes: [
      { id: 'PD2', kind: 'section', code: 'PD2', name: 'PD2', parent_id: null },
      { id: 'dA', kind: 'department', code: 'Assy A', name: 'Assy A', parent_id: 'PD2' },
      { id: 'dB', kind: 'department', code: 'Assy B', name: 'Assy B', parent_id: 'PD2' },
      { id: 'nA', kind: 'line', code: 'Store 1', name: 'Store 1', parent_id: 'dA', ref_line_id: null },
      { id: 'nB', kind: 'line', code: 'Store 2', name: 'Store 2', parent_id: 'dB', ref_line_id: null },
    ],
    lines: LINES,
  });
  assert.equal(optOf(idx, 'department', 'Assy A').refShared, undefined);
  assert.equal(optOf(idx, 'department', 'Assy B').refShared, undefined);
});
