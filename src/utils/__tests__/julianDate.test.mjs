// เทส Julian date ↔ วันที่ปฏิทิน (src/utils/julianDate.js) — pure module import ตรงได้
// รูปแบบจริงของโรงงาน (user ยืนยัน 2026-09-15): DDDYY + ตัวอักษรกะ A(กลางวัน)/B(กลางคืน) · เช่น 24726A
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOfYear, daysInYear, fromDayOfYear, isLeapYear, julianLabel, parseJulianTerm, SHIFT_LETTER, toJulian } from '../julianDate.js';

const TODAY = '2026-09-15';   // = วันที่ 258 ของปี 2026 (2026 ไม่ใช่ปีอธิกสุรทิน)

test('dayOfYear / fromDayOfYear ไป-กลับตรงกันทุกวันของปี (รวมปีอธิกสุรทิน)', () => {
  for (const y of [2024, 2025, 2026]) {
    for (let n = 1; n <= daysInYear(y); n++) {
      assert.equal(dayOfYear(fromDayOfYear(y, n)), n, `${y} วันที่ ${n}`);
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

/* ── รูปแบบจริง: DDDYY (+A/B) ─────────────────────────────────────────── */

test('🔴 ตัวอย่างจริงจากหน้างาน: 24726 = วันที่ 247 ปี 2026 (DDD มาก่อน YY ห้ามสลับ)', () => {
  const j = parseJulianTerm('24726', TODAY);
  assert.equal(j.doy, 247);
  assert.equal(j.year, 2026);
  assert.equal(j.date, '2026-09-04');
  assert.equal(j.guessedYear, false, 'ปีระบุมาแล้ว ไม่ต้องเดา');
  assert.equal(j.shift, null, 'ไม่ได้ใส่ตัวอักษรกะ');
});

test('🔴 กันอ่านสลับเป็น YYDDD — 10026 ต้องได้ "วัน 100 ปี 2026" ไม่ใช่ "ปี 2010 วันที่ 26"', () => {
  const j = parseJulianTerm('10026', TODAY);
  assert.equal(j.doy, 100);
  assert.equal(j.year, 2026);
  assert.equal(j.date, '2026-04-10');
});

test('ตัวอักษรกะ A = กลางวัน · B = กลางคืน (พิมพ์เล็กก็ได้)', () => {
  assert.equal(parseJulianTerm('24726A', TODAY).shift, 'day');
  assert.equal(parseJulianTerm('24726B', TODAY).shift, 'night');
  assert.equal(parseJulianTerm('24726b', TODAY).shift, 'night');
  assert.equal(parseJulianTerm('24726A', TODAY).shiftLetter, 'A');
  assert.equal(parseJulianTerm('24726A', TODAY).date, '2026-09-04', 'ตัวอักษรกะต้องไม่ทำให้วันเพี้ยน');
  assert.deepEqual(SHIFT_LETTER, { day: 'A', night: 'B' });
});

test('ย่อเหลือ 3 หลัก (วันอย่างเดียว) = เดาปี "ครั้งล่าสุดที่ผ่านมาแล้ว" + ต้องมีปีอื่นให้เลือก', () => {
  const past = parseJulianTerm('247', TODAY);          // วัน 247 ผ่านมาแล้วในปีนี้
  assert.equal(past.date, '2026-09-04');
  assert.equal(past.guessedYear, true);
  assert.ok(past.candidates.length >= 2, 'เดาปี = ต้องเสนอปีอื่นให้กดเปลี่ยน');

  const future = parseJulianTerm('300', TODAY);        // วัน 300 ของปีนี้ยังไม่ถึง → ต้องเป็นปีก่อน
  assert.equal(future.year, 2025, 'วันที่ยังไม่ถึงในปีนี้ ต้องตีเป็นปีก่อน ไม่ใช่อนาคต');
  assert.equal(future.date, '2025-10-27');

  assert.equal(parseJulianTerm('247B', TODAY).shift, 'night', '3 หลัก + กะ ก็ต้องได้');
});

test('parseJulianTerm: ของที่ไม่ใช่ Julian ต้องคืน null — ห้ามไปชนกับการค้น MAT/prod_no', () => {
  assert.equal(parseJulianTerm('10100385', TODAY), null, 'เลข MAT SAP 8 หลัก');
  assert.equal(parseJulianTerm('90031601', TODAY), null);
  assert.equal(parseJulianTerm('MANUAL-260821-202550-SCP', TODAY), null);
  assert.equal(parseJulianTerm('6258', TODAY), null, '4 หลักไม่ใช่รูปแบบของที่นี่');
  assert.equal(parseJulianTerm('12', TODAY), null, 'สั้นเกิน');
  assert.equal(parseJulianTerm('123456', TODAY), null, 'ยาวเกิน');
  assert.equal(parseJulianTerm('24726C', TODAY), null, 'มีแค่กะ A/B');
  assert.equal(parseJulianTerm('REINF', TODAY), null);
  assert.equal(parseJulianTerm('', TODAY), null);
  assert.equal(parseJulianTerm(null, TODAY), null);
  assert.equal(parseJulianTerm('000', TODAY), null, 'วันที่ 0 ไม่มีจริง');
  assert.equal(parseJulianTerm('36726', TODAY), null, 'เกิน 366');
});

test('366 ของปีที่ไม่ใช่อธิกสุรทิน = null · ของปีอธิกสุรทิน = ผ่าน', () => {
  assert.equal(parseJulianTerm('36626', TODAY), null, '2026 ไม่มีวันที่ 366');
  assert.equal(parseJulianTerm('36624', TODAY).date, '2024-12-31');
});

test('ตัดช่องว่าง/ขีดหัวท้ายให้ (สแกนมาแล้วมีขยะติดมา)', () => {
  assert.equal(parseJulianTerm('  24726 ', TODAY).date, '2026-09-04');
  assert.equal(parseJulianTerm('-247-', TODAY).doy, 247);
});

test('toJulian: วันที่ (+กะ) → เลขแบบที่ปั๊มบนชิ้นงาน', () => {
  assert.equal(toJulian('2026-09-04'), '24726');
  assert.equal(toJulian('2026-09-04', 'day'), '24726A');
  assert.equal(toJulian('2026-09-04', 'night'), '24726B');
  assert.equal(toJulian('2026-01-01', 'day'), '00126A', 'ต้องเติม 0 หน้าให้ครบ 3 หลัก');
  assert.equal(toJulian('2024-12-31'), '36624');
  assert.equal(toJulian('ไม่ใช่วันที่'), '');
});

test('julianLabel อ่านรู้เรื่อง + บอกกะเมื่อระบุมา', () => {
  assert.equal(julianLabel(parseJulianTerm('24726', TODAY)), 'Julian 24726 = วันที่ 247 ปี 2026');
  assert.equal(julianLabel(parseJulianTerm('24726A', TODAY)), 'Julian 24726A = วันที่ 247 ปี 2026 · กะกลางวัน');
  assert.equal(julianLabel(parseJulianTerm('24726B', TODAY)), 'Julian 24726B = วันที่ 247 ปี 2026 · กะกลางคืน');
  assert.equal(julianLabel(parseJulianTerm('247', TODAY)), 'Julian 247 = วันที่ 247 ปี 2026');
  assert.equal(julianLabel(null), '');
});

test('ไป-กลับ: toJulian แล้ว parse กลับต้องได้วัน+กะเดิมเสมอ', () => {
  for (const iso of ['2026-01-01', '2026-09-04', '2025-12-31', '2024-02-29']) {
    for (const sh of [undefined, 'day', 'night']) {
      const back = parseJulianTerm(toJulian(iso, sh), TODAY);
      assert.equal(back.date, iso, `${iso} ${sh || '-'}`);
      assert.equal(back.shift, sh || null);
    }
  }
});
