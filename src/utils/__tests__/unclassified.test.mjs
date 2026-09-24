import test from 'node:test';
import assert from 'node:assert/strict';
import { isVague, isPlannedWork, splitUnclassified, unclassifiedNote, PLANNED_GROUP } from '../unclassified.js';

test('isVague จับถังขยะได้ทั้งไทย/อังกฤษ/ค่าว่าง', () => {
  ['อื่นๆ', 'อื่น ๆ', 'ไม่ระบุกลุ่ม', 'ไม่ทราบ', '', '   ', '-', 'N/A', 'other', 'Others', 'unknown']
    .forEach(s => assert.equal(isVague(s), true, `ควรเป็นถังขยะ: "${s}"`));
  ['เลเซอร์ (Laser)', 'หุ่นยนต์ / Gripper', 'ไฟฟ้า / ควบคุม', 'Nut / Stud / Feeder']
    .forEach(s => assert.equal(isVague(s), false, `ไม่ควรเป็นถังขยะ: "${s}"`));
});

test('🔴 แยก "อื่นๆ ที่มีข้อความ" ออกจาก "ไม่กรอกเลย" — คนละวิธีแก้', () => {
  const rows = [
    { cat: 'เลเซอร์ (Laser)', note: '' },
    { cat: 'อื่นๆ', note: 'Alarm TC' },        // จับกลุ่มต่อได้
    { cat: 'อื่นๆ', note: '   ' },             // จบ — ต้องแก้ที่การกรอก
    { cat: '', note: 'พาเลทไม่ไหล' },
    { cat: PLANNED_GROUP, note: 'เปลี่ยนตามรอบ PM' },
  ];
  const s = splitUnclassified(rows);
  assert.equal(s.ok.length, 1);
  assert.equal(s.vagueWithText.length, 2);
  assert.equal(s.blank.length, 1);
  assert.equal(s.planned.length, 1, 'งานตามแผนต้องถูกกันออกจากพาเรโตปัญหา');
  // งานตามแผนไม่ถูกนับเป็นถังขยะ
  assert.ok(s.vaguePct > 0 && s.vaguePct < 100);
});

test('🔴 งานตามแผน (PM) ต้องไม่ถูกนับเป็นปัญหา และไม่ถูกนับเป็นถังขยะ', () => {
  assert.equal(isPlannedWork(PLANNED_GROUP), true);
  assert.equal(isPlannedWork('อื่นๆ'), false);
  const s = splitUnclassified([{ cat: PLANNED_GROUP }, { cat: PLANNED_GROUP }]);
  assert.equal(s.planned.length, 2);
  assert.equal(s.vaguePct, 0, 'มีแต่งานตามแผน = ไม่มีถังขยะ');
});

test('ข้อความเตือนบนจอ — ไม่มีถังขยะ = ไม่เตือน (ห้ามรบกวนเปล่าๆ)', () => {
  assert.equal(unclassifiedNote(splitUnclassified([{ cat: 'เลเซอร์ (Laser)' }])), null);
  assert.equal(unclassifiedNote(splitUnclassified([])), null);
  const n = unclassifiedNote(splitUnclassified([{ cat: 'อื่นๆ', note: 'x' }, { cat: 'เลเซอร์' }]));
  assert.ok(n.text.includes('ชี้เป้าไม่ได้'));
  assert.ok(n.text.includes('จับกลุ่มต่อได้'));
});
