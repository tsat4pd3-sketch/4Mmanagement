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

/* ── 🏷️ ป้ายแผนก = ชื่อจริง · คีย์ = code||name (2026-10-09 · คำสั่ง user) ───────────────
   แผนกซ่อมบำรุงถือตัวย่อไว้ที่ `code` เพื่อให้ทะเบียนอื่น (ตารางกะ · นิยาม KPI · ศูนย์ต้นทุน
   · employees.department) ที่จับคู่ด้วย "ข้อความ" ยังตรง — แต่ **บนจอต้องอ่านว่าชื่อจริง**
   เดิม orgScope ส่ง nodeCode() เป็นป้ายด้วย ⇒ ทุก dropdown/ข้อความขอบเขตโชว์ "MTN" */
const mtnNodes = [
  { id: 'mtn', kind: 'department', code: 'MTN', name: 'Maintenance', parent_id: null, sort_order: 37, is_active: true },
  { id: 'die', kind: 'department', code: 'DIE MTN', name: 'DIE Maintenance', parent_id: null, sort_order: 36, is_active: true },
  { id: 'qa2', kind: 'department', code: null, name: 'QA', parent_id: null, sort_order: 36, is_active: true },
];

test('ป้ายแผนกใช้ชื่อจริง แต่ค่าที่เก็บ/จับคู่ยังเป็นตัวย่อเดิม', () => {
  const ix = buildOrgScope({ nodes: mtnNodes, lines: [] });
  // ป้ายบนจอ = ชื่อจริง (labelOf เติมคำนำหน้าชั้น "แผนก: " อยู่แล้วตามเดิม)
  assert.equal(ix.labelOf('department', 'MTN'), 'แผนก: Maintenance');
  assert.equal(ix.labelOf('department', 'DIE MTN'), 'แผนก: DIE Maintenance');
  // ป้ายดิบที่ dropdown วาด (<option> ใช้ o.label ไม่มีคำนำหน้า)
  assert.equal(ix.optionOf('department', 'MTN').label, 'Maintenance');
  assert.equal(ix.optionOf('department', 'DIE MTN').label, 'DIE Maintenance');
  // 🔴 คีย์ไม่ขยับ — ขอบเขต/นิยาม KPI ที่บันทึกเป็น 'MTN' ต้องยังหาเจอ
  assert.ok(ix.has('department', 'MTN'));
  assert.ok(ix.has('department', 'DIE MTN'));
  assert.equal(ix.optionOf('department', 'MTN').value, 'MTN');
  // ไม่มี code = ป้ายเท่าชื่อเหมือนเดิม (พฤติกรรมเดิมเป๊ะ)
  assert.equal(ix.labelOf('department', 'QA'), 'แผนก: QA');
  assert.equal(ix.optionOf('department', 'QA').label, 'QA');
  assert.ok(ix.has('department', 'QA'));
});
