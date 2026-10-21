import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partLevelCoverage } from '../partLevelCoverage.js';

const LINES = [{ name: 'Line 60' }, { name: 'Line 61' }, { name: 'LINE B ( 600 Ton )' }];

test('ของที่ไลน์ใช้ (consume) ที่ยังไม่มี min = งานค้าง · ของที่ไลน์ผลิตเองไม่นับเป็นงานค้าง', () => {
  const r = partLevelCoverage({
    stock: [
      { line_name: 'Line 60', mat_no: '20000001', qty_on_hand: 100 },   // ใช้ · ไม่มี level
      { line_name: 'Line 60', mat_no: '20000002', qty_on_hand: 0 },     // ใช้ · มี level + min
      { line_name: 'Line 60', mat_no: '10088639', qty_on_hand: 50 },    // ผลิตเอง (มีกฎรับเข้า)
    ],
    levels: [{ line_name: 'Line 60', mat_no: '20000002', min_qty: 10, is_active: true }],
    products: [{ mat_no: '10088639', line_name: 'Line 60', is_active: true }],
    rules: [{ match_type: 'prefix', match_value: '1', dest_line_name: 'FG WAREHOUSE', is_active: true }],
    lines: LINES,
  });
  assert.equal(r.rows.length, 1);
  const g = r.rows[0];
  assert.equal(g.consume, 2);
  assert.equal(g.produce, 1);
  assert.equal(g.watched, 1);
  assert.equal(g.unwatched, 1);
  assert.equal(g.pct, 50);
  assert.equal(r.totals.unwatched, 1);
  assert.equal(r.totals.produce, 1);
});

test('🔴 แถวยอด 0 ต้องนับ — "ของหมดแล้วยังไม่มีใครเฝ้า" คือเคสที่ต้องเห็นที่สุด', () => {
  const r = partLevelCoverage({
    stock: [{ line_name: 'Line 61', mat_no: '20000009', qty_on_hand: 0 }],
    levels: [], lines: LINES,
  });
  assert.equal(r.totals.consume, 1);
  assert.equal(r.totals.unwatched, 1);
  assert.equal(r.rows[0].parts[0].qty, 0);
});

test('🔴 คลังที่ไม่ใช่ไลน์ผลิต (STORE/FG) กันออกจากตัวนับ แต่ต้องคืนจำนวนที่กันออก', () => {
  const r = partLevelCoverage({
    stock: [
      { line_name: 'STORE', mat_no: '20000001', qty_on_hand: 999 },
      { line_name: 'FG WAREHOUSE', mat_no: '10000001', qty_on_hand: 999 },
      { line_name: 'Line 60', mat_no: '20000002', qty_on_hand: 5 },
    ],
    levels: [], lines: LINES,
  });
  assert.equal(r.totals.skipped, 2);
  assert.equal(r.totals.consume, 1);
  assert.deepEqual(r.rows.map(g => g.line_name), ['Line 60']);
});

test('🔴 อ่านทะเบียนไลน์ไม่ได้ = ไม่กันอะไรออก + ชูธง linesUnknown (ห้ามสรุปว่าครบ)', () => {
  const r = partLevelCoverage({
    stock: [{ line_name: 'STORE', mat_no: '20000001', qty_on_hand: 1 },
            { line_name: 'Line 60', mat_no: '20000002', qty_on_hand: 1 }],
    levels: [], lines: [],
  });
  assert.equal(r.linesUnknown, true);
  assert.equal(r.totals.skipped, 0);
  assert.equal(r.rows.length, 2);
});

test('มีแถวจุดเรียกเติมแต่ไม่ใส่ min = ยังไม่เฝ้า + ธง hasRowNoMin (ระบบไม่เตือนอะไรเลย)', () => {
  const r = partLevelCoverage({
    stock: [{ line_name: 'Line 60', mat_no: '20000003', qty_on_hand: 7 }],
    levels: [{ line_name: 'Line 60', mat_no: '20000003', min_qty: null, is_active: true }],
    lines: LINES,
  });
  assert.equal(r.totals.watched, 0);
  assert.equal(r.totals.unwatched, 1);
  assert.equal(r.totals.rowNoMin, 1);
  assert.equal(r.rows[0].parts[0].hasRowNoMin, true);
});

test('level ที่ปิดใช้งาน / ชื่อไลน์เว้นวรรคต่างกัน — ไม่ทำให้นับเพี้ยน', () => {
  const r = partLevelCoverage({
    stock: [{ line_name: 'Assy  LWR', mat_no: '20000004', qty_on_hand: 1 },
            { line_name: 'Line 60', mat_no: '20000005', qty_on_hand: 1 }],
    levels: [{ line_name: 'assy lwr', mat_no: '20000004', min_qty: 5, is_active: true },
             { line_name: 'Line 60', mat_no: '20000005', min_qty: 5, is_active: false }],
    lines: [{ name: 'Assy  LWR' }, { name: 'Line 60' }],
  });
  const byName = Object.fromEntries(r.rows.map(g => [g.line_name, g]));
  assert.equal(byName['Assy  LWR'].watched, 1);     // ช่องว่างซ้ำ/ตัวพิมพ์ = ไลน์เดียวกัน
  assert.equal(byName['Line 60'].unwatched, 1);     // ปิดใช้งาน = ไม่นับว่าเฝ้า
});

test('เรียงไลน์ที่ขาดมากสุดก่อน · ไลน์ที่ครบแล้วไปท้าย แต่ห้ามหาย', () => {
  const r = partLevelCoverage({
    stock: [
      { line_name: 'Line 60', mat_no: 'A1', qty_on_hand: 1 },
      { line_name: 'Line 60', mat_no: 'A2', qty_on_hand: 1 },
      { line_name: 'Line 61', mat_no: 'B1', qty_on_hand: 1 },
    ],
    levels: [{ line_name: 'Line 61', mat_no: 'B1', min_qty: 1, is_active: true }],
    lines: LINES,
  });
  assert.deepEqual(r.rows.map(g => g.line_name), ['Line 60', 'Line 61']);
  assert.equal(r.totals.linesWithGap, 1);
  assert.equal(r.totals.linesDone, 1);
});

test('ค่าขยะใน qty ห้ามกลายเป็น NaN', () => {
  const r = partLevelCoverage({
    stock: [{ line_name: 'Line 60', mat_no: 'A1', qty_on_hand: 'abc' }],
    levels: [], lines: LINES,
  });
  assert.equal(r.rows[0].parts[0].qty, 0);
});
