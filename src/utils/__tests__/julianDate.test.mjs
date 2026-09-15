// เทส Julian date ↔ วันที่ปฏิทิน (src/utils/julianDate.js) — pure module import ตรงได้
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOfYear, daysInYear, fromDayOfYear, isLeapYear, julianLabel, parseJulianTerm, toJulian } from '../julianDate.js';

const TODAY = '2026-09-15';   // = วันที่ 258 ของปี 2026 (2026 ไม่ใช่ปีอธิกสุรทิน)

test('dayOfYear / fromDayOfYear ไป-กลับตรงกันทุกวันของปี (รวมปีอธิกสุรทิน)', () => {
  for (const y of [2024, 2025, 2026]) {
    for (let n = 1; n <= daysInYear(y); n++) {
      const iso = fromDayOfYear(y, n);
      assert.equal(dayOfYear(iso), n, `${y} วันที่ ${n} → ${iso}`);
    }
  }
});

test('ปีอธิกสุรทิน: 2024 มี 366 วัน · 2025/2026 มี 365 · 2100 ไม่ใช่ (หาร 100 ลงตัวแต่ไม่ลง 400)', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2025), false);
  assert.equal(isLeapYear(2100), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(fromDayOfYear(2026, 366), null, 'ปีไม่อธิกสุรทินไม่มีวันที่ 366');
  assert.equal(fromDayOfYear(2024, 366), '2024-12-31');
});

test('dayOfYear: วันที่ไม่มีจริง/รูปแบบผิด = null (ห้ามคืนค่ามั่ว)', () => {
  assert.equal(dayOfYear('2026-02-31'), null);
  assert.equal(dayOfYear('2026-13-01'), null);
  assert.equal(dayOfYear('15/09/2026'), null);
  assert.equal(dayOfYear(''), null);
  assert.equal(dayOfYear(null), null);
});

test('toJulian: วันเดียวกันออกได้ 3 รูปแบบตามจำนวนหลักที่ขอ', () => {
  assert.equal(toJulian('2026-09-15', 3), '258');
  assert.equal(toJulian('2026-09-15', 4), '6258');
  assert.equal(toJulian('2026-09-15', 5), '26258');
  assert.equal(toJulian('2026-01-01', 3), '001', 'ต้องเติม 0 หน้าให้ครบ 3 หลัก');
  assert.equal(toJulian('2026-01-01', 5), '26001');
  assert.equal(toJulian('ไม่ใช่วันที่', 5), '');
});

test('parseJulianTerm 5 หลัก = ปีระบุชัด ไม่ต้องเดา', () => {
  const j = parseJulianTerm('26258', TODAY);
  assert.equal(j.date, '2026-09-15');
  assert.equal(j.year, 2026);
  assert.equal(j.doy, 258);
  assert.equal(j.digits, 5);
  assert.equal(j.guessedYear, false);
});

test('parseJulianTerm 4 หลัก = หลักแรกคือเลขท้ายปี → คลี่เป็นปีจริง + เสนอรอบ 10 ปีก่อนไว้ด้วย', () => {
  const j = parseJulianTerm('6258', TODAY);
  assert.equal(j.date, '2026-09-15');
  assert.equal(j.year, 2026);
  assert.equal(j.guessedYear, true, 'เลขท้ายปีซ้ำทุก 10 ปี = ยังเป็นการเดา');
  assert.ok(j.candidates.some(c => c.year === 2016), 'ต้องเสนอรอบก่อนหน้า (2016) ให้เลือกได้');
  // เลขท้ายปีอื่น
  assert.equal(parseJulianTerm('5001', TODAY).year, 2025);
  assert.equal(parseJulianTerm('5001', TODAY).date, '2025-01-01');
});

test('parseJulianTerm 3 หลัก = เดาปี "ครั้งล่าสุดที่ผ่านมาแล้ว" (สอบกลับมองย้อนหลังเสมอ)', () => {
  const past = parseJulianTerm('258', TODAY);           // = วันนี้พอดี
  assert.equal(past.date, '2026-09-15');
  assert.equal(past.year, 2026);
  assert.equal(past.guessedYear, true);

  const future = parseJulianTerm('300', TODAY);          // วันที่ 300 ของปีนี้ยังไม่ถึง → ต้องเป็นปีก่อน
  assert.equal(future.year, 2025, 'วันที่ยังไม่ถึงในปีนี้ ต้องตีเป็นปีก่อน ไม่ใช่อนาคต');
  assert.equal(future.date, '2025-10-27');
  assert.ok(future.candidates.length >= 2, 'ต้องมีปีอื่นให้เลือกเสมอเพราะเป็นการเดา');
});

test('parseJulianTerm: ของที่ไม่ใช่ Julian ต้องคืน null — ห้ามไปชนกับการค้น MAT/prod_no', () => {
  assert.equal(parseJulianTerm('10100385', TODAY), null, 'เลข MAT SAP 8 หลัก');
  assert.equal(parseJulianTerm('90031601', TODAY), null);
  assert.equal(parseJulianTerm('MANUAL-260821-202550-SCP', TODAY), null);
  assert.equal(parseJulianTerm('12', TODAY), null, 'สั้นเกิน');
  assert.equal(parseJulianTerm('123456', TODAY), null, 'ยาวเกิน');
  assert.equal(parseJulianTerm('REINF', TODAY), null);
  assert.equal(parseJulianTerm('', TODAY), null);
  assert.equal(parseJulianTerm(null, TODAY), null);
  assert.equal(parseJulianTerm('000', TODAY), null, 'วันที่ 0 ไม่มีจริง');
  assert.equal(parseJulianTerm('367', TODAY), null, 'เกิน 366');
  assert.equal(parseJulianTerm('26367', TODAY), null);
});

test('parseJulianTerm: 366 ของปีที่ไม่ใช่อธิกสุรทิน = null · ของปีอธิกสุรทิน = ผ่าน', () => {
  assert.equal(parseJulianTerm('26366', TODAY), null, '2026 ไม่มีวันที่ 366');
  const leap = parseJulianTerm('24366', TODAY);
  assert.equal(leap.date, '2024-12-31');
});

test('parseJulianTerm: ตัดช่องว่าง/ขีดหัวท้ายให้ (สแกนมาแล้วมีขยะติดมา)', () => {
  assert.equal(parseJulianTerm('  26258 ', TODAY).date, '2026-09-15');
  assert.equal(parseJulianTerm('-258-', TODAY).doy, 258);
});

test('julianLabel อ่านรู้เรื่องและตรงกับจำนวนหลักที่พิมพ์มา', () => {
  assert.equal(julianLabel(parseJulianTerm('26258', TODAY)), 'Julian 26258 = วันที่ 258 ของปี 2026');
  assert.equal(julianLabel(parseJulianTerm('6258', TODAY)), 'Julian 6258 = วันที่ 258 ของปี 2026');
  assert.equal(julianLabel(parseJulianTerm('258', TODAY)), 'Julian 258 = วันที่ 258 ของปี 2026');
  assert.equal(julianLabel(null), '');
});

test('ไป-กลับกับ parse: toJulian แล้ว parse กลับต้องได้วันเดิมทุกหลัก', () => {
  for (const iso of ['2026-01-01', '2026-09-15', '2025-12-31', '2024-02-29']) {
    for (const d of [4, 5]) {   // 3 หลักไม่มีปี = เทียบวันเดิมไม่ได้เสมอ (เดาปี)
      const back = parseJulianTerm(toJulian(iso, d), TODAY);
      assert.equal(back.date, iso, `${iso} ${d} หลัก`);
    }
  }
});
