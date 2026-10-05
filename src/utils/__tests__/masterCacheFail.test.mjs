import test from 'node:test';
import assert from 'node:assert/strict';
import { mrows, MasterLoadError } from '../masterCache.js';
import { ROLE_OPTIONS, PERMISSION_COLUMN_ROLES, ROLE_META, roleLabel } from '../roleMeta.js';

/* ═══ mrows — แยก "ว่างจริง" ออกจาก "โหลดไม่สำเร็จ" ═══════════════════════════
   เคส 30/09: `.data || []` ทำให้คิวรีล้มกลายเป็นลิสต์ว่าง แล้วถูก cache ทับ 4 ชม. เงียบๆ  */

test('สำเร็จ → คืนแถว · data = null แต่ไม่มี error → []', () => {
  assert.deepEqual(mrows({ data: [{ id: 1 }], error: null }), [{ id: 1 }]);
  assert.deepEqual(mrows({ data: null, error: null }), []);
  assert.deepEqual(mrows({ data: [], error: null }), []);
});

test('🔴 error จากเน็ต/RLS/timeout ต้องโยน ห้ามกลายเป็น []', () => {
  for (const code of ['PGRST301', '500', 'ECONNRESET', undefined]) {
    assert.throws(
      () => mrows({ data: null, error: { code, message: 'เน็ตสะดุด' } }),
      MasterLoadError,
      `code ${code} ต้องโยน — ไม่งั้นลิสต์ว่างถูก cache ทับของดี`,
    );
  }
});

test('ข้อยกเว้นเดียว: ตาราง/คอลัมน์ยังไม่มี (migration ยังไม่ apply) → [] ตามเดิม', () => {
  assert.deepEqual(mrows({ error: { code: '42P01', message: 'relation does not exist' } }), []);
  assert.deepEqual(mrows({ error: { code: '42703', message: 'column does not exist' } }), []);
});

test('ค่าที่ไม่ใช่ผลคิวรี (undefined/null) ต้องไม่พัง', () => {
  assert.deepEqual(mrows(undefined), []);
  assert.deepEqual(mrows(null), []);
});

/* ═══ ธง retired ต้องมีคนอ่าน ═══════════════════════════════════════════════
   เขียนธงไว้ตอนปลด `sale` (23/09) แต่ไม่มีใครอ่าน ⇒ ยังโผล่ใน /permissions
   และยังตั้งให้ user ใหม่ได้ ทั้งที่คอมเมนต์ห้ามไว้                                */

test('🔴 role ที่ retired ต้องหายจากลิสต์เลือก role และคอลัมน์ /permissions', () => {
  const retired = Object.entries(ROLE_META).filter(([, m]) => m.retired).map(([k]) => k);
  assert.ok(retired.length > 0, 'ทะเบียนต้องมี role ที่ retired อย่างน้อย 1 ตัว (sale) ไม่งั้นเทสนี้ไม่ได้ตรวจอะไร');
  for (const r of retired) {
    assert.ok(!ROLE_OPTIONS.some(o => o.value === r), `${r} ยังตั้งให้ user ใหม่ได้`);
    assert.ok(!PERMISSION_COLUMN_ROLES.some(o => o.value === r), `${r} ยังเป็นคอลัมน์ใน /permissions`);
  }
});

test('🔴 แต่ roleLabel ต้องยังอ่าน role ที่ retired ออก (ประวัติเก่า/audit log)', () => {
  for (const [r, m] of Object.entries(ROLE_META).filter(([, m]) => m.retired)) {
    const label = roleLabel(r);
    assert.notEqual(label, r, `roleLabel('${r}') คืนคีย์ดิบ = ใบเก่าอ่านไม่ออก`);
    assert.ok(label.includes(m.label), `roleLabel('${r}') ต้องมีชื่อเต็มจากทะเบียน`);
  }
});

test('role ที่ยังใช้งานอยู่ต้องไม่ถูกตัดทิ้งไปด้วย', () => {
  for (const live of ['admin', 'supervisor', 'manager', 'qa', 'planner_store']) {
    assert.ok(PERMISSION_COLUMN_ROLES.some(o => o.value === live), `${live} หายจากคอลัมน์ /permissions`);
  }
});
