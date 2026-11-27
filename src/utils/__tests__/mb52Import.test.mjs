import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMb52, parseMb52File, mb52ReportDate, summarizeBySloc, hintsOf, diffOf } from '../mb52Import.js';

/* รูปแบบเดียวกับไฟล์จริง (MB52 P411 · 20/11/2026) แต่ข้อมูลสังเคราะห์ */
const T = '\t';
const SAMPLE = [
  '20.11.2026                         Dynamic List Display                 1',
  '', '',
  ['', '', 'Plnt', 'SLoc', 'Description', 'Material', 'Material Description', '   Unrestr.', 'BUn', '  Total Value', 'Qual.Insp.', 'Value in Q', 'Blocked', 'Value Bloc'].join(T),
  '',
  ['', '', '2140', 'P411', 'ASSY', '10100385', 'REINF ASY', '    20.000', 'PC', '  14,330.60', '    0.000', '0.00', ' 0.000', '0.00'].join(T),
  ['', '', '2140', 'P411', 'ASSY', '10100385', 'REINF ASY', '   170.000', 'PC', ' 121,810.10', '    5.000', '0.00', ' 0.000', '0.00'].join(T),
  ['', '', '2140', 'P411', 'ASSY', '30044771', 'NUT WELD', '24,297.000', 'PC', '  1,000.00', '    0.000', '0.00', ' 2.000', '0.00'].join(T),
  '',
  ['', '*', '', '', '', '', '', '24,487.000', 'PC', '1,200,977.51', '5.000', '0.00', '2.000', '0.00'].join(T),
].join('\r\n');

test('อ่าน MB52: หาหัวจากชื่อคอลัมน์ · รวม batch ราย SLoc×MAT · ข้ามบรรทัดรวม · วันที่หัวไฟล์', () => {
  const r = parseMb52(SAMPLE);
  assert.equal(r.ok, true);
  assert.equal(r.reportDate, '2026-11-20');
  assert.deepEqual(r.slocs, ['P411']);
  assert.equal(r.srcRows, 3);
  assert.equal(r.total, 24487);
  const a = r.rows.find(x => x.mat_no === '10100385');
  assert.deepEqual([a.unrestricted, a.qual_insp, a.src_rows, a.bun], [190, 5, 2, 'PC']);
  assert.equal(r.rows.find(x => x.mat_no === '30044771').blocked, 2);
});

test('layout ต่าง: สลับลำดับคอลัมน์ + ไม่มี QI/Blocked = ยังอ่านได้ + เตือน', () => {
  const t = ['Material' + T + 'Unrestricted' + T + 'Storage Location', '30044771' + T + '1,000.000' + T + 's401'].join('\n');
  const r = parseMb52(t);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map(x => [x.sloc, x.mat_no, x.unrestricted]), [['S401', '30044771', 1000]]);
  assert.equal(r.warnings.length, 2);
  assert.equal(r.reportDate, null);   // ไม่มีวันที่ = null ไม่เดา
});

test('หาคอลัมน์ที่ต้องมีไม่เจอ = error พร้อมหัวที่เจอ (ห้ามเดาตำแหน่ง)', () => {
  const r = parseMb52(['วัสดุ' + T + 'ที่เก็บ' + T + 'ไม่จำกัด', '1' + T + 'P411' + T + '5'].join('\n'));
  assert.equal(r.ok, false);
  assert.match(r.error, /Material/);
  assert.deepEqual(r.headers, ['วัสดุ', 'ที่เก็บ', 'ไม่จำกัด']);
});

test('ไฟล์ UTF-16LE (แบบที่ SAP คาย) อ่านผ่าน parseMb52File', () => {
  const body = Buffer.from(SAMPLE, 'utf16le');
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  const r = parseMb52File(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(r.ok, true);
  assert.equal(r.total, 24487);
});

test('สรุปราย SLoc + คำใบ้', () => {
  const rows = [
    { sloc: 'P411', sap_qty: 100, esm_qty: 100 },
    { sloc: 'P411', sap_qty: 50, esm_qty: -10, hint_gap: 10 },
    { sloc: 'S401', sap_qty: null, esm_qty: 30, esm_basis: 'pile' },
  ];
  const s = summarizeBySloc(rows);
  const p = s.find(x => x.sloc === 'P411');
  assert.deepEqual([p.mats, p.match, p.diff, p.absDiff], [2, 1, 1, 60]);
  assert.equal(diffOf(rows[1]), -60);
  assert.match(hintsOf(rows[1]).join(), /ยังไม่ลงจ่าย 10/);
  assert.match(hintsOf(rows[2]).join(), /ไม่มีใน SAP/);
  assert.equal(mb52ReportDate('x 01/02/2027 y'), '2027-02-01');
});
