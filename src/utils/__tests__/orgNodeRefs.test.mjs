/* กฎการจับคู่ "โหนดผังองค์กร ↔ ทะเบียนอื่น" — ที่พลาดแล้วข้อมูลคนหายเงียบ (2026-10-05) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  orgRefValues, otherNodesWithSameValue, orgRefKeyChange,
  orgRefBlockMessage, orgRefDeleteNote, orgRefDeactivateNote,
} from '../orgNodeRefs.js';

const N = (o) => ({ id: o.id || 'x', kind: 'team', name: '', code: null, is_active: true, ...o });

test('คีย์จับคู่: ส่วนงาน/แผนก/ทีม = code||name · กลุ่ม = ชื่อ (ไม่ใช่เลขไลน์)', () => {
  // ทีมในผังชื่อ "Team A" แต่ employees.team = 'A' ⇒ ต้องได้ code
  assert.deepEqual(orgRefValues(N({ kind: 'team', name: 'Team A', code: 'A' })), ['A']);
  assert.deepEqual(orgRefValues(N({ kind: 'section', name: 'PLN & STO', code: 'Planning&Store' })), ['Planning&Store']);
  assert.deepEqual(orgRefValues(N({ kind: 'department', name: 'DIE MTN', code: null })), ['DIE MTN']);
  // กลุ่ม: code เป็นเลขไลน์ '9' ⇒ ชื่อต้องมาก่อน (operator.jsx เก็บชื่อกลุ่ม)
  assert.deepEqual(orgRefValues(N({ kind: 'line', name: 'APRON ASSY', code: '9' })), ['APRON ASSY', '9']);
  assert.deepEqual(orgRefValues(null), []);
});

test('โหนด active ตัวอื่นถือคีย์เดียวกัน = ชื่อไม่กำพร้า (ทีม A/B/C มีชุดละกลุ่ม)', () => {
  const a1 = N({ id: '1', name: 'Team A', code: 'A' });
  const a2 = N({ id: '2', name: 'Team A', code: 'A' });
  const b  = N({ id: '3', name: 'Team B', code: 'B' });
  assert.equal(otherNodesWithSameValue(a1, [a1, a2, b]).length, 1);
  assert.equal(otherNodesWithSameValue(a1, [a1, b]).length, 0);
  // ปิดใช้งานแล้วไม่นับ — dropdown กรอง is_active ออกไปแล้ว
  assert.equal(otherNodesWithSameValue(a1, [a1, { ...a2, is_active: false }]).length, 0);
  // ชั้นต่างกันไม่ใช่คีย์เดียวกัน
  assert.equal(otherNodesWithSameValue(a1, [a1, N({ id: '4', kind: 'line', name: 'A' })]).length, 0);
});

test('เปลี่ยน code แล้วคีย์เปลี่ยน · เปลี่ยนแค่ชื่อขณะมี code = คีย์เดิม', () => {
  const t = N({ kind: 'team', name: 'Team A', code: 'A' });
  assert.equal(orgRefKeyChange(t, 'ทีมเช้า', 'A'), null);           // code เดิม = ทะเบียนยังจับคู่ได้
  assert.deepEqual(orgRefKeyChange(t, 'Team A', 'A1'), { from: 'A', to: 'A1' });
  const g = N({ kind: 'line', name: 'APRON ASSY', code: null });
  assert.deepEqual(orgRefKeyChange(g, 'APRON ASSY 2', null), { from: 'APRON ASSY', to: 'APRON ASSY 2' });
});

test('นับไม่ครบ (partial) = บล็อกการลบ ห้ามปล่อยผ่านเพราะนับได้ 0', () => {
  const node = N({ kind: 'department', name: 'DIE MTN' });
  const msg = orgRefBlockMessage(node, { partial: true, values: ['DIE MTN'], sharedWith: [] });
  assert.match(msg, /ยังไม่ลบ/);
});

test('มีคนสังกัดด้วย org_node_id = บล็อก และบอกจำนวน', () => {
  const node = N({ kind: 'department', name: 'DIE MTN' });
  const msg = orgRefBlockMessage(node, { empId: 9, profId: 1, heads: 0, textEmp: 9, textProf: 0, values: ['DIE MTN'], sharedWith: [] });
  assert.match(msg, /พนักงาน 9 คน/);
  assert.match(msg, /บัญชีผู้ใช้ 1 รายการ/);
  assert.match(msg, /ปิดใช้งาน/);
});

test('สำเนาชื่อกำพร้าก็บล็อก — แต่ถ้ามีโหนดอื่นถือคีย์เดียวกัน ลบได้', () => {
  const g = N({ kind: 'line', name: 'APRON ASSY' });
  const orphan = { empId: 0, profId: 0, heads: 0, textEmp: 35, textProf: 0, values: ['APRON ASSY'], sharedWith: [] };
  assert.match(orgRefBlockMessage(g, orphan), /35 คนยังเขียน/);
  const shared = { ...orphan, sharedWith: [N({ id: 'z' })] };
  assert.equal(orgRefBlockMessage(g, shared), null);
  assert.match(orgRefDeleteNote(shared), /ยังมีโหนดอื่นถืออยู่/);
});

test('ของที่จะหายไปด้วยต้องเขียนใน confirm (การแต่งตั้งหัวหน้า = cascade)', () => {
  assert.match(orgRefDeleteNote({ heads: 4, sharedWith: [], values: [] }), /หัวหน้าหน่วยนี้ 4 รายการจะถูกลบ/);
  assert.equal(orgRefDeleteNote({ heads: 0, sharedWith: [], values: [] }), '');
});

test('ปิดใช้งาน: คนเดียวกันถูกนับ 2 ทาง ต้องไม่บวกกัน', () => {
  const note = orgRefDeactivateNote({ empId: 9, textEmp: 9, profId: 0 });
  assert.match(note, /พนักงาน 9 คน/);          // ไม่ใช่ 18
  assert.equal(orgRefDeactivateNote({ empId: 0, textEmp: 0, profId: 0 }), '');
  assert.equal(orgRefDeactivateNote({ partial: true, empId: 9 }), '');
});
