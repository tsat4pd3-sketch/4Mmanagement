/* ⛔ แถบเครื่องหยุดบนบอร์ด Heijunka (src/utils/downtimeBands.js)
   แต่ละข้อผูกกับกติกาที่ถ้าถอดออกจะเกิดบั๊กจริง — ห้ามลบข้อไหนออก */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downtimeBandsIn, downtimeBandMinutes, DT_BAND_MIN_PCT } from '../downtimeBands.js';

const HALF = 12 * 3600000;
const H0 = Date.UTC(2026, 10, 3, 1, 0, 0);          // 08:00 ไทย
const PCT = 100 / HALF;
const at = (h, m = 0) => H0 + (h * 60 + m) * 60000;  // ชั่วโมงนับจากต้นครึ่งวัน
const W = (fromH, toH, extra = {}) => ({ s: at(fromH), e: at(toH), min: (toH - fromH) * 60, name: 'เครื่องเสีย', ...extra });
const opts = (rowLines = null) => ({ rowLines, halfStartMs: H0, pctPerMs: PCT });

test('วางแถบตามเวลาจริง — เริ่ม 0% ถ้าเริ่มพร้อมครึ่งวัน · กว้างตามนาที', () => {
  const [b] = downtimeBandsIn([W(0, 1)], opts());
  assert.equal(b.leftPct, 0);
  assert.ok(Math.abs(b.widthPct - 100 / 12) < 1e-9);   // 1 ชม. จาก 12 ชม.
});

test('① 🔴 ไม่รู้เวลาเริ่ม/จบ = ข้ามใบนั้น ห้ามเดาจาก duration', () => {
  const rows = [
    { s: null, e: at(2), min: 60, name: 'x' },
    { s: at(1), e: null, min: 60, name: 'x' },
    { s: at(3), e: at(3), min: 0, name: 'x' },          // ยาว 0 = ไม่มีอะไรให้วาด
    { s: at(4), e: at(3), min: 60, name: 'x' },         // จบก่อนเริ่ม = ข้อมูลเพี้ยน
  ];
  assert.deepEqual(downtimeBandsIn(rows, opts()), []);
});

test('② 🔴 ใบสั้น 1-2 นาที ต้องยังเห็น (ความกว้างขั้นต่ำ) — micro-stop ห้ามหายจากจอ', () => {
  const [b] = downtimeBandsIn([{ s: at(2), e: at(2, 1), min: 1, name: 'micro' }], opts());
  assert.ok(b.widthPct >= DT_BAND_MIN_PCT, `${b.widthPct} < ${DT_BAND_MIN_PCT}`);
});

test('② แถบขั้นต่ำที่อยู่ชิดขอบขวา ห้ามล้นออกนอกแถบเวลา', () => {
  const b = downtimeBandsIn([{ s: H0 + HALF - 60000, e: H0 + HALF, min: 1, name: 'ท้ายกะ' }], opts())[0];
  assert.ok(b.leftPct + b.widthPct <= 100 + 1e-9, `${b.leftPct}+${b.widthPct} > 100`);
});

test('③ 🔴 กรองเฉพาะ sub-line ของแถวนั้น — เหตุของไลน์ข้างๆ ห้ามมาโผล่เป็นเหตุของแถวนี้', () => {
  const rows = [W(1, 2, { line_name: 'Line 60' }), W(3, 4, { line_name: 'Line 61' })];
  const got = downtimeBandsIn(rows, opts(new Set(['Line 60'])));
  assert.equal(got.length, 1);
  assert.equal(got[0].w.line_name, 'Line 60');
});

test('③ rowLines ว่าง = แสดงทุกรายการ (แถวที่ไม่มีใบงาน เห็นครบดีกว่าหายเงียบ)', () => {
  const rows = [W(1, 2, { line_name: 'Line 60' }), W(3, 4, { line_name: 'Line 61' })];
  assert.equal(downtimeBandsIn(rows, opts(new Set())).length, 2);
  assert.equal(downtimeBandsIn(rows, opts(null)).length, 2);
  assert.equal(downtimeBandsIn(rows, opts([])).length, 2);
});

