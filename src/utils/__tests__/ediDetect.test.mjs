/* กัน "ไฟล์ EDI ถูกอ่านผิดชนิด/หาไม่เจอ แล้วของหายทั้งลูกค้า" (2026-09-17 · AAT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normHdr, colIdx, isEdiHeaderRow, detectEdiKind, dateSpanDays, EDI_SIG } from '../ediDetect.js';

const H862 = ['Part Num', 'Forecast Net Qty', 'Forecast Date', 'Forecast Time', 'Dock Code', 'Ship To GSDB Code'];
const H830 = ['Part Num', 'Forecast Net Qty', 'Forecast Date', 'Ship To GSDB Code'];

test('normHdr ตัดช่องว่าง/ขีด/ตัวพิมพ์', () => {
  assert.equal(normHdr(' forecast_time '), 'FORECASTTIME');
  assert.equal(normHdr('Forecast-Time'), 'FORECASTTIME');
  assert.equal(normHdr(null), '');
});

test('หัวตาราง EDI — ชื่อเพี้ยนต้องยังเจอ (เดิมเทียบตรงตัวแล้วตกไปทาง manual เงียบ)', () => {
  assert.ok(isEdiHeaderRow(H862));
  assert.ok(isEdiHeaderRow([' part_num ', 'FORECAST NET QTY', 'Forecast-Date']));
  assert.ok(isEdiHeaderRow(['Part Number', 'Net Qty', 'Ship Date']));
  assert.equal(isEdiHeaderRow(['ชื่อ', 'จำนวน']), false);
});

test('colIdx หาเจอจากชื่อทางเลือก · ไม่เจอ = -1', () => {
  assert.equal(colIdx(H862, EDI_SIG[0]), 0);
  assert.equal(colIdx(H862, ['Dock Code', 'Dock']), 4);
  assert.equal(colIdx(H830, ['Forecast Time']), -1);
});

test('862 — มีคอลัมน์เวลาและมีค่าจริง = ชัด', () => {
  const r = detectEdiKind(H862, [['P1', 10, '2026-09-17', '08:00', 'B5', 'GRBNA']]);
  assert.equal(r.is862, true);
  assert.equal(r.sure, true);
});

test('🔴 มีคอลัมน์เวลาแต่ว่างทุกแถว = ไม่ชัด → จอต้องบังคับให้คนยืนยัน', () => {
  const r = detectEdiKind(H862, [['P1', 10, '2026-09-17', '', '', 'GRBNA']]);
  assert.equal(r.sure, false);
});

test('830 — ไม่มีเวลา + วันที่ยิงยาวข้ามปี = ชัดว่า forecast', () => {
  const r = detectEdiKind(H830, [['P1', 10, '2026-08-17'], ['P1', 10, '2027-09-13']]);
  assert.equal(r.is862, false);
  assert.equal(r.sure, true);
  assert.match(r.reason, /392 วัน/);
});

test('🔴 ไม่มีเวลา ไม่มีท่า ช่วงวันสั้น = ไม่ชัด ห้ามเดาเงียบ', () => {
  const r = detectEdiKind(H830, [['P1', 10, '2026-09-17'], ['P1', 10, '2026-09-20']]);
  assert.equal(r.sure, false);
});

test('ไม่มีคอลัมน์เวลา แต่มี Dock Code ที่มีค่า = เอนไปทาง 862 (แต่ยังไม่ชัด)', () => {
  const h = ['Part Num', 'Forecast Net Qty', 'Forecast Date', 'Dock Code'];
  const r = detectEdiKind(h, [['P1', 10, '2026-09-17', 'B5']]);
  assert.equal(r.is862, true);
  assert.equal(r.sure, false);
});

test('dateSpanDays อ่านได้ทั้ง Date และข้อความ · อ่านไม่ได้ = null', () => {
  assert.equal(dateSpanDays([[0, 0, new Date(2026, 8, 1)], [0, 0, new Date(2026, 8, 11)]], 2), 10);
  assert.equal(dateSpanDays([[0, 0, '2026-09-01'], [0, 0, '2026-09-11']], 2), 10);
  assert.equal(dateSpanDays([[0, 0, 'ไม่ใช่วันที่']], 2), null);
  assert.equal(dateSpanDays([], -1), null);
});

/* ── ไฟล์จริง: 1 เล่ม หลายชีต ชีตละ ship-to (862_15.09.26.xlsm · 2026-09-17) ───────
   เคสจริงที่ทำให้ออเดอร์ AAT หายทั้งลูกค้า — โค้ดเดิมอ่านชีตแรกชีตเดียวแล้ว return */
