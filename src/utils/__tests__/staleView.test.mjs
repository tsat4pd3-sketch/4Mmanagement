/* 🔴 ด่านชั้น 2 ของ stale-response race (QC audit ข้อ ④ · 2026-10-19)
   เคสจริง `/lpa`: คำถามชั้น common ใช้ question_id ร่วมกันทุกไลน์
   ⇒ ใบร่างของไลน์ A ที่มาช้า ทับจอที่เลือกไลน์ B แล้วกดบันทึก = คำตอบไปลงผิดไลน์ **โดยไม่มี error** */
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewKey, isStale, staleBlockText } from '../staleView.js';

test('คีย์ประกอบจากตัวเลือกบนจอ — ค่าว่าง/null ต้องไม่กลายเป็นคำว่า null', () => {
  assert.equal(viewKey('LINE 9', 'day', '2026-10-19', 'leader'), 'LINE 9|day|2026-10-19|leader');
  assert.equal(viewKey(null, undefined, ''), '||');
  assert.equal(viewKey(1, 2), '1|2');
});

test('🔴 คีย์ไม่ตรง = stale (ห้ามเขียน)', () => {
  assert.equal(isStale('A|day|2026-10', 'B|day|2026-10'), true);   // เปลี่ยนไลน์
  assert.equal(isStale('A|day|2026-10', 'A|night|2026-10'), true); // เปลี่ยนกะ
  assert.equal(isStale('A|day|2026-10', 'A|day|2026-11'), true);   // เปลี่ยนเดือน
});

test('คีย์ตรง = เขียนได้', () => {
  assert.equal(isStale('A|day|2026-10', 'A|day|2026-10'), false);
});

test('🔴 ยังไม่เคยโหลด (คีย์ว่าง) ≠ ของไลน์อื่น — ต้องไม่บล็อก', () => {
  assert.equal(isStale('', 'A|day|2026-10'), false);
  assert.equal(isStale(null, 'A|day|2026-10'), false);
  assert.equal(isStale(undefined, 'A|day|2026-10'), false);
});

test('ข้อความต้องบอกทางแก้ ไม่ใช่แค่ว่าไม่สำเร็จ', () => {
  const t = staleBlockText({ what: 'ใบที่แสดงอยู่' });
  assert.match(t, /ใบที่แสดงอยู่/);
  assert.match(t, /มาช้ากว่าการเปลี่ยนตัวเลือก/);
  assert.match(t, /อีกครั้ง/);          // ทางแก้
  assert.doesNotMatch(t, /ไม่สำเร็จ$/);
});