test('③ ใบที่ไม่รู้ไลน์ (line_name ว่าง) ห้ามถูกกรองออก — ของกลางของไลน์ก็หยุดทั้งไลน์', () => {
  const got = downtimeBandsIn([W(1, 2, { line_name: null })], opts(new Set(['Line 60'])));
  assert.equal(got.length, 1);
});

test('คลิปขอบครึ่งวัน — คร่อมเข้ามาจากกะก่อน/ล้นไปกะหน้า ต้องถูกตัด ไม่ใช่หาย', () => {
  const inFromBefore = downtimeBandsIn([{ s: H0 - 3600000, e: at(1), min: 120, name: 'คร่อม' }], opts())[0];
  assert.equal(inFromBefore.leftPct, 0);
  assert.ok(inFromBefore.widthPct > 0);
  const outToNext = downtimeBandsIn([{ s: H0 + HALF - 1800000, e: H0 + HALF + 3600000, min: 90, name: 'คร่อม' }], opts())[0];
  assert.ok(outToNext.leftPct + outToNext.widthPct <= 100 + 1e-9);
  /* อยู่นอกครึ่งวันนี้ทั้งก้อน = ไม่วาด (ไม่ใช่ยัดไว้ที่ขอบ) */
  assert.deepEqual(downtimeBandsIn([{ s: H0 + HALF + 60000, e: H0 + HALF + 120000, min: 1, name: 'กะหน้า' }], opts()), []);
  assert.deepEqual(downtimeBandsIn([{ s: H0 - 7200000, e: H0 - 3600000, min: 60, name: 'กะก่อน' }], opts()), []);
});

test('เรียงตามเวลาเริ่มเสมอ (อ่านไล่ซ้าย→ขวาได้)', () => {
  const got = downtimeBandsIn([W(5, 6), W(1, 2), W(3, 4)], opts());
  assert.deepEqual(got.map(b => b.w.s), [at(1), at(3), at(5)]);
});

test('🔴 พารามิเตอร์ไม่ครบ = คืนว่าง ห้ามพ่น NaN ลงจอ', () => {
  assert.deepEqual(downtimeBandsIn([W(1, 2)], { halfStartMs: H0 }), []);
  assert.deepEqual(downtimeBandsIn([W(1, 2)], { pctPerMs: PCT }), []);
  assert.deepEqual(downtimeBandsIn([W(1, 2)], { halfStartMs: H0, pctPerMs: 0 }), []);
  assert.deepEqual(downtimeBandsIn(null, opts()), []);
});

test('นาทีรวม — ใช้ min ที่กรอกไว้ ถ้าไม่มีคิดจากช่วงเวลา (เคสจริง Assy GOR 03/11 = 180 นาที)', () => {
  /* ใบจริงของกะนั้น: 08:00-08:30 (30) · 08:30-08:40 (10) · 08:40-09:30 (50) ·
     09:34-10:00 (26) · 13:42-14:00 (18) · 14:00-14:46 (46) = 180 นาที */
  const real = [
    { s: at(0, 0), e: at(0, 30), min: 30, name: 'เปลี่ยนหัว Tip' },
    { s: at(0, 30), e: at(0, 40), min: 10, name: 'ไม่ระบุ' },
    { s: at(0, 40), e: at(1, 30), min: 50, name: 'ทิชโรบอท' },
    { s: at(1, 34), e: at(2, 0), min: 26, name: 'Prox ไม่จับชิ้นงาน' },
    { s: at(5, 42), e: at(6, 0), min: 18, name: 'Alarm Clamp 3' },
    { s: at(6, 0), e: at(6, 46), min: 46, name: 'Senser ไม่จับชิ้นงาน' },
  ];
  assert.equal(downtimeBandMinutes(downtimeBandsIn(real, opts())), 180);
  assert.equal(downtimeBandMinutes([{ w: { s: at(1), e: at(2) } }]), 60);   // ไม่มี min = คิดจากช่วง
  assert.equal(downtimeBandMinutes([]), 0);
});