test('🔴 หาชีต EDI ต้องได้ครบทุกชีต ไม่ใช่ชีตแรกชีตเดียว', () => {
  const H = ['Part Num', 'Forecast Net Qty', 'Forecast Date', 'Forecast Time', 'Ship To GSDB Code'];
  const book = {
    Summary: [['Audit Report Summary'], ['Audit Date & Time: 2026-09-15']],
    GBL9A: [['862', 'Shipping Schedule'], H, ['P1', 10, 20260915, 0.375, 'GBL9A']],
    GRBNA: [['862', 'Shipping Schedule'], H, ['P2', 20, 20260915, 0.375, 'GRBNA']],
    HPUDA: [['862', 'Shipping Schedule'], H, ['P3', 30, 20260915, 0.5, 'HPUDA']],
    Database: [['Part Num', 'Purchase Order Num', 'Dock Code', 'Customer']],
  };
  const hits = [];
  for (const [name, m] of Object.entries(book)) {
    for (let i = 0; i < Math.min(m.length, 20); i++) {
      if (isEdiHeaderRow(m[i].map(c => String(c).trim()))) { hits.push(name); break; }
    }
  }
  assert.deepEqual(hits, ['GBL9A', 'GRBNA', 'HPUDA'], 'ต้องเจอ 3 ชีต และไม่กินชีต Summary/Database');
});

test('ชีตที่คอลัมน์เวลาว่างทุกแถว = ไม่ชัด — แต่ชีตที่ชัดในเล่มเดียวกันต้องชนะ', () => {
  const H = ['Part Num', 'Forecast Net Qty', 'Forecast Date', 'Forecast Time'];
  const blank = detectEdiKind(H, [['P1', 10, 20260915, '']]);
  const real = detectEdiKind(H, [['P2', 20, 20260915, 0.375]]);
  assert.equal(blank.sure, false);
  assert.equal(real.sure, true);
  // กติกาที่หน้าจอใช้: หยิบชีตแรกที่ sure แล้วใช้ชนิดนั้นทั้งไฟล์
  const sheets = [{ kind: blank, is862: blank.is862 }, { kind: real, is862: real.is862 }];
  const sureOne = sheets.find(f => f.kind.sure);
  assert.equal(sureOne.is862, true);
});

/* ═══ 🧩 พจนานุกรมจากทะเบียน `customer_pull_formats` (kind = order/forecast) — 2026-09-22 ═══
   ที่มา: ลูกค้าเจ้าอื่นส่ง Excel/CSV คนละหน้าตากับ Ford ⇒ 72/115 พาร์ทไม่มีความต้องการในระบบ
   กติกา: ทะเบียน **เพิ่ม** ชื่อคอลัมน์ ไม่ใช่ **แทนที่** ค่าสำรอง (ไฟล์ Ford ต้องอ่านได้เหมือนเดิมเสมอ) */
import { buildEdiDict, sigOf, FALLBACK_EDI_DICT } from '../ediDetect.js';

const TSRA_FMT = {
  code: 'tsra_order', kind: 'order', is_active: true,
  col_map: {
    part: ['รหัสสินค้า', 'Item Code'],
    qty:  ['จำนวนสั่ง'],
    date: ['กำหนดส่ง'],
    time: ['เวลานัด'],
  },
};

test('ทะเบียนว่าง = ได้ค่าสำรองในโค้ดเป๊ะ (ไฟล์ Ford อ่านได้เหมือนเดิม)', () => {
  const { dict, fromDb } = buildEdiDict([]);
  assert.equal(fromDb, 0);
  assert.deepEqual(dict, FALLBACK_EDI_DICT);
  assert.ok(isEdiHeaderRow(H862, dict));
});

