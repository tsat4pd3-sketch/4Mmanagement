/* "ไลน์ที่ดูแล" vs "ไลน์ที่ตัวเองสังกัด" (2026-10-27 · หน้างานแจ้ง)
   หัวหน้ากลุ่ม Assembly Line D 2 คน: profiles.line_id = ไลน์แม่ (ถูกแล้ว)
   แต่ employees.line_id = ไลน์ลูกที่ตัวเองสังกัด ⇒ ของพนักงานชนะ ⇒ เห็นแค่กลุ่มย่อยตัวเอง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widerLineId, lineAncestorIds } from '../lineHierarchy.js';

/* ผังจริง (ย่อ): Assembly Line D - GWM&RA (9) → Line D2 (56) · Line D3 (57) · Line D6 (52)
   และอีกสายที่ไม่เกี่ยวกัน: LINE D ( 110&300 Ton ) (20) */
const LINES = [
  { id: 9,  name: 'Assembly Line D - GWM&RA', parent_line_name: null },
  { id: 56, name: 'Line D2 - LWR BAR',        parent_line_name: 'Assembly Line D - GWM&RA' },
  { id: 57, name: 'Line D3 - STAMPED',        parent_line_name: 'Assembly Line D - GWM&RA' },
  { id: 52, name: 'Line D6 - Sub Assembly',   parent_line_name: 'Assembly Line D - GWM&RA' },
  { id: 99, name: 'Line D6 ย่อย',              parent_line_name: 'Line D6 - Sub Assembly' },
  { id: 20, name: 'LINE D ( 110&300 Ton )',   parent_line_name: null },
];

test('🔴 เคสจริง — บัญชีตั้งไลน์แม่ไว้ ต้องชนะไลน์ลูกที่ตัวเองสังกัด', () => {
  assert.equal(widerLineId(9, 56, LINES), 9, 'ณัฐพล (Line D2)');
  assert.equal(widerLineId(9, 57, LINES), 9, 'โสภณ (Line D3)');
});

test('ไลน์แม่ข้ามหลายชั้นก็ยังชนะ', () => {
  assert.equal(widerLineId(9, 99, LINES), 9);   // 99 → 52 → 9
  assert.equal(widerLineId(52, 99, LINES), 52);
});

test('ฐานพนักงานกว้างกว่าอยู่แล้ว = ใช้ของฐานพนักงาน', () => {
  assert.equal(widerLineId(56, 9, LINES), 9, 'บัญชีตั้งไลน์ลูก แต่พนักงานอยู่ไลน์แม่');
});

test('🔴 คนละสาย = ฐานพนักงานชนะ (ตัวตนจริง — กันบัญชีที่ข้อมูลล้าสมัย)', () => {
  assert.equal(widerLineId(20, 56, LINES), 56);
  assert.equal(widerLineId(9, 20, LINES), 20);
});

test('🔴 อ่านทะเบียนไลน์ไม่ได้ = พฤติกรรมเดิมเป๊ะ (ห้ามเดาให้กว้างขึ้น)', () => {
  assert.equal(widerLineId(9, 56, []), 56);
  assert.equal(widerLineId(9, 56, null), 56);
});

test('ค่าว่าง/เท่ากัน', () => {
  assert.equal(widerLineId(9, null, LINES), 9);
  assert.equal(widerLineId(null, 56, LINES), 56);
  assert.equal(widerLineId(null, null, LINES), null);
  assert.equal(widerLineId(56, 56, LINES), 56);
  assert.equal(widerLineId('56', 56, LINES), 56, 'เทียบข้ามชนิดต้องไม่พลาด');
});

test('lineAncestorIds — สายบนเท่านั้น ไม่รวมตัวเอง ไม่รวมลูก', () => {
  assert.deepEqual([...lineAncestorIds(LINES, 99)].sort((a, b) => a - b), [9, 52]);
  assert.deepEqual([...lineAncestorIds(LINES, 9)], []);
  assert.deepEqual([...lineAncestorIds(LINES, 56)], [9]);
  assert.deepEqual([...lineAncestorIds([], 56)], []);
});
