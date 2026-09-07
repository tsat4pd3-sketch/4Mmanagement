import test from 'node:test';
import assert from 'node:assert/strict';
import { personOptions, machineOptions, productOptions, sameName } from '../pickerOptions.js';

/* กฎที่ล็อกไว้ (2026-09-07 · single-source audit):
   1. ของที่ "เกี่ยวข้อง" ขึ้นก่อน แต่ **ไม่ตัดของอื่นทิ้ง** (หยิบข้ามทีม/ไลน์มีจริง) เว้นแต่ strict
   2. ค่าที่เลือกไว้แล้ว (เครื่อง/สินค้าที่ปลดระวาง) ต้องยังอยู่ในลิสต์ ไม่หายเงียบ
   3. คนเดียวกันที่มีทั้ง profile และ employee = แถวเดียว (profile นำ + รหัสพนักงานเข้าคีย์ค้น)
   4. พาร์ทลูก (extraOptions) ไม่ซ้ำกับ Product Master และติดธง extra */

const profiles = [
  { id: 'u1', full_name: 'สมชาย ใจดี', role: 'supervisor', section: 'ASSY', line_id: 3, position: 'supervisor', signature_url: 's.png' },
  { id: 'u2', full_name: 'QA คนที่สอง', role: 'qa', section: 'QA' },
  { id: 'u3', full_name: 'จอ TV', role: 'display' },
];
const employees = [
  { id: 'e1', name: 'สมชาย  ใจดี', employee_id_code: '61001', line_id: 3, section: 'ASSY', position: 'operator' },
  { id: 'e2', name: 'สมหญิง ขยัน', employee_id_code: '61002', line_id: 7, section: 'STAMP', position: 'operator', team: 'B' },
];

test('personOptions: prefer ขึ้นก่อน ไม่ตัดคนอื่น · strict ตัด', () => {
  const o = personOptions({ profiles, employees, source: 'both', section: 'STAMP' });
  assert.equal(o[0].label, 'สมหญิง ขยัน');
  assert.equal(o[0].group, '🎯 ที่เกี่ยวข้อง');
  assert.equal(o.length, 4, '3 profiles + 2 employees − 1 คนซ้ำ (display role กรองที่ loader ไม่ใช่ที่นี่)');
  const s = personOptions({ profiles, employees, source: 'both', section: 'STAMP', strict: true });
  assert.equal(s.length, 1);
});

test('personOptions: profile + employee ชื่อเดียวกัน = แถวเดียว profile นำ + รหัสพนักงานค้นได้', () => {
  const o = personOptions({ profiles, employees, source: 'both' });
  const s = o.filter(x => sameName(x.label, 'สมชาย ใจดี'));
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, 'profile');
  assert.equal(s[0].employee_code, '61001');
  assert.match(s[0].keywords, /61001/);
  assert.equal(s[0].badge, '✍️');
});

test('personOptions: source=employees ไม่ดึง profile', () => {
  const o = personOptions({ profiles, employees, source: 'employees', lineIds: [3] });
  assert.equal(o.length, 2);
  assert.equal(o[0].label, 'สมชาย ใจดี');
  assert.equal(o[0].kind, 'employee');
});

const machines = [
  { id: 'm1', machine_no: 'RB-10', machine_name: 'Robot', line_name: 'ASSY1', equipment_kind: 'machine', is_active: true },
  { id: 'm2', machine_no: 'RB-2', machine_name: 'Robot', line_name: 'ASSY2', equipment_kind: 'machine', is_active: true },
  { id: 'm3', machine_no: 'DIE-01', machine_name: 'Die', line_name: 'LINE A', equipment_kind: 'die', is_active: true },
  { id: 'm4', machine_no: 'OLD-1', machine_name: 'Retired', line_name: 'ASSY1', equipment_kind: 'machine', is_active: false },
];

test('machineOptions: ไลน์ที่เลือกขึ้นก่อน · natural sort · ตัดปลดระวางเว้นค่าที่เลือกอยู่', () => {
  const o = machineOptions(machines, { lines: ['assy2'] });
  assert.equal(o[0].machine_no, 'RB-2');
  assert.deepEqual(o.map(x => x.machine_no), ['RB-2', 'DIE-01', 'RB-10']);
  const keep = machineOptions(machines, { current: 'old-1' });
  assert.ok(keep.some(x => x.machine_no === 'OLD-1' && x.badge === '⏸'));
  const kinds = machineOptions(machines, { kinds: ['die'] });
  assert.deepEqual(kinds.map(x => x.machine_no), ['DIE-01']);
  const strict = machineOptions(machines, { lines: ['ASSY1'], strict: true });
  assert.deepEqual(strict.map(x => x.machine_no), ['RB-10']);
});

