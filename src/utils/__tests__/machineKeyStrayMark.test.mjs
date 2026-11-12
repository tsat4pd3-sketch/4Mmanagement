import test from 'node:test';
import assert from 'node:assert/strict';
import { machineKey, stripStrayThaiMarks } from '../machineNo.js';

/* 🏷️ วรรณยุกต์/สระไทย "ลอย" หน้าเลขเครื่อง — backfill 09/11 (คำสั่ง user "แก้ในฐานเลย")
   `ฺBD-08` กับ `BD-08` = เครื่องเดียวกัน แต่แตกเป็น 2 แท่งในพาเรโต/MTBF/KPI ช่าง  */

test('มาร์คลอย (ต้นคำ / ตามหลังอักขระที่ไม่ใช่อักษรไทย) ⇒ ได้คีย์เดียวกับตัวที่สะกดถูก', () => {
  for (const [bad, good] of [
    ['ฺBD-08', 'BD-08'],      // ฺ phinthu นำ — เคสจริง 194 vs 1 แถว
    ['ฺRB-114', 'RB-114'],
    ['่jig 006', 'jig 006'],  // ไม้เอกนำ
    ['๋JIG005', 'JIG-005'],
    ['์Jig-main', 'Jig-main'],
    ['ิbending', 'bending'],
    ['่่Jig-5', 'Jig-5'],      // 2 มาร์คซ้อน
    ['๋๋JIG MC 1', 'JIG MC 1'],
    ['่เลเซอร์03', 'เลเซอร์03'], // มาร์คลอยหน้าคำไทยที่สะกดถูก
  ]) {
    assert.equal(machineKey(bad), machineKey(good), `${bad} ควรได้คีย์เดียวกับ ${good}`);
  }
});

test('🔴 ห้ามกินวรรณยุกต์ที่ซ้อนบน "สระ" — เครื่อง/ติดตั้ง/เบนดิ่ง ต้องไม่ถูกแตะ', () => {
  /* ไทยซ้อนวรรณยุกต์บนสระได้: เครื่อง = ค ร ◌ื ◌่ อ ง
     เกณฑ์ที่ดูแค่พยัญชนะ (ก-ฮ) จะกิน เครื่อง→เครือง — เคยเขียนผิดจริงรอบแรก 09/11
     ถ้าเทสนี้ล้ม = ชื่อเครื่อง/อาการภาษาไทยทั้งฐานถูกทำลายเงียบๆ */
  for (const w of [
    'เครื่อง mark', 'ติดตั้งเครื่องดูดควันกลับ', 'เบนดิ่ง08',
    'ไม่มีหมายเลขเครื่อง (Feeder M8)', 'เลเซอร์04', 'ปืนยิงรีเวท', 'Jig-แม็กกาซีน',
  ]) {
    assert.equal(stripStrayThaiMarks(w), w, `"${w}" ต้องไม่ถูกตัดอะไรเลย`);
  }
});

test('ยังไม่ยุบทับศัพท์/ชื่อย่อ — เดาตัวตนเครื่องห้ามทำ', () => {
  assert.notEqual(machineKey('เลเซอร์04'), machineKey('Laser4'));
  assert.notEqual(machineKey('เบนดิ่ง08'), machineKey('เลเซอร์08'));
});

test('พฤติกรรมเดิมของ machineKey ไม่เปลี่ยน (รูปแบบ: พิมพ์/ช่องว่าง/ขีด/ศูนย์นำ)', () => {
  assert.equal(machineKey('SP-78'), machineKey('SP78'));
  assert.equal(machineKey('ls10'), machineKey('LS-010'));
  assert.equal(machineKey('RB 102'), machineKey('RB-0102'));
  assert.equal(machineKey(''), '');
  assert.equal(machineKey(null), '');
});
