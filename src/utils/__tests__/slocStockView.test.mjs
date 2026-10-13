import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStockBySloc, slocGroupTitle } from '../slocStockView.js';

/* ทะเบียนจำลองตามของจริง 13/10 — P411 ผูกแม่+ลูกทั้งหมด · PD2 ยังไม่ผูก */
const SLOCS = [
  { code: 'S401', name: 'สโตร์ชิ้นส่วน', kind: 'store_part', sort_order: 10, is_active: true, line_names: ['STORE'] },
  { code: 'P411', name: 'Apron Assy', kind: 'production', sort_order: 21, is_active: true,
    line_names: ['LINE APRON ASSY', 'Line 60', 'Line 61', 'SUB APRON'] },
];
const LINES = [
  { name: 'LINE APRON ASSY', parent_line_name: null },
  { name: 'Line 60', parent_line_name: 'LINE APRON ASSY' },
  { name: 'Line 61', parent_line_name: 'LINE APRON ASSY' },
  { name: 'Assembly Line D - GWM&RA', parent_line_name: null },
];

test('พาร์ทเดียวกันหลายไลน์ในพื้นที่เดียว ต้องรวมเป็นแถวเดียว (min/max เป็นค่าต่อ MAT ระดับพื้นที่)', () => {
  const g = groupStockBySloc([
    { line_name: 'Line 60', mat_no: '20059491', qty_on_hand: 3000, part_name: 'ME09HSA1D1AA' },
    { line_name: 'Line 61', mat_no: '20059491', qty_on_hand: 2080 },
  ], { slocs: SLOCS, lines: LINES });
  assert.equal(g.length, 1);
  assert.equal(g[0].code, 'P411');
  assert.equal(g[0].parts.length, 1, 'ต้องยุบเหลือแถวเดียว ไม่ใช่ 2 แถว');
  assert.equal(g[0].parts[0].qty, 5080);
  assert.equal(g[0].parts[0].part_name, 'ME09HSA1D1AA', 'ชื่อพาร์ทจากแถวที่มีชื่อ');
  // กางรายไลน์ไว้ใต้แถว — มาก→น้อย · ห้ามซ่อนว่าไลน์ไหนถืออยู่เท่าไหร่
  assert.deepEqual(g[0].parts[0].byLine, [
    { line_name: 'Line 60', qty: 3000 },
    { line_name: 'Line 61', qty: 2080 },
  ]);
});

test('ไลน์ลูกตกทอดจากไลน์แม่ และไลน์ที่ยังไม่ผูกต้องไม่หาย — ไปอยู่กลุ่มท้ายลิสต์', () => {
  const g = groupStockBySloc([
    { line_name: 'Assembly Line D - GWM&RA', mat_no: '20011111', qty_on_hand: 50 },
    { line_name: 'Line 60', mat_no: '20059491', qty_on_hand: 10 },
    { line_name: 'STORE', mat_no: '30022222', qty_on_hand: 7 },
  ], { slocs: SLOCS, lines: LINES });
  assert.deepEqual(g.map(x => x.code), ['S401', 'P411', null], 'เรียงตาม sort_order · ไม่ผูก = ท้ายสุด');
  assert.equal(g[2].parts[0].mat_no, '20011111');
  assert.equal(slocGroupTitle(g[2]), '🏬 ยังไม่ผูกพื้นที่ SAP');
  assert.equal(slocGroupTitle(g[1]), '🏬 P411 · Apron Assy');
});

test('ทะเบียนว่าง (โหลดไม่ได้) = ทุกแถวไปกลุ่ม "ยังไม่ผูก" ห้ามหายจากจอ', () => {
  const g = groupStockBySloc([
    { line_name: 'Line 60', mat_no: 'A', qty_on_hand: 1 },
    { line_name: 'STORE', mat_no: 'B', qty_on_hand: 2 },
  ], { slocs: [], lines: [] });
  assert.equal(g.length, 1);
  assert.equal(g[0].code, null);
  assert.equal(g[0].parts.length, 2);
  assert.deepEqual(g[0].lineNames.sort(), ['Line 60', 'STORE']);
});

test('ยอดติดลบ/ค่าพัง ต้องไม่กลายเป็น NaN และยังรวมได้', () => {
  const g = groupStockBySloc([
    { line_name: 'Line 60', mat_no: 'A', qty_on_hand: -470 },
    { line_name: 'Line 61', mat_no: 'A', qty_on_hand: null },
    { line_name: 'SUB APRON', mat_no: 'A', qty_on_hand: 'x' },
  ], { slocs: SLOCS, lines: LINES });
  assert.equal(g[0].parts[0].qty, -470);
  assert.equal(g[0].parts[0].byLine.length, 3);
});