const products = [
  { id: 'p1', mat_no: '10100384', name: 'REINF', p_no: 'MB3B-8C306', customer: 'FORD', line_name: 'ASSY1', is_active: true },
  { id: 'p2', mat_no: '10100385', name: 'REINF LH', p_no: 'MB3B-8C307', customer: 'FORD', line_name: 'ASSY2', is_active: true },
  { id: 'p3', mat_no: '10100384-OP10', name: 'OP10', line_name: 'ASSY1', is_active: true, is_operation: true },
  { id: 'p4', mat_no: '99999', name: 'Dead', line_name: 'ASSY1', is_active: false },
];

test('productOptions: ตัด OP เป็น default · prefer ไลน์ · extra ไม่ซ้ำ + ติดธง', () => {
  const o = productOptions(products, { lines: ['ASSY2'], extraOptions: [{ mat_no: '10100384' }, { mat_no: '20066660', name: 'child' }] });
  assert.equal(o[0].mat_no, '10100385');
  assert.ok(!o.some(x => x.mat_no === '10100384-OP10'));
  assert.ok(!o.some(x => x.mat_no === '99999'));
  const ex = o.filter(x => x.extra);
  assert.deepEqual(ex.map(x => x.mat_no), ['20066660']);
  const ops = productOptions(products, { includeOps: true });
  assert.ok(ops.some(x => x.mat_no === '10100384-OP10'));
  const cur = productOptions(products, { current: '99999' });
  assert.ok(cur.some(x => x.mat_no === '99999' && x.badge === '⏸'));
});

import { buildPartOptions, partKey } from '../partOptions.js';
test('buildPartOptions: กุญแจ = part_no (P/N) · รวม 3 แหล่งไม่ซ้ำ · dr_products ใช้ p_no fallback mat_no', () => {
  const o = buildPartOptions({
    sets: [{ part_no: 'MB3B-8C306', part_name: 'REINF', status: 'active' }, { part_no: 'OLD-1', status: 'obsolete' }],
    qaParts: [{ part_no: 'mb3b-8c306', part_name: '', mat_no: '10100384', is_active: true }, { part_no: 'X-9', is_active: false }],
    products: [{ mat_no: '10100385', p_no: 'MB3B-8C307', name: 'LH', is_active: true }, { mat_no: '20000001', name: 'no pn', is_active: true }, { mat_no: 'OP', is_operation: true }],
  });
  assert.deepEqual(o.map(x => x.key), ['MB3B-8C306', 'MB3B-8C307', '20000001']);
  const first = o[0];
  assert.equal(first.part_name, 'REINF');
  assert.equal(first.mat_no, '10100384', 'เติม mat_no จากแหล่งที่สองเมื่อแหล่งแรกไม่มี');
  assert.equal(partKey(' mb3b-8c306 '), 'MB3B-8C306');
});

import { appendHistoryOptions, HISTORY_GROUP } from '../pickerOptions.js';
test('appendHistoryOptions: ค่าที่เคยบันทึก/ค่าปัจจุบันนอกทะเบียนยังเลือกได้ (กลุ่ม 📜) และไม่ซ้ำกับทะเบียน', () => {
  const base = machineOptions(machines, {});
  const o = appendHistoryOptions(base, { history: ['rb-10', 'X-77', ' '], current: 'LEGACY-1', make: (v) => ({ machine_no: v }) });
  const hist = o.filter(x => x.history);
  assert.deepEqual(hist.map(x => x.label), ['X-77', 'LEGACY-1'], 'RB-10 มีในทะเบียนแล้ว ไม่ซ้ำ · ช่องว่างถูกทิ้ง');
  assert.ok(hist.every(x => x.group === HISTORY_GROUP && x.badge));
  assert.equal(hist[1].machine_no, 'LEGACY-1');
  assert.equal(appendHistoryOptions(base, {}), base, 'ไม่มีอะไรเติม = คืน array เดิม');
});
