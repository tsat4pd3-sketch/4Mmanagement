import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkData, validateDef, nextKey, TEMPLATE_4M, FIELD_TYPE_MAP } from '../wfSchema.js';
import { wfFlow } from '../wfFlow.js';

const FORM = { fields: [
  { key: 'cat', type: 'select', label: 'หมวด', required: true, options: ['A', 'B'] },
  { key: 'qty', type: 'number', label: 'จำนวน' },
  { key: 'h', type: 'heading', label: 'หัวข้อ', required: true },
] };

test('checkData — ช่องบังคับ · ตัวเลข · ตัวเลือก · หัวข้อไม่ต้องกรอก (ตรงกับ wf_check_data)', () => {
  assert.equal(checkData(FORM, {}), 'กรุณากรอก: หมวด');
  assert.equal(checkData(FORM, { cat: '  ' }), 'กรุณากรอก: หมวด');
  assert.equal(checkData(FORM, { cat: 'C' }), 'ค่าที่เลือกไม่อยู่ในตัวเลือก: หมวด');
  assert.equal(checkData(FORM, { cat: 'A', qty: '1x' }), 'ต้องเป็นตัวเลข: จำนวน');
  assert.equal(checkData(FORM, { cat: 'A', qty: '-2.5' }), null);
  assert.equal(checkData(FORM, null), 'ข้อมูลฟอร์มไม่ถูกต้อง');
});

test('validateDef — แม่แบบ 4M ผ่าน · ขาดผู้อนุมัติ/ผู้เปิดอนุมัติเอง/role ว่าง = ไม่ผ่าน', () => {
  const ok = { key: 'test_4m', name: 'x', ownerSection: 'PD3', form: TEMPLATE_4M.form, flow: TEMPLATE_4M.flow, startRoles: TEMPLATE_4M.startRoles };
  assert.deepEqual(validateDef(ok), []);
  const bad = validateDef({ ...ok, key: 'Bad-Key', startRoles: [],
    flow: { steps: [{ key: 's1', label: 'x', kind: 'approve', assignee: { rule: 'creator' } }, { key: 's1', label: 'y', assignee: {} }] } });
  assert.ok(bad.some(e => /รหัสใบงาน/.test(e)));
  assert.ok(bad.some(e => /ผู้เปิดใบอนุมัติเองไม่ได้/.test(e)));
  assert.ok(bad.some(e => /ยังไม่ได้ตั้งผู้อนุมัติ/.test(e)));
  assert.ok(bad.some(e => /ซ้ำ/.test(e)));
  assert.ok(bad.some(e => /role/.test(e)));
});

test('แม่แบบ 4M — ช่องคน/เครื่อง/MAT/ไลน์ ใช้ picker กลาง (UI §5.1.2)', () => {
  for (const t of ['person', 'machine', 'mat', 'line']) assert.ok(FIELD_TYPE_MAP[t].picker, t);
  assert.equal(nextKey('f', [{ key: 'f1' }, { key: 'f2' }]), 'f3');
});

test('wfFlow — ยื่นใบ + ขั้นตามนิยาม · กำลังอนุมัติ/ครบ/ตีกลับ/ยกเลิก/ส่งกลับ/ไม่รู้จัก', () => {
  const flow = TEMPLATE_4M.flow;
  const st = (f) => f.steps.map(s => s.state + (s.tone ? '/' + s.tone : ''));
  assert.deepEqual(st(wfFlow({ status: 'in_progress', current_step: 0 }, flow)), ['done', 'current', 'todo']);
  assert.deepEqual(st(wfFlow({ status: 'in_progress', current_step: 1 }, flow)), ['done', 'done', 'current']);
  assert.deepEqual(st(wfFlow({ status: 'approved', current_step: null }, flow)), ['done', 'done', 'done']);
  assert.deepEqual(st(wfFlow({ status: 'rejected', current_step: 1 }, flow)), ['done', 'done', 'done/bad']);
  assert.deepEqual(st(wfFlow({ status: 'cancelled', current_step: 0 }, flow)), ['done', 'done/none', 'todo']);
  assert.deepEqual(st(wfFlow({ status: 'returned', current_step: 1 }, flow)), ['current', 'todo', 'todo']);
  assert.equal(wfFlow({ status: 'weird' }, flow).known, false);
  assert.match(wfFlow({ status: 'in_progress', current_step: 0, blocked_reason: 'ไม่มีใคร' }, flow).waiting, /หาผู้อนุมัติไม่ได้/);
});
