/* 🔐 ชั้นที่ 3 ของสิทธิ์ — "แถวนี้เป็นของหน่วยงานเราไหม" (2026-10-15 · คำสั่ง user)
 *
 * > *"user เป็น mtn ที่เป็นแค่แอดมินส่วนงาน แต่เข้าไปแก้ KPI ของแผนกอื่นได้ มั่วเลย"*
 *
 * 🔴 กติกาที่ห้าม regress: **"ขอบเขตที่เห็น" ≠ "ขอบเขตที่แก้ได้"**
 *    วัดจริง 15/10: 31 จาก 122 บัญชี `sections` ว่าง (เป็น role mtn 16) เพราะช่างต้องเห็นทุกไลน์
 *    ⇒ ถ้าเอา `sections` มาตัดสินการแก้ = ช่างแก้ได้ทั้งโรงงาน (เคสที่ user แจ้ง)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { canWriteUnit, canWriteLine, writeUnitsOf, hasAllUnits, writableRows, writeBlockText }
  from '../writeScope.js';

const MTN = { role: 'mtn', section: 'JIG MTN', sections: null };          // ช่าง: เห็นทั้งโรงงาน
const SUP = { role: 'supervisor', section: 'PD3', sections: ['PD3'] };
const QA  = { role: 'qa', section: 'QA', sections: null, allUnits: true };

test('🔴 เคสที่ user แจ้ง — ช่างที่ sections ว่าง ต้องแก้ได้แค่บ้านตัวเอง', () => {
  assert.equal(canWriteUnit(MTN, 'JIG MTN').ok, true);
  assert.equal(canWriteUnit(MTN, 'PD3').ok, false);          // ← เดิมผ่าน เพราะ sections ว่าง = ไม่จำกัด
  assert.equal(canWriteUnit(MTN, 'PD3').code, 'other_unit');
});

test('sections ชนะ section เมื่อมีค่า (คนที่ถูกตั้งขอบเขตหลายส่วนงาน)', () => {
  const m = { role: 'manager', section: 'PD1', sections: ['PD1', 'PD2'] };
  assert.deepEqual(writeUnitsOf(m), ['PD1', 'PD2']);
  assert.equal(canWriteUnit(m, 'PD2').ok, true);
  assert.equal(canWriteUnit(m, 'PD4').ok, false);
});

test('คีย์ scope:all_units = ผ่านทุกหน่วย · admin เป็นตาข่ายกันตาย', () => {
  assert.equal(canWriteUnit(QA, 'PD3').code, 'all_units');
  assert.equal(hasAllUnits({ role: 'admin' }), true);        // ไม่มีคีย์ก็ต้องผ่าน
  assert.equal(hasAllUnits({ role: 'mtn' }), false);
});

test('🔴 ไม่รู้บ้านตัวเอง = บล็อก + บอกทางแก้ (ห้ามเงียบ ห้ามปล่อยผ่าน)', () => {
  const r = canWriteUnit({ role: 'supervisor' }, 'PD3');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_home_unit');
  assert.match(writeBlockText(r), /ยังไม่ได้ตั้งส่วนงาน/);
  assert.match(writeBlockText(r), /แอดมิน/);                  // ต้องบอกทางแก้
});

test('🔴 แถวที่ไม่ผูกหน่วยงาน (ทะเบียนกลาง) — default ผ่าน · block ได้เมื่อจอสั่ง', () => {
  assert.equal(canWriteUnit(SUP, null).code, 'unknown_target');
  assert.equal(canWriteUnit(SUP, '', { unknownTarget: 'block' }).ok, false);
  // ของกลางห้ามล็อกทั้งโรงงานโดยไม่ตั้งใจ — default ต้องเป็น allow
  assert.equal(canWriteUnit(SUP, '').ok, true);
});

test('canWriteLine: ไลน์ที่ไม่อยู่ในทะเบียน = ไม่รู้เจ้าของ ไม่ใช่ "ของเรา"', () => {
  const lines = [{ name: 'Assy 060', section: 'PD3' }, { name: 'Weld 101', section: 'PD1' }];
  assert.equal(canWriteLine(SUP, 'Assy 060', lines).ok, true);
  assert.equal(canWriteLine(SUP, 'Weld 101', lines).ok, false);
  assert.equal(canWriteLine(SUP, 'ไลน์ที่ไม่มีในทะเบียน', lines).code, 'unknown_target');
  assert.equal(canWriteLine(SUP, 'ไลน์ที่ไม่มีในทะเบียน', lines, { unknownTarget: 'block' }).ok, false);
});

test('เทียบชื่อแบบ normalize (ช่องว่าง/ตัวพิมพ์) — section เป็น text พิมพ์มือ', () => {
  assert.equal(canWriteUnit(SUP, ' pd3 ').ok, true);
});

test('writableRows: กรองลิสต์ได้ · ถือ all_units = ไม่กรองเลย', () => {
  const rows = [{ s: 'PD3' }, { s: 'PD1' }, { s: null }];
  assert.equal(writableRows(SUP, rows, r => r.s).length, 2);   // PD3 + แถวไม่ผูกหน่วย
  assert.equal(writableRows(QA, rows, r => r.s).length, 3);
});