test('เพิ่มลูกค้าใหม่ในทะเบียน = อ่านหัวคอลัมน์ภาษาไทยของเจ้านั้นออก โดยของ Ford ยังอ่านได้', () => {
  const { dict, fromDb } = buildEdiDict([TSRA_FMT]);
  assert.equal(fromDb, 1);
  assert.ok(isEdiHeaderRow(['รหัสสินค้า', 'จำนวนสั่ง', 'กำหนดส่ง', 'เวลานัด'], dict), 'ไฟล์ TSRA ต้องอ่านออก');
  assert.ok(isEdiHeaderRow(H862, dict), 'ไฟล์ Ford ต้องยังอ่านออก (ทะเบียนเพิ่ม ไม่ใช่แทนที่)');
  assert.ok(isEdiHeaderRow(H830, dict));
});

test('ไฟล์ลูกค้าใหม่ที่มีคอลัมน์เวลา ต้องถูกตีเป็นใบสั่งส่ง (862) ไม่ใช่แผนล่วงหน้า', () => {
  const { dict } = buildEdiDict([TSRA_FMT]);
  const H = ['รหัสสินค้า', 'จำนวนสั่ง', 'กำหนดส่ง', 'เวลานัด'];
  const r = detectEdiKind(H, [['P1', 10, '2026-09-22', '08:30']], dict);
  assert.equal(r.is862, true);
  assert.equal(r.sure, true);
});

test('แถวที่ปิดใช้ (is_active=false) ต้องไม่ถูกนับเข้าพจนานุกรม', () => {
  const { dict, fromDb } = buildEdiDict([{ ...TSRA_FMT, is_active: false }]);
  assert.equal(fromDb, 0);
  assert.equal(isEdiHeaderRow(['รหัสสินค้า', 'จำนวนสั่ง', 'กำหนดส่ง'], dict), false);
});

test('ชื่อซ้ำกับค่าสำรอง (ต่างแค่ตัวพิมพ์/เว้นวรรค) ต้องไม่ทำพจนานุกรมบวม', () => {
  const { dict } = buildEdiDict([{ code: 'x', is_active: true, col_map: { part: ['part num', 'PART  NUM', 'Part Num'] } }]);
  assert.deepEqual(dict.part, FALLBACK_EDI_DICT.part, 'ทุกตัวคือชื่อเดิมหลัง normalize → ต้องไม่เพิ่มอะไรเลย');
});

test('col_map เพี้ยน (ไม่ใช่ array / ว่าง / null) ต้องไม่พังและไม่เปลี่ยนค่าสำรอง', () => {
  const { dict, fromDb } = buildEdiDict([
    { code: 'a', is_active: true, col_map: null },
    { code: 'b', is_active: true, col_map: { part: 'ไม่ใช่อาร์เรย์' } },
    { code: 'c', is_active: true, col_map: { qty: [] } },
    null,
  ]);
  assert.equal(fromDb, 0);
  assert.deepEqual(dict, FALLBACK_EDI_DICT);
});

test('sigOf = 3 ช่องบังคับเรียง part/qty/date (ลำดับเดิมของ EDI_SIG)', () => {
  const sig = sigOf(FALLBACK_EDI_DICT);
  assert.equal(sig.length, 3);
  assert.deepEqual(sig, EDI_SIG);
});

test('🔴 normHdr ต้องไม่ลดหัวคอลัมน์ภาษาไทยเหลือสตริงว่าง (เดิมจับคู่มั่วข้ามคอลัมน์)', () => {
  assert.notEqual(normHdr('จำนวนสั่ง'), '');
  assert.notEqual(normHdr('จำนวนสั่ง'), normHdr('กำหนดส่ง'), 'คนละคอลัมน์ต้องไม่เท่ากัน');
  // ASCII ต้องได้ผลเหมือนเดิมทุกกรณี (ไฟล์ Ford ห้ามเปลี่ยนพฤติกรรม)
  assert.equal(normHdr(' Forecast_Time '), 'FORECASTTIME');
  assert.equal(normHdr('Part-Num'), 'PARTNUM');
});
