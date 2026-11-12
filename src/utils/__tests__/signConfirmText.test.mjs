/* ของกลาง "ยืนยันก่อนเซ็น/อนุมัติ" — ใช้ทั้งใบ MO และคิวอนุมัติ 4M (ขยาย 02/11)
   ข้อความต้องบอกครบ 3 อย่างเสมอ: อนุมัติอะไร · ใบไหน · ในนามใคร */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signConfirmText, confirmSign, needsSignConfirm, SIGN_STAGES } from '../signConfirm.js';

test('บอกครบ 3 อย่าง — อนุมัติอะไร · ใบไหน · ในนามใคร', () => {
  const t = signConfirmText({ what: 'ขั้น 4: ตรวจรับงานหลังซ่อม', orderNo: 'O-PD.2026/11-01', actor: 'สมชาย', as: 'หัวหน้าแผนกผู้แจ้ง' });
  assert.match(t, /ขั้น 4: ตรวจรับงานหลังซ่อม/);
  assert.match(t, /O-PD\.2026\/11-01/);
  assert.match(t, /สมชาย/);
  assert.match(t, /หัวหน้าแผนกผู้แจ้ง/);
  assert.match(t, /แก้เองไม่ได้/);
});

test('📄 docLabel เปลี่ยนคำเรียกเอกสารได้ — default = "ใบ"', () => {
  assert.match(signConfirmText({ orderNo: 'X' }), /^.*\nใบ: X$/m);
  assert.match(signConfirmText({ orderNo: 'ปรับคน · HDF1', docLabel: 'ใบ 4M' }), /ใบ 4M: ปรับคน · HDF1/);
});

test('ผลที่จะเกิด — ใส่ก็โชว์ ไม่ใส่ก็ไม่มีบรรทัดเปล่า', () => {
  assert.match(signConfirmText({ orderNo: 'A', effect: 'ส่งต่อให้ QA ตรวจ' }), /ผลที่จะเกิด: ส่งต่อให้ QA ตรวจ/);
  assert.ok(!/ผลที่จะเกิด/.test(signConfirmText({ orderNo: 'A' })));
});

test('🔴 ข้อมูลไม่ครบ ต้องไม่พ่นบรรทัด "undefined" ออกจอ', () => {
  const t = signConfirmText({});
  assert.ok(!/undefined|null/.test(t), t);
  assert.match(t, /ยืนยันเซ็น/);
});

test('confirmSign: กดตกลง = true · กดยกเลิก = false', () => {
  assert.equal(confirmSign({ orderNo: 'A' }, () => true), true);
  assert.equal(confirmSign({ orderNo: 'A' }, () => false), false);
});

test('🔴 ไม่มี window (เทส/SSR) = ไม่ขวางการทำงาน', () => {
  assert.equal(confirmSign({ orderNo: 'A' }), true);
});

test('warn — จังหวะที่ของจริงแก้ได้ ต้องเปลี่ยนบรรทัดเตือนท้ายได้ (คำเตือนที่ไม่จริง = คนเลิกอ่าน)', () => {
  const def = signConfirmText({ what: 'x', orderNo: 'MO-1', actor: 'ก', as: 'หัวหน้า' });
  assert.ok(def.includes('เซ็นแล้วแก้เองไม่ได้'), 'ไม่ส่ง warn = ข้อความ one-way เดิมต้องไม่เปลี่ยน');
  const bin = signConfirmText({ what: 'ผลพิจารณา', orderNo: 'พาร์ท A · 2026-11-08',
    actor: 'ข', as: 'ผู้พิจารณา', warn: '⚠️ แก้ย้อนหลังได้ที่ทะเบียน' });
  assert.ok(bin.includes('⚠️ แก้ย้อนหลังได้ที่ทะเบียน'));
  assert.ok(!bin.includes('เซ็นแล้วแก้เองไม่ได้'), 'ส่ง warn แล้วต้องแทนที่ ไม่ใช่ต่อท้าย');
  /* 3 อย่างที่ต้องมีเสมอ ไม่ว่าจะส่ง warn หรือไม่ */
  for (const t of ['ผลพิจารณา', 'พาร์ท A · 2026-11-08', 'ข', 'ผู้พิจารณา']) assert.ok(bin.includes(t), t);
});

test('ทะเบียน stage ของใบ MO — จ่ายงาน/ลงผลซ่อม ไม่ใช่การอนุมัติ ห้ามถาม', () => {
  for (const st of SIGN_STAGES) assert.equal(needsSignConfirm(st), true, st);
  for (const st of ['assign', 'service', '', null, undefined, 'ไม่มีจริง'])
    assert.equal(needsSignConfirm(st), false, String(st));
});
