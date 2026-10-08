/* ลำดับมาตรฐานของรายชื่อไลน์ (2026-10-01 · user: "บางหน้าเรียงมั่ว ไม่มีแพทเทิร์น")
   ข้อมูล = ทะเบียน production_lines จริง (MAIN · 01/10/2026) ย่อเหลือคอลัมน์ที่ใช้ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHierarchicalOptions, sortLineNames, lineNameCompare } from '../lineHierarchy.js';

const RAW = [
  ['Assy  LWR', 'LWR BAR', 'PD4'], ['Assy GOR', 'GOR', 'PD4'], ['BENDING E50', 'HYDROFORM', 'PD3'],
  ['GOR', null, 'PD4'], ['HDF1', 'HYDROFORM', 'PD3'], ['HDF2', 'HYDROFORM', 'PD3'], ['HYDROFORM', null, 'PD3'],
  ['LASER-345', 'HYDROFORM', 'PD3'], ['Line 60', 'LINE APRON ASSY', 'PD3'], ['Line 61', 'LINE APRON ASSY', 'PD3'],
  ['LINE A ( 800 Ton )', null, 'PD1'], ['LINE APRON ASSY', null, 'PD3'], ['LINE ASSY FORD UP375', null, 'PD2'],
  ['LINE ASSY TSRA', null, 'PD2'], ['LINE B ( 600 Ton )', null, 'PD1'], ['LINE GWM', 'LINE ASSY TSRA', 'PD2'],
  ['LWR BAR', null, 'PD4'], ['Rework - PD1', null, 'PD1'], ['SUB APRON', 'LINE APRON ASSY', 'PD3'], ['ไม่มีส่วนงาน', null, null],
];
const LINES = RAW.map(([name, parent_line_name, section], id) => ({ id, name, parent_line_name, section }));
const flat = (ls) => toHierarchicalOptions(ls).map(o => `${'·'.repeat(o.depth)}${o.line.name}`);

test('ส่วนงาน → แม่ → ลูกใต้แม่ · ไม่มีส่วนงาน = ท้ายสุด', () => {
  assert.deepEqual(flat(LINES), [
    'LINE A ( 800 Ton )', 'LINE B ( 600 Ton )', 'Rework - PD1',
    'LINE ASSY FORD UP375', 'LINE ASSY TSRA', '·LINE GWM',
    'HYDROFORM', '·BENDING E50', '·HDF1', '·HDF2', '·LASER-345', 'LINE APRON ASSY', '·Line 60', '·Line 61', '·SUB APRON',
    'GOR', '·Assy GOR', 'LWR BAR', '·Assy  LWR',
    'ไม่มีส่วนงาน',
  ]);
});

test('ลำดับไม่ขึ้นกับลำดับ input (ต้นเหตุเดิม: แต่ละหน้า query มาคนละลำดับ)', () => {
  const want = flat(LINES);
  assert.deepEqual(flat([...LINES].reverse()), want);
  assert.deepEqual(flat([...LINES].sort((a, b) => b.id % 7 - a.id % 7)), want);
});

test('เรียงธรรมชาติ — ไม่สนตัวพิมพ์ · เลขเป็นตัวเลข', () => {
  assert.deepEqual(['LINE 10', 'Line 9', 'LINE 1'].sort(lineNameCompare), ['LINE 1', 'Line 9', 'LINE 10']);
});

test('sortLineNames — ตามทะเบียนก่อน · ชื่อนอกทะเบียนต่อท้าย ห้ามหาย', () => {
  assert.deepEqual(sortLineNames(['GOR', 'zzz เก่า', 'LINE A ( 800 Ton )', 'Line 60', 'GOR', ''], LINES),
    ['LINE A ( 800 Ton )', 'Line 60', 'GOR', 'zzz เก่า']);
});

test('ไลน์ลูกที่แม่ถูกกรองออก = ขึ้นเป็นรากในส่วนงานของตัวเอง', () => {
  assert.deepEqual(flat(LINES.filter(l => ['Line 60', 'LINE A ( 800 Ton )'].includes(l.name))), ['LINE A ( 800 Ton )', 'Line 60']);
});
