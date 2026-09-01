/**
 * กฎ "หน่วยย่อยที่สุด" (leaf line) — user เคาะ 2026-08-31
 * "ของมันต้องส่งเข้าไลน์ลูกอยู่แล้วถ้าไลน์แม่มีลูก ... ถ้าไม่มีลูก ไลน์นั้นถึงจะเป็นหน่วยย่อยสุด"
 *
 * เทสนี้ล็อกไว้กันคนเผลอเอา getLineFamilyNames (แกน "ใครเห็นอะไร")
 * ไปใช้กับสต็อก (แกน "ของอยู่ที่ไหน") ซึ่งทำให้ไลน์ลูกนับของของแม่ซ้ำกันทุกตัว
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLeafLine, getChildLineNames, getLeafLineNames, getLineFamilyNames } from '../lineHierarchy.js';

/* ผังจริงย่อส่วน: LINE APRON ASSY (แม่) → Line 60 / Line 61 / Assy LWR
   + HYDROFORM (แม่) → HDF1 → HDF1-A (หลาน)  + SUB APRON (ไลน์เดี่ยว ไม่มีลูก) */
const LINES = [
  { id: 1, name: 'LINE APRON ASSY', parent_line_name: null },
  { id: 2, name: 'Line 60',         parent_line_name: 'LINE APRON ASSY' },
  { id: 3, name: 'Line 61',         parent_line_name: 'LINE APRON ASSY' },
  { id: 4, name: 'Assy LWR',        parent_line_name: 'LINE APRON ASSY' },
  { id: 5, name: 'HYDROFORM',       parent_line_name: null },
  { id: 6, name: 'HDF1',            parent_line_name: 'HYDROFORM' },
  { id: 7, name: 'HDF1-A',          parent_line_name: 'HDF1' },
  { id: 8, name: 'SUB APRON',       parent_line_name: null },
];

test('ไลน์แม่ที่มีลูก = ไม่ใช่หน่วยย่อยสุด · ไลน์ไม่มีลูก = ใช่', () => {
  assert.equal(isLeafLine(LINES, 'LINE APRON ASSY'), false);
  assert.equal(isLeafLine(LINES, 'HYDROFORM'), false);
  assert.equal(isLeafLine(LINES, 'HDF1'), false, 'ไลน์กลาง (มีหลาน) ก็ไม่ใช่ leaf');
  assert.equal(isLeafLine(LINES, 'Line 60'), true);
  assert.equal(isLeafLine(LINES, 'HDF1-A'), true);
  assert.equal(isLeafLine(LINES, 'SUB APRON'), true, 'ไลน์เดี่ยวไม่มีลูก = เป็นหน่วยย่อยสุดของตัวเอง');
});

test('lines ยังโหลดไม่เสร็จ = ถือว่าเป็น leaf ไว้ก่อน (จอห้ามกระพริบ "เป็นไลน์แม่")', () => {
  assert.equal(isLeafLine([], 'Line 60'), true);
  assert.equal(isLeafLine(null, 'Line 60'), true);
  assert.equal(isLeafLine(LINES, ''), true);
});

test('getLeafLineNames — ปลายทางที่ของควรอยู่', () => {
  assert.deepEqual(getLeafLineNames(LINES, 'LINE APRON ASSY').sort(), ['Assy LWR', 'Line 60', 'Line 61']);
  assert.deepEqual(getLeafLineNames(LINES, 'HYDROFORM'), ['HDF1-A'], 'ต้องไล่ลงถึงหลาน ไม่หยุดที่ลูกชั้นแรก');
  assert.deepEqual(getLeafLineNames(LINES, 'SUB APRON'), ['SUB APRON'], 'leaf อยู่แล้ว = คืนตัวเอง');
  assert.deepEqual(getLeafLineNames(LINES, ''), []);
});

test('getChildLineNames = ลูกชั้นเดียว ไม่รวมหลาน', () => {
  assert.deepEqual(getChildLineNames(LINES, 'HYDROFORM'), ['HDF1']);
  assert.deepEqual(getChildLineNames(LINES, 'Line 60'), []);
});

test('🔴 leaf ≠ family — เอา family ไปนับสต็อกคือของแม่ถูกนับซ้ำทุกไลน์ลูก', () => {
  // family ของไลน์ลูกครอบ "แม่ + พี่น้อง" ด้วย → ถ้าเอาไปนับสต็อกจะได้ของก้อนเดียวกันทุกตัว
  const fam60 = getLineFamilyNames(LINES, 'Line 60');
  assert.ok(fam60.includes('LINE APRON ASSY'), 'family ครอบไลน์แม่ (ถูกต้องสำหรับ scope การมองเห็น)');

  // จำลอง: ของ 100 ชิ้นกองอยู่ที่ไลน์แม่ ไลน์ลูกไม่มีของเลย
  const stock = [{ line_name: 'LINE APRON ASSY', mat_no: 'M1', qty_on_hand: 100 }];
  const sumBy = (names) => stock.filter(s => names.includes(s.line_name))
    .reduce((a, s) => a + s.qty_on_hand, 0);

  // แบบผิด (family): ลูกทั้ง 3 ตัวต่างคนต่างเห็น 100 → รวมทั้งกลุ่มกลายเป็น 300
  const wrong = ['Line 60', 'Line 61', 'Assy LWR']
    .reduce((a, n) => a + sumBy(getLineFamilyNames(LINES, n)), 0);
  assert.equal(wrong, 300, 'พิสูจน์ว่านับซ้ำ 3 เท่า');

  // แบบถูก (leaf/exact): ของยังไม่ถูกจ่ายลงมา ⇒ ไลน์ลูกมี 0 → ต้องแจ้งเติม
  const right = ['Line 60', 'Line 61', 'Assy LWR'].reduce((a, n) => a + sumBy([n]), 0);
  assert.equal(right, 0);
});
