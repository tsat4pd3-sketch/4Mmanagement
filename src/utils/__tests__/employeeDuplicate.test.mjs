import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateEmployeeText, isDuplicateEmployeeError, findEmployeeByCode, EMPLOYEE_LOOKUP_COLUMNS } from '../employeeIdentity.js';

/* 🔁 รหัสพนักงานซ้ำต้องตอบเป็น "ใคร · อยู่ไหน · สถานะ · แก้ที่ไหน" (09/11 — PD2 เพิ่ม 3 คนที่มีอยู่แล้วแต่มองไม่เห็น) */

test('duplicateEmployeeText — คนที่ยังใช้งาน อยู่นอกขอบเขตผู้ดู ⇒ บอกว่าอยู่นอกขอบเขต + ให้ admin ย้าย', () => {
  const t = duplicateEmployeeText(
    { employee_id_code: '2103622', name: 'เจนนิภา เจริญพันธ์', section: null, department: null, staff_kind: 'support', is_active: true },
    { code: '2103622', scopeSecs: ['PD2'] },
  );
  assert.match(t, /2103622/); assert.match(t, /เจนนิภา/); assert.match(t, /สายสนับสนุน/);
  assert.match(t, /ยังไม่ระบุส่วนงาน/); assert.match(t, /ใช้งานอยู่/);
  assert.match(t, /นอกขอบเขต/); assert.match(t, /\/operator/);
  assert.doesNotMatch(t, /constraint|duplicate key/i, 'ห้ามพ่นชื่อ constraint ให้คนอ่าน');
});

test('duplicateEmployeeText — คนที่ถูกปิดใช้งาน ⇒ ชี้ให้เปิดกลับ ไม่ใช่เพิ่มใหม่', () => {
  const t = duplicateEmployeeText(
    { employee_id_code: '2103793', name: 'ขันทอง ยอดไธสง', section: 'PD1', department: null, staff_kind: 'support', is_active: false },
    { code: '2103793', scopeSecs: ['PD2'] },
  );
  assert.match(t, /ถูกปิดใช้งานอยู่/); assert.match(t, /เปิดใช้งานกลับ/); assert.match(t, /ส่วน PD1/);
});

test('duplicateEmployeeText — อยู่ในขอบเขตแล้ว ⇒ ให้แก้ของเดิม · ผู้ดูเห็นทั้งโรงงาน ([]) ไม่ถือว่านอกขอบเขต', () => {
  const row = { employee_id_code: 'X1', name: 'ก', section: 'PD2', staff_kind: 'shopfloor', is_active: true };
  assert.match(duplicateEmployeeText(row, { code: 'X1', scopeSecs: ['PD2'] }), /แก้ข้อมูลเดิมที่ \/operator/);
  assert.match(duplicateEmployeeText(row, { code: 'X1', scopeSecs: [] }), /แก้ข้อมูลเดิมที่ \/operator/);
  assert.match(duplicateEmployeeText(row, { code: 'X1' }), /หน้างาน/);
});

test('duplicateEmployeeText — อ่านแถวไม่ได้ (null) ⇒ ยังบอกว่าซ้ำ + ห้ามเพิ่มซ้ำ ไม่เงียบ', () => {
  const t = duplicateEmployeeText(null, { code: '999' });
  assert.match(t, /999/); assert.match(t, /มีอยู่ในฐานพนักงานแล้ว/); assert.match(t, /ห้ามเพิ่มซ้ำ/);
});

test('isDuplicateEmployeeError — 23505 หรือชื่อ unique ของรหัสพนักงาน · อย่างอื่นไม่ใช่', () => {
  assert.equal(isDuplicateEmployeeError({ code: '23505', message: 'x' }), true);
  assert.equal(isDuplicateEmployeeError({ message: 'duplicate key value violates unique constraint "employees_employee_id_code_key"' }), true);
  assert.equal(isDuplicateEmployeeError({ code: '42501', message: 'rls' }), false);
  assert.equal(isDuplicateEmployeeError(null), false);
});

test('findEmployeeByCode — ตัดช่องว่าง · เทียบไม่สนตัวพิมพ์ · error ต้องส่งต่อ ห้ามตีเป็น "ไม่มี"', async () => {
  const calls = [];
  const mk = (data, error = null) => ({
    from: (t) => ({ select: (cols) => ({ ilike: (col, v) => ({ limit: async () => { calls.push({ t, cols, col, v }); return { data, error }; } }) }) }),
  });
  const r1 = await findEmployeeByCode(mk([{ employee_id_code: 'ab12', name: 'ก' }]), '  AB12 ');
  assert.equal(r1.row?.name, 'ก'); assert.equal(r1.error, null);
  assert.equal(calls[0].v, 'AB12'); assert.equal(calls[0].cols, EMPLOYEE_LOOKUP_COLUMNS);
  const r2 = await findEmployeeByCode(mk(null, { message: 'boom' }), 'X');
  assert.equal(r2.row, null); assert.equal(r2.error?.message, 'boom');
  const r3 = await findEmployeeByCode(mk([]), '   ');
  assert.equal(r3.row, null); assert.equal(calls.length, 2, 'รหัสว่างไม่ยิงคิวรี');
});
