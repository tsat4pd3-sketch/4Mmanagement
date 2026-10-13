import test from 'node:test';
import assert from 'node:assert/strict';
import { moNoteCheck, MO_NOTE_MIN, MO_NOTE_HINT } from '../moNoteQuality.js';

test('เขียนครบ = ผ่าน ไม่มีข้อความรบกวน', () => {
  const r = moNoteCheck({ note: 'ตอนเริ่มเดินเครื่องมีเสียงดังที่กระบอกซ้าย ลมรั่ว ยังเดินต่อได้', group: 'ระบบลม', character: 'ลมรั่ว' });
  assert.equal(r.level, 'ok');
  assert.equal(r.blocked, false);
  assert.equal(r.message, null);
});

test('เขียนสั้นกว่าเกณฑ์ = เตือน แต่ห้ามบล็อก', () => {
  const r = moNoteCheck({ note: 'ลมรั่ว', group: 'ระบบลม', character: 'ลมรั่ว' });
  assert.equal(r.level, 'thin');
  assert.equal(r.blocked, false);
  assert.ok(r.message.includes(MO_NOTE_HINT));
});

test('ไม่เขียนเลย แต่เลือกอาการชัด = เตือน ไม่บล็อก (ของเดิมยังแจ้งได้)', () => {
  const r = moNoteCheck({ note: '', group: 'ระบบไฟฟ้า', character: 'เซนเซอร์ไม่จับชิ้นงาน' });
  assert.equal(r.level, 'thin');
  assert.equal(r.blocked, false);
});

test('อาการ "อื่นๆ" + ไม่เขียนอะไรเลย = บล็อก (ทางเดียวที่บล็อก)', () => {
  for (const character of ['อื่นๆ', 'อื่น ๆ', 'ไม่ระบุ', 'other', '-', '']) {
    const r = moNoteCheck({ note: '   ', group: 'ระบบลม', character });
    assert.equal(r.blocked, true, `ควรบล็อกเมื่อหัวข้อย่อย = ${JSON.stringify(character)}`);
    assert.equal(r.level, 'required');
  }
});

test('กลุ่มเป็น "อื่นๆ / ยังระบุไม่ได้" ก็เข้าเงื่อนไขบังคับเหมือนกัน', () => {
  const r = moNoteCheck({ note: '', group: 'อื่นๆ / ยังระบุไม่ได้', character: 'อื่นๆ' });
  assert.equal(r.blocked, true);
});

test('อาการ "อื่นๆ" แต่เขียนรายละเอียดมา = ไม่บล็อก', () => {
  const r = moNoteCheck({ note: 'เครื่องดับเองตอนกดเริ่ม ไม่มีไฟที่ตู้คอนโทรล', group: 'อื่นๆ / ยังระบุไม่ได้', character: 'อื่นๆ' });
  assert.equal(r.blocked, false);
  assert.equal(r.level, 'ok');
});

test('อาการ "อื่นๆ" + เขียนสั้น = เตือน (บล็อกเฉพาะตอนไม่เขียนเลย)', () => {
  const r = moNoteCheck({ note: 'เครื่องดับ', group: 'อื่นๆ / ยังระบุไม่ได้', character: 'อื่นๆ' });
  assert.equal(r.blocked, false);
  assert.equal(r.level, 'thin');
});

test('เรียกแบบไม่ส่งอะไรเลย ต้องไม่ระเบิด', () => {
  const r = moNoteCheck();
  assert.equal(r.blocked, true);     // ไม่เลือกอาการ + ไม่เขียน = ไม่มีข้อมูลเลย
  assert.equal(r.len, 0);
});

test('เกณฑ์ความยาวเป็นขอบล่างแบบ "น้อยกว่า" (เท่าเกณฑ์ = ผ่าน)', () => {
  const exact = 'ก'.repeat(MO_NOTE_MIN);
  assert.equal(moNoteCheck({ note: exact, character: 'ลมรั่ว' }).level, 'ok');
  assert.equal(moNoteCheck({ note: 'ก'.repeat(MO_NOTE_MIN - 1), character: 'ลมรั่ว' }).level, 'thin');
});
