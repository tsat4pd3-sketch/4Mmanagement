/* 🤝 ตัวแกะไฟล์ V5 Customer Satisfaction (24/11) — โครงชีท STD FAC. จำลองจากไฟล์จริง FY2026 10.Oct Rev.02 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsatGrid, parseCsatBook, pickCsatSheet, isCsatSheet, csatBaseVars, csatFileMeta } from '../csatImport.js';

const grid = [
  [], [], [], [], [], [],
  [null, 'Customer', 'Type', 'Target', 'Commitment', 'Grade C', 'TSAT-4 : % Quality & Delivery 2026'],
  [null, null, null, 'Grade A', 'Grade B', 'Grade C', 'Jan', null, 'Feb', null, 'Mar', null, 'Apr', null, 'May', null, 'June', null, 'July', null, 'August', null, 'September', null, 'October', null, 'November', null, 'December'],
  [null, null, null, 'Score = 1', 'Score = 0.5', 'Score = 0', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Result', 'Score', 'Avg', 'Avg', null, 'Jan - Apr'],
  [null, 'FORD (FTM+AAT)', 'Delivery', '≥ 81 Points', '72 - 80 Points', '65 - 71 Points', 100, 1, 100, 1, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 0, null, 0],
  [null, 'GWM', 'Delivery', '≤ 5 Points', '6 - 25 Points', '26 - 40 Points', '*', '*', 0, 1, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 1, null, 1, 1, 0, null, 'Jan - May', 'Updated ข้อมูลจากลูกค้า'],
  [null, 'TSPKK', 'Delivery', '100 Points', '90 - 99 Points', '≤ 89 Points', 100, 1, 97, 0.5],
  [null, 'Total Delivery', null, 1, '≥95%', null, null, 1, null, 0.8333333333333334, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 0.3333],
  [null, 'FORD (FTM+AAT)', 'Quality', '≤ 6 PPM.', '7 - 10 PPM.', '> 10 - 15 PPM.', 0, 1, 0, 1],
  [null, 'GWM', 'Quality', '≤ 5 Points', '6 - 25 Points', '26 - 40 Points', '*', '*', 0, 1],
  [null, 'TSPKK', 'Quality', '≥ 99 Points', '90 - 98 Points', '≤ 89 Points', 99.59, 1, 100, 1],
  [null, 'Total Quality', null, 1, '≥95%', null, null, 1, null, 1],
  [null, 'FORD (FTM+AAT)', 'Q&D', null, null, '*** Q1 Score', 99, 1, 100, 1],
  [null, 'Overall TSAT-4', null, 1, '≥95%', null, null, 1, null, 0.9166666666666666, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 0.4166],
  [null, 'Remark : Customer Satisfaction Overall (Q&D) *** อ้างอิงตาม CSR ลูกค้า'],
];

test('parseCsatGrid: แถวรายลูกค้า × D/Q × เดือน · "*" = ไม่ประเมิน · เดือนว่างไม่สร้างแถว · Q&D ไม่เก็บ · remark ติดแถว', () => {
  const r = parseCsatGrid(grid, { year: 2026 });
  assert.deepEqual(r.warnings.filter(w => !/สูตรค้าง/.test(w)), []);
  assert.equal(r.rows.length, 12);                                   // 3 ลูกค้า × 2 ชนิด × 2 เดือน (ม.ค. GWM = '*' ก็ยังเป็นแถว evaluated:false)
  const gwmJan = r.rows.find(x => x.customer === 'GWM' && x.kind === 'delivery' && x.month === 1);
  assert.deepEqual([gwmJan.evaluated, gwmJan.score, gwmJan.result, gwmJan.remark], [false, null, null, 'Updated ข้อมูลจากลูกค้า']);
  const tspkFeb = r.rows.find(x => x.customer === 'TSPKK' && x.kind === 'delivery' && x.month === 2);
  assert.deepEqual([tspkFeb.result, tspkFeb.score, tspkFeb.evaluated], [97, 0.5, true]);
  assert.ok(!r.rows.some(x => x.month === 11 || x.month === 12), 'พ.ย./ธ.ค. ไม่มีผล = ไม่มีแถว (ช่อง Score 0/1 เป็นสูตรค้าง)');
  assert.equal(r.bands['TSPKK|delivery'].a, '100 Points');
});

test('ค่ารวมที่ระบบคิด = Overall ในไฟล์เป๊ะ (ตัดตัว "*" ออกจากตัวหาร · ตัวตั้งรวม ÷ ตัวหารรวม) · เดือนสูตรค้างเป็น warning ไม่ใช่ mismatch', () => {
  const r = parseCsatGrid(grid, { year: 2026 });
  assert.equal(r.totals.computed.overall[1], 100);
  assert.ok(Math.abs(r.totals.computed.overall[2] - 91.6667) < 0.01);   // D 2.5/3 + Q 3/3 = 5.5/6
  assert.ok(Math.abs(r.totals.computed.delivery[2] - 83.3333) < 0.01);
  assert.equal(r.totals.computed.quality[2], 100);
  assert.deepEqual(r.mismatch, []);
  assert.ok(r.warnings.some(w => /เดือน 11.*สูตรค้าง/.test(w)));
  /* ตัวแปรฐานของ ก.พ. — csat_*_actual = Σคะแนน · _total = จำนวนที่ประเมิน (GWM ม.ค. '*' ไม่เข้า) */
  assert.deepEqual(csatBaseVars(r.rows.filter(x => x.month === 1)), { csat_q_actual: 2, csat_q_total: 2, csat_d_actual: 2, csat_d_total: 2 });
  assert.deepEqual(csatBaseVars(r.rows.filter(x => x.month === 2)), { csat_q_actual: 3, csat_q_total: 3, csat_d_actual: 2.5, csat_d_total: 3 });
  assert.deepEqual(csatBaseVars([]), { csat_q_actual: null, csat_q_total: null, csat_d_actual: null, csat_d_total: null });
});

test('pickCsatSheet / parseCsatBook / isCsatSheet / csatFileMeta — ระบุปีแล้วไม่เจอ = null ห้ามหยิบปีอื่น', () => {
  const names = ['3.)Formula_V4(2024)', 'STD FAC. (2024)', '3.)Formula_V4(2026)', 'STD FAC. (2026)', 'TSRA'];
  assert.deepEqual(pickCsatSheet(names), { name: 'STD FAC. (2026)', year: 2026 });
  assert.deepEqual(pickCsatSheet(names, 2024), { name: 'STD FAC. (2024)', year: 2024 });
  assert.equal(pickCsatSheet(names, 2025), null);
  const book = { names: ['STD FAC. (2026)', 'TSRA'], grids: { 'STD FAC. (2026)': grid, TSRA: [['x']] } };
  assert.equal(parseCsatBook(book, { year: 2026 }).rows.length, 12);
  assert.match(parseCsatBook(book, { year: 2025 }).warnings[0], /ไม่มีชีท "STD FAC. \(2025\)"/);
  assert.equal(isCsatSheet(grid), true);
  assert.equal(isCsatSheet([['Item', 'Jan-26'], ['Total Sales', 1]]), false);
  assert.deepEqual(csatFileMeta('TSAT 4 V5 %Customer Satisfaction FY2026 10.Oct - Rev.02.xlsx'), { year: 2026, month: 10, rev: 2 });
  assert.deepEqual(csatFileMeta('whatever.xlsx'), { year: null, month: null, rev: null });
});
