/* Excel export ใบ MO + กริดใบพิมพ์ — ข้อ A8 ประชุม 02/11 "IO ขึ้นขาด PR ขึ้นเกิน" (03/11) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MO_EXPORT_COLS, moExportHeaders, moExportWidths, moExportCells, DASH } from '../mtnMoExportCols.js';
import { moGridChars, MO_IO_DIGITS, MO_PR_DIGITS } from '../mtnMoForm.js';
import { prNumbersOf } from '../mtnPurchase.js';

const row = (o, extra = {}) => ({
  o: { id: 'a1', mo_no: 'MTN2611-0001', status: 'pending', ...o },
  date: '2026-11-02', open: true, group: 'ไฟฟ้า', chara: 'มอเตอร์ไหม้', respMin: null, fixMin: null,
  planned: false, vague: false, ...extra,
});

test('หัวตาราง · ความกว้าง · ค่า ยาวเท่ากันทุกแถว (หัวกับค่าเลื่อนกันไม่ได้)', () => {
  const H = moExportHeaders();
  assert.equal(moExportWidths().length, H.length);
  assert.equal(new Set(H).size, H.length, 'หัวตารางห้ามซ้ำ');
  assert.equal(new Set(MO_EXPORT_COLS.map(c => c.key)).size, H.length, 'key ห้ามซ้ำ');
  const cells = moExportCells(row({}));
  assert.equal(cells.length, H.length);
  cells.forEach((c, i) => assert.equal(c.h, H[i], `ช่อง ${i} ต้องตรงหัว`));
  for (const w of moExportWidths()) assert.ok(Number.isFinite(w) && w > 0);
});

test('มีคอลัมน์ I/O และอ่านจาก io_no ตรงตำแหน่ง · เลข PR อยู่คอลัมน์ของตัวเอง', () => {
  const H = moExportHeaders();
  const io = H.indexOf('I/O'), pr = H.indexOf('เลข PR');
  assert.ok(io >= 0, 'ต้องมีคอลัมน์ I/O');
  assert.ok(pr >= 0);
  const cells = moExportCells(row({ io_no: '215031002307', pr_no: null }), {
    prsBy: { a1: [{ order_id: 'a1', pr_no: '1210104217', status: 'requested' }] },
  });
  assert.equal(cells[io].value, '215031002307', 'I/O ทั้ง 12 หลัก เป็นข้อความ');
  assert.equal(typeof cells[io].value, 'string', 'ห้ามส่งเป็น number (Excel โชว์ 2.15E+11)');
  assert.equal(cells[io].opt.numFmt, '@');
  assert.equal(cells[pr].value, '1210104217');
  // ไม่มีช่องอื่นถือเลข I/O หรือเลข PR
  cells.forEach((c, i) => {
    if (i !== io) assert.notEqual(c.value, '215031002307', `I/O หลุดไปช่อง ${c.h}`);
    if (i !== pr) assert.notEqual(c.value, '1210104217', `PR หลุดไปช่อง ${c.h}`);
  });
});

test('I/O ว่าง = ขีด (ไม่ใช่ 0/ว่างเหมือนไม่มีคอลัมน์) · โหลด PR ล้ม = เขียนกำกับ', () => {
  const H = moExportHeaders();
  const cells = moExportCells(row({ io_no: null }), { prsError: 'timeout' });
  assert.equal(cells[H.indexOf('I/O')].value, DASH);
  assert.match(String(cells[H.indexOf('เลข PR')].value), /โหลดเลข PR ไม่สำเร็จ/);
});

test('เลข PR ซ้ำต่างรูปแบบ (ช่องในใบกรอกมือ vs ใบขอซื้อ) ขึ้นครั้งเดียว', () => {
  const o = { id: 'a1', pr_no: '1210 104217' };
  assert.deepEqual(prNumbersOf(o, [{ order_id: 'a1', pr_no: '1210104217', status: 'ordered' }]), ['1210 104217']);
  assert.deepEqual(prNumbersOf({ id: 'a1', pr_no: 'pr2610-test' }, [{ order_id: 'a1', pr_no: 'PR2610-TEST' }]), ['pr2610-test']);
  // คนละเลข = ยังขึ้นครบ · ใบยกเลิกไม่นับ
  assert.deepEqual(prNumbersOf({ id: 'a1' }, [
    { order_id: 'a1', pr_no: '1210104217' }, { order_id: 'a1', pr_no: '1210104218' },
    { order_id: 'a1', pr_no: '1210104219', status: 'cancelled' },
  ]), ['1210104217', '1210104218']);
});

test('ทุกฟิลด์ที่คอลัมน์ Excel อ่าน ต้องอยู่ในคิวรีลิสต์ MO_LIST_COLS (ไม่ select = ขีดทั้งคอลัมน์เงียบๆ)', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('../../../', import.meta.url).pathname;
  const cols = readFileSync(`${root}src/utils/mtnMoExportCols.js`, 'utf8');
  const page = readFileSync(`${root}src/pages/MtnRepair.jsx`, 'utf8');
  const m = page.match(/const MO_LIST_COLS = \[([\s\S]*?)\]\.join/);
  assert.ok(m, 'หา MO_LIST_COLS ไม่เจอ');
  const listCols = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
  const used = new Set([...cols.matchAll(/r\.o\.([a-z_]+)/g)].map(x => x[1]));
  assert.ok(used.has('io_no'));
  for (const f of used) assert.ok(listCols.has(f), `คอลัมน์ Excel อ่าน ${f} แต่ MO_LIST_COLS ไม่ได้ select`);
  // ตัวทำไฟล์ต้องวนจากทะเบียน ห้ามกลับไป put รายคอลัมน์ (หัว/ค่าเลื่อนกัน = บั๊ก A8)
  const xl = readFileSync(`${root}src/lib/mtnMoExportExcel.js`, 'utf8');
  assert.ok(/moExportCells\(/.test(xl) && /moExportHeaders\(/.test(xl) && /moExportWidths\(/.test(xl));
});

test('กริดใบพิมพ์: I/O 12 ช่อง · PR 10 ช่อง · ค่ายาวกว่าช่อง = งอกช่อง ไม่ตัดทิ้ง', () => {
  assert.equal(MO_IO_DIGITS, 12);
  assert.equal(MO_PR_DIGITS, 10);
  assert.deepEqual(moGridChars('215031002307', MO_IO_DIGITS).join(''), '215031002307');
  assert.equal(moGridChars('215031002307', MO_IO_DIGITS).length, 12);
  const pr = moGridChars('1210104217', MO_PR_DIGITS);
  assert.equal(pr.length, 10, 'PR SAP 10 หลัก = 10 ช่องพอดี ไม่มีช่องเกิน');
  assert.ok(pr.every(Boolean));
  const long = moGridChars('PR2610-TEST', MO_PR_DIGITS);
  assert.equal(long.join(''), 'PR2610-TEST', 'ค่ายาวกว่าช่องห้ามหาย');
  assert.equal(moGridChars(null, 10).length, 10);
  assert.ok(moGridChars('', 10).every(c => c === ''));
});
