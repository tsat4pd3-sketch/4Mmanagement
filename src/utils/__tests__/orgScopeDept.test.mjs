/* แผนก (org department) → ชุดไลน์ — ฐานของการเลือก "ระดับแผนก" ในหน้า OEE/รายงาน (2026-10-02)
   ข้อมูล = org_nodes + production_lines จริง (MAIN · 02/10/2026) ย่อเหลือ PD1 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgScope } from '../orgScope.js';

const nodes = [
  { id: 'pd1', kind: 'section', code: 'PD1', name: 'PD1', parent_id: null, division: 'production', sort_order: 1, is_active: true },
  { id: 'big', kind: 'department', code: null, name: 'BIG PRESS', parent_id: 'pd1', sort_order: 43, is_active: true },
  { id: 'small', kind: 'department', code: null, name: 'SMALL PRESS', parent_id: 'pd1', sort_order: 44, is_active: true },
  { id: 'la', kind: 'line', name: 'LINE A ( 800 Ton )', parent_id: 'big', ref_line_id: 17, sort_order: 45, is_active: true },
  { id: 'lb', kind: 'line', name: 'LINE B ( 600 Ton )', parent_id: 'big', ref_line_id: 18, sort_order: 46, is_active: true },
  { id: 'lc', kind: 'line', name: 'LINE C ( 250 Ton )', parent_id: 'small', ref_line_id: 19, sort_order: 47, is_active: true },
  { id: 'qa', kind: 'department', code: null, name: 'QA', parent_id: null, division: 'quality', sort_order: 36, is_active: true },
];
const lines = [
  { id: 17, name: 'LINE A ( 800 Ton )', section: 'PD1', parent_line_name: null, is_active: true },
  { id: 18, name: 'LINE B ( 600 Ton )', section: 'PD1', parent_line_name: null, is_active: true },
  { id: 19, name: 'LINE C ( 200&250 Ton )', section: 'PD1', parent_line_name: null, is_active: true },
  { id: 21, name: 'Rework - PD1', section: 'PD1', parent_line_name: null, is_active: true },
];

test('แผนก BIG PRESS = LINE A + LINE B (ผูกด้วย ref_line_id ไม่ใช่ชื่อ)', () => {
  const ix = buildOrgScope({ nodes, lines });
  assert.deepEqual(ix.lineNamesOf('department', 'BIG PRESS').sort(), ['LINE A ( 800 Ton )', 'LINE B ( 600 Ton )']);
  // ชื่อในผังเขียนต่างจากทะเบียน (LINE C ( 250 Ton ) vs 200&250) ก็ยังได้ไลน์จริงจาก ref_line_id
  assert.deepEqual(ix.lineNamesOf('department', 'SMALL PRESS'), ['LINE C ( 200&250 Ton )']);
});

test('แผนกที่ไม่มีไลน์ผลิต (QA) = ชุดว่าง — หน้าต้องโชว์ว่าง ไม่ใช่ทั้งโรงงาน', () => {
  const ix = buildOrgScope({ nodes, lines });
  assert.deepEqual(ix.lineNamesOf('department', 'QA'), []);
});
