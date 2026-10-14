/* กฎเจ้าของทีม — ใครแก้/ลบแถวทะเบียนของช่างได้ (คำสั่ง user 2026-10-14)
   *"ให้เพิ่มได้ แต่จะลบมั่วไม่ได้ … เห็นข้ามกันหมด แต่ลบข้ามกันไม่ได้"* */
import test from 'node:test';
import assert from 'node:assert/strict';
import { teamRowOwnerKeys } from '../mtnTeamOwn.js';

const PD = ['production'];

test('แถวของทีมตัวเอง = แก้/ลบได้ · แถวทีมอื่น = ไม่ได้ (นี่คือข้อที่ user สั่ง)', () => {
  assert.deepEqual(teamRowOwnerKeys('production', PD, 'supervisor'), { ok: true, code: 'own' });
  assert.deepEqual(teamRowOwnerKeys('maintenance', PD, 'supervisor'), { ok: false, code: 'other' });
  assert.deepEqual(teamRowOwnerKeys('die_maintenance', PD, 'supervisor'), { ok: false, code: 'other' });
});

test('🔴 dept_admin (หัวหน้าแผนกผลิต) ลบของทีม MTN ไม่ได้ — เหตุผลที่ทำกฎนี้', () => {
  // dept_admin ถือ mtn_repair:delete ⇒ ด่านสิทธิ์ผ่าน แต่ต้องตกด่านเจ้าของ
  assert.equal(teamRowOwnerKeys('maintenance', PD, 'dept_admin').ok, false);
  assert.equal(teamRowOwnerKeys('production', PD, 'dept_admin').ok, true);
});

test('แถว 🌐 ของกลาง (ไม่มีทีม) = เฉพาะ admin/manager', () => {
  assert.deepEqual(teamRowOwnerKeys('', PD, 'supervisor'), { ok: false, code: 'common' });
  assert.deepEqual(teamRowOwnerKeys(null, PD, 'mtn'), { ok: false, code: 'common' });
  assert.deepEqual(teamRowOwnerKeys('', PD, 'admin'), { ok: true, code: 'boss' });
  assert.deepEqual(teamRowOwnerKeys('', PD, 'manager'), { ok: true, code: 'boss' });
});

test('🔴 fallback: ยังไม่ตั้ง mtn_teams = ไม่ล็อก (ห้ามเปลี่ยนเป็น false — ช่างจะทำอะไรไม่ได้ทั้งระบบ)', () => {
  assert.deepEqual(teamRowOwnerKeys('maintenance', [], 'supervisor'), { ok: true, code: 'unscoped' });
  assert.deepEqual(teamRowOwnerKeys('maintenance', null, 'mtn'), { ok: true, code: 'unscoped' });
  assert.deepEqual(teamRowOwnerKeys('', undefined, 'mtn'), { ok: true, code: 'unscoped' });
});

test('สังกัดหลายทีม = แก้ได้ทุกทีมที่สังกัด · ค่าว่างใน myTeams ไม่นับ', () => {
  const two = ['production', 'maintenance'];
  assert.equal(teamRowOwnerKeys('maintenance', two, 'mtn').ok, true);
  assert.equal(teamRowOwnerKeys('jig_maintenance', two, 'mtn').ok, false);
  assert.deepEqual(teamRowOwnerKeys('maintenance', ['', null], 'mtn'), { ok: true, code: 'unscoped' });
});
