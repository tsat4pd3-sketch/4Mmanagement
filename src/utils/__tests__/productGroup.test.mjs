import test from 'node:test';
import assert from 'node:assert/strict';
import { partCoreOf, groupSameProductKeys } from '../oee.js';

/* จับกลุ่ม "ชิ้นงานเดียวกัน" สำหรับตรวจ parallel ใน computeOEE
   ที่มา: ทวนสอบ OEE กับ Excel หน้างาน 2026-09-09 (docs/OEE-EXCEL-VERIFY-2026-09-09.md)
   พาร์ทเดียวกันที่แตก MAT ตามลูกค้า/เรฟ ต้องอยู่กลุ่มเดียวกัน ไม่งั้นขึ้น parallel กันเองแล้ว %P เพี้ยน */

test('partCoreOf — ตัดตัวคั่นแล้วเอาเลขพาร์ทแกนกลาง (prefix/เรฟ ต่างกันได้)', () => {
  assert.equal(partCoreOf('RB3B-8C306-BC'), '8C306');
  assert.equal(partCoreOf('RB3B 8C306 BB'), '8C306');
  assert.equal(partCoreOf('MB3B - 8C306 - BA'), '8C306');
  assert.equal(partCoreOf('MB3B 8A297 CB'), '8A297');
  assert.equal(partCoreOf('MB3B-8A297-BC'), '8A297');
  assert.equal(partCoreOf('RB3B-16E060-BA'), '16E060');
});

test('partCoreOf — ฟอร์แมตที่ไม่ใช่ 3 ท่อน คืนทั้งก้อน ห้ามรวมมั่ว', () => {
  assert.equal(partCoreOf('MB3BE102D04BC'), 'MB3BE102D04BC'); // ไม่มีตัวคั่น
  assert.equal(partCoreOf('SP-83'), 'SP83');                  // 2 ท่อน
  assert.equal(partCoreOf('RB3B-E102D21'), 'RB3BE102D21');    // 2 ท่อน
  assert.equal(partCoreOf('A-B-C'), 'ABC');                   // ท่อนกลางสั้น/ไม่มีเลข → ทั้งก้อน
  assert.equal(partCoreOf(''), '');
  assert.equal(partCoreOf(null), '');
});

test('LH/RH และพาร์ทคนละตัว ต้องไม่ถูกรวมกัน', () => {
  assert.notEqual(partCoreOf('RB3B-16E060-BA'), partCoreOf('RB3B-16E061-BA'));
  assert.notEqual(partCoreOf('MB3B-16290-B'), partCoreOf('MB3B-16291-B'));
});

test('เคสจริง Assy LWR 306 — 4 MAT คนละลูกค้า/เรฟ ชื่อสะกดต่างกัน ต้องเป็นกลุ่มเดียว', () => {
  const g = groupSameProductKeys([
    { matNo: '10105769', name: 'REINF ASY RAD SUPT LWR(306)(AAT)',       pNo: 'RB3B-8C306-BC' },
    { matNo: '10105770', name: 'REINF ASY RAD SUPT LWR(RB3B-8C306-BC)',  pNo: 'RB3B-8C306-BC' },
    { matNo: '10100381', name: 'REINF ASY RAD SUPT LWR (FVL)',           pNo: 'RB3B-8C306-BB' },
    { matNo: '20066630', name: 'REINF ASY RAD LWR(MB3B-8C306-BA)ก่อนแพ็กFVL', pNo: 'MB3B - 8C306 - BA' },
  ]);
  assert.equal(new Set(Object.values(g)).size, 1);
});

test('เคสจริง Assy GOR 297 — MAT ที่ p_no เป็น BC/CB คนละเรฟ ต้องเป็นกลุ่มเดียว', () => {
  const g = groupSameProductKeys([
    { matNo: '20058498', name: 'SUPT ASY RAD(MB3B-8A297-CB)ก่อนชุบ', pNo: 'MB3B-8A297-BC' },
    { matNo: '10086024', name: 'SUPT ASY RAD(MB3B-8A297-CB)',        pNo: 'MB3B 8A297 CB' },
    { matNo: '10101158', name: 'SUPT ASY RAD (FVL)',                 pNo: 'MB3B-8A297-CB' },
  ]);
  assert.equal(new Set(Object.values(g)).size, 1);
});

test('พาร์ทคนละตัวยังแยกกลุ่มกันอยู่ (ไม่รวมมั่ว)', () => {
  const g = groupSameProductKeys([
    { matNo: 'A', name: 'PART A', pNo: 'RB3B-8C306-BC' },
    { matNo: 'B', name: 'PART B', pNo: 'RB3B-16E060-BA' },
    { matNo: 'C', name: 'PART C', pNo: 'RB3B-16E061-BA' },
  ]);
  assert.equal(new Set(Object.values(g)).size, 3);
});

test('union — ชื่อเดียวกันแต่เลขพาร์ทคนละแบบ ยังรวมเหมือนเดิม (กลุ่มหยาบขึ้นได้ ห้ามละเอียดขึ้น)', () => {
  const g = groupSameProductKeys([
    { matNo: 'E025-M6', name: 'REINF FRT FNDR BAT MTNG LWR LH', pNo: 'MB3B-16E025-C' },
    { matNo: 'E025-M8', name: 'REINF FRT FNDR BAT MTNG LWR LH', pNo: 'MB3B-16E025-C' },
    { matNo: 'SP83',    name: 'REINF FRT FNDR BAT MTNG LWR LH', pNo: 'SP-83' },
  ]);
  assert.equal(new Set(Object.values(g)).size, 1);
});

test('ไม่มีทั้งชื่อและเลขพาร์ท → อยู่กลุ่มของตัวเอง', () => {
  const g = groupSameProductKeys([
    { matNo: 'X', name: null, pNo: null },
    { matNo: 'Y', name: '',   pNo: '' },
  ]);
  assert.equal(new Set(Object.values(g)).size, 2);
  assert.equal(g.X, 'MAT:X');
});

test('รายการว่าง → object ว่าง ไม่ throw', () => {
  assert.deepEqual(groupSameProductKeys([]), {});
  assert.deepEqual(groupSameProductKeys(), {});
});
