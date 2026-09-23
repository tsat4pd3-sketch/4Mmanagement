import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_SCALES, LOOKBACK_DAYS, scaleOf, addDays, rangeDays, normalizeRange,
  presetRange, matchPreset, isoWeek, weekMonday, bucketKey, bucketLabel, scaleWarning, suggestScale,
  BUCKET_ORDER, TIME_PERIODS, autoBucket, capBucket, stepBucket, nextBucket,
  periodRange, matchPeriod, bkkHourKey, hourAxis, bucketAxis,
} from '../timeRange.js';

/* ⏱️ มาตรฐานกลางของตัวกรองช่วงเวลา — ล็อกพฤติกรรมที่ทุกหน้าต้องเหมือนกัน (2026-09-23)
   ⚠️ ทุกเคสตรึงวันที่เอง **ห้ามอ้าง new Date()** — ไม่งั้นเป็น "เทสระเบิดเวลา"
      (กฎ CLAUDE.md: `npm test` รันรอบนาฬิกา +400 วันด้วย) */

test('ขั้นบันไดมี 5 ระดับ เรียงละเอียด→หยาบ และตรงกับ TIME_SCALES', () => {
  assert.deepEqual(TIME_SCALES.map(s => s.key), ['hour', 'day', 'week', 'month', 'year']);
  assert.deepEqual(TIME_SCALES.map(s => s.key), BUCKET_ORDER, 'ปุ่มบนจอกับบันไดต้องเป็นชุดเดียวกัน');
  for (let i = 1; i < TIME_SCALES.length; i++)
    assert.ok(TIME_SCALES[i].okDays[1] > TIME_SCALES[i - 1].okDays[1], 'ช่วงที่อ่านรู้เรื่องต้องไล่ขึ้น');
  assert.equal(scaleOf('ไม่มีจริง'), null);
});

test('ปุ่มลัดย้อนหลัง = 30/60/90/120 วัน (ชุดที่ user ระบุ)', () => {
  assert.deepEqual(LOOKBACK_DAYS, [30, 60, 90, 120]);
});

test('addDays ข้ามเดือน/ข้ามปี/ปีอธิกสุรทิน', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');   // 2024 อธิกสุรทิน
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('ไม่ใช่วันที่', 1), null);
});

test('🔴 rangeDays นับหัวนับท้าย — วันเดียวกัน = 1 วัน ไม่ใช่ 0', () => {
  assert.equal(rangeDays('2026-09-23', '2026-09-23'), 1);
  assert.equal(rangeDays('2026-08-25', '2026-09-23'), 30);
  assert.equal(rangeDays('ผิด', '2026-09-23'), null);
});

test('🔴 presetRange นับหัวนับท้าย — "ย้อนหลัง 30 วัน" ต้องได้ 30 วันเป๊ะ', () => {
  const r = presetRange(30, '2026-09-23');
  assert.deepEqual(r, { from: '2026-08-25', to: '2026-09-23' });
  assert.equal(rangeDays(r.from, r.to), 30, 'ถ้าได้ 31 แปลว่าลืม -1 (บั๊กคลาสสิกของ daysAgo)');
  for (const d of LOOKBACK_DAYS) {
    const x = presetRange(d, '2026-09-23');
    assert.equal(rangeDays(x.from, x.to), d, `ปุ่ม ${d} วัน ต้องได้ ${d} วันเป๊ะ`);
  }
  assert.equal(presetRange(0, '2026-09-23'), null);
  assert.equal(presetRange(30, 'ผิด'), null);
});

test('normalizeRange สลับให้เมื่อคนเลือกกลับด้าน (ห้ามคืนช่วงว่างเงียบๆ)', () => {
  assert.deepEqual(normalizeRange('2026-09-23', '2026-08-25'),
    { from: '2026-08-25', to: '2026-09-23', swapped: true });
  assert.deepEqual(normalizeRange('2026-08-25', '2026-09-23'),
    { from: '2026-08-25', to: '2026-09-23', swapped: false });
});

test('matchPreset ไฮไลต์ปุ่มเฉพาะช่วงที่จบ "วันนี้" และตรงเป๊ะ', () => {
  assert.equal(matchPreset('2026-08-25', '2026-09-23', '2026-09-23'), 30);
  assert.equal(matchPreset('2026-08-26', '2026-09-23', '2026-09-23'), null, '29 วัน ไม่ใช่ปุ่มไหน');
  assert.equal(matchPreset('2026-08-24', '2026-09-22', '2026-09-23'), null, 'ไม่จบวันนี้ = ไม่ใช่ปุ่มลัด');
});

test('🔴 isoWeek ใช้กติกา ISO-8601 (จันทร์ขึ้นต้น · สัปดาห์ที่มี 4 ม.ค. = W01)', () => {
  // 2026-01-01 = พฤหัส ⇒ เป็นสัปดาห์ที่ 1 ของปี 2026 (สัปดาห์นั้นมี 4 ม.ค. อยู่ด้วย)
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
  // 2027-01-01 = ศุกร์ ⇒ ยังนับเป็นสัปดาห์ที่ 53 ของ **ปี 2026** ตามกติกา ISO
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
  // จันทร์ถึงอาทิตย์ของสัปดาห์เดียวกันต้องได้คีย์เดียวกัน
  assert.deepEqual(isoWeek('2026-09-21'), isoWeek('2026-09-27'));
  assert.deepEqual(isoWeek('2026-09-21'), { year: 2026, week: 39 });
  assert.notDeepEqual(isoWeek('2026-09-27'), isoWeek('2026-09-28'), 'จันทร์ = ขึ้นสัปดาห์ใหม่');
  /* 🔴 เคสที่เคยพลาดจริง 23/09: ใส่ออฟเซ็ต +4 แทน +3 (1970-01-01 = พฤหัส ไม่ใช่ศุกร์)
     ⇒ เพี้ยนไป 1 สัปดาห์ทั้งระบบ · เทียบกับอัลกอริทึมอ้างอิงครบทุกวัน 2019-2031 แล้วตรง 4,748/4,748 */
  assert.deepEqual(isoWeek('2026-12-31'), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek('2026-01-05'), { year: 2026, week: 2 });
});

test('bucketKey เรียงตามตัวอักษรแล้วได้ลำดับเวลาถูกเสมอ', () => {
  assert.equal(bucketKey('2026-09-23', 'day'), '2026-09-23');
  assert.equal(bucketKey('2026-09-23', 'week'), '2026-09-21', 'คีย์สัปดาห์ = วันจันทร์');
  assert.equal(bucketKey('2026-09-23', 'month'), '2026-09');
  assert.equal(bucketKey('2026-09-23', 'year'), '2026');
  const keys = ['2026-01-05', '2026-09-23', '2026-12-31'].map(d => bucketKey(d, 'week'));
  assert.deepEqual([...keys].sort(), keys, 'คีย์สัปดาห์ต้อง sort ตรงๆ ได้');
  // ทุกวันในสัปดาห์เดียวกันต้องได้คีย์เดียวกัน (จันทร์ถึงอาทิตย์)
  const wk = ['2026-09-21','2026-09-23','2026-09-27'].map(d => bucketKey(d,'week'));
  assert.deepEqual(wk, ['2026-09-21','2026-09-21','2026-09-21']);
  assert.equal(bucketKey('2026-09-28','week'), '2026-09-28', 'จันทร์ถัดไป = คีย์ใหม่');
  assert.equal(weekMonday('2026-09-27'), '2026-09-21');
  assert.equal(bucketKey('2026-09-23', 'ไม่รู้จัก'), null);
});

test('bucketLabel สั้นพอสำหรับแกน X และปีเป็น พ.ศ.', () => {
  assert.equal(bucketLabel('2026-09-23', 'day'), '23/9', 'ตัดเลข 0 นำหน้า (แกน X แคบ)');
  assert.equal(bucketLabel('2026-09-21', 'week'), '21–27/9', 'เดือนเดียวกัน = ย่อ');
  assert.equal(bucketLabel('2026-07-29', 'week'), '29/7–4/8', 'คร่อมเดือน = เขียนเต็ม');
  assert.equal(bucketLabel('2026-09', 'month'), 'ก.ย. 69');
  assert.equal(bucketLabel('2026', 'year'), '2569');
});

test('🔴 scaleWarning เตือนเมื่อสเกลไม่เข้ากับช่วง (เตือนเท่านั้น — จอห้ามบล็อก)', () => {
  assert.ok(scaleWarning('year', '2026-08-25', '2026-09-23'), 'รายปี บน 30 วัน = แท่งเดียว ต้องเตือน');
  assert.ok(scaleWarning('day', '2024-09-23', '2026-09-23'), 'รายวัน บน 2 ปี = 730 แท่ง ต้องเตือน');
  assert.equal(scaleWarning('day', '2026-08-25', '2026-09-23'), null, 'รายวัน บน 30 วัน = พอดี');
  assert.equal(scaleWarning('month', '2025-09-23', '2026-09-23'), null, 'รายเดือน บน 1 ปี = พอดี');
});

test('suggestScale เลือกสเกลที่พอดีกับช่วง', () => {
  assert.equal(suggestScale('2026-09-01', '2026-09-23'), 'day');
  assert.equal(suggestScale('2025-09-23', '2026-09-23'), 'week');
  assert.equal(suggestScale('2021-09-23', '2026-09-23'), 'month');
});

/* ══ 🪜 บันไดความละเอียด — "ดูช่วงไหน ⇒ แท่งเล็กกว่า 1 ขั้น" (2026-09-23 · คำสั่ง user) ══ */

test('🪜 ปุ่มช่วงล็อกขนาดแท่งไว้ 1 ขั้นเสมอ (วัน→ชั่วโมง · สัปดาห์/เดือน→วัน · ปี→เดือน · หลายปี→ปี)', () => {
  const m = Object.fromEntries(TIME_PERIODS.map(p => [p.key, p.bucket]));
  assert.deepEqual(m, { day: 'hour', week: 'day', month: 'day', year: 'month', multi: 'year' });
});

test('🪜 ปุ่มช่วงตัดปลายที่ "วันนี้" ไม่ลากไปอนาคต (แท่งว่างอ่านเป็น "ผลิตได้ 0")', () => {
  const today = '2026-09-23';                       // พุธ
  assert.deepEqual(periodRange('day', today), { from: today, to: today });
  assert.deepEqual(periodRange('week', today), { from: '2026-09-21', to: today }, 'จันทร์ของสัปดาห์นี้');
  assert.deepEqual(periodRange('month', today), { from: '2026-09-01', to: today });
  assert.deepEqual(periodRange('year', today), { from: '2026-01-01', to: today });
  assert.deepEqual(periodRange('multi', today), { from: '2024-01-01', to: today }, '3 ปีปฏิทิน');
  assert.equal(periodRange('month', 'พัง'), null);
  assert.equal(matchPeriod('2026-09-01', today, today), 'month');
  assert.equal(matchPeriod('2026-09-02', today, today), null, 'ไม่ตรงเป๊ะ = ไม่ไฮไลต์ปุ่ม');
});

test('🪜 ช่วงที่พิมพ์วันเอง → autoBucket ตัดสินจากจำนวนวัน (7–60 แท่ง)', () => {
  assert.equal(autoBucket('2026-09-23', '2026-09-23'), 'hour');
  assert.equal(autoBucket('2026-09-22', '2026-09-23'), 'hour', '2 วัน (48 แท่ง) ยังเป็นชั่วโมง');
  assert.equal(autoBucket('2026-09-21', '2026-09-23'), 'day', '3 วันขึ้นไป = รายวัน (72 แท่งอ่านไม่ออก)');
  assert.equal(autoBucket('2026-09-01', '2026-09-23'), 'day');
  assert.equal(autoBucket('2026-06-25', '2026-09-23'), 'week', 'ปุ่มย้อนหลัง 90 วัน = 13 แท่ง');
  assert.equal(autoBucket('2025-09-23', '2026-09-23'), 'week');
  assert.equal(autoBucket('2023-09-23', '2026-09-23'), 'month');
  assert.equal(autoBucket('2015-09-23', '2026-09-23'), 'year');
  assert.equal(autoBucket(null, null), 'day', 'ช่วงอ่านไม่ออก = ตกกลับรายวัน ห้ามคืน undefined');
});

test('🔴 capBucket — จอที่ข้อมูลไม่มีเวลา ขอชั่วโมงไม่ได้ (ต้องหยาบให้ ห้ามปล่อยผ่าน)', () => {
  assert.equal(capBucket('hour', 'day'), 'day', 'OEE: production_sessions มีแค่ work_date + กะ');
  assert.equal(capBucket('day', 'month'), 'month', 'KPI/พลังงาน: กรอกรายเดือน');
  assert.equal(capBucket('week', 'day'), 'week', 'หยาบกว่าเพดานอยู่แล้ว = ไม่แตะ');
  assert.equal(capBucket('hour', 'hour'), 'hour');
  assert.equal(capBucket('year', 'day', 'month'), 'month', 'เพดานบนก็คุมได้');
  assert.equal(capBucket('ไม่รู้จัก', 'day'), 'day', 'ค่าพังใน URL = ตกกลับเพดานของจอ');
});

test('🔴 stepBucket เดินทีละขั้น และชนเพดานแล้วหยุด (ปุ่มต้องไม่พาไปขั้นที่จอทำไม่ได้)', () => {
  assert.equal(stepBucket('day', -1, { finest: 'hour' }), 'hour');
  assert.equal(stepBucket('day', -1, { finest: 'day' }), 'day', 'ชนเพดานล่าง = อยู่ที่เดิม');
  assert.equal(stepBucket('week', 1), 'month');
  assert.equal(stepBucket('year', 1), 'year', 'ชนเพดานบน = อยู่ที่เดิม');
});

test('🔴 nextBucket — ออโต้ตามช่วง แต่ "เลือกเองแล้วห้ามโดนทับ"', () => {
  const finest = 'hour';
  // กดปุ่มช่วง = คนเลือกมุมมองใหม่ → ใช้ขนาดแท่งของปุ่มนั้นเสมอ แม้เคยเลือกเองไว้
  assert.equal(nextBucket({ curBucket: 'month', prevFrom: '2020-01-01', prevTo: '2026-09-23',
    from: '2026-09-23', to: '2026-09-23', period: 'day', finest }), 'hour');
  // เปลี่ยนวันเอง ขณะที่ค่าปัจจุบันยังเป็นค่าออโต้ของช่วงเดิม → ตามออโต้ต่อ
  assert.equal(nextBucket({ curBucket: 'day', prevFrom: '2026-09-01', prevTo: '2026-09-23',
    from: '2025-09-23', to: '2026-09-23', finest }), 'week');
  // 🔴 เคยกด "หยาบลง" ไว้ (month ทั้งที่ออโต้คือ day) → ขยับวัน 1 วัน ต้องไม่ถูกดีดกลับ
  assert.equal(nextBucket({ curBucket: 'month', prevFrom: '2026-09-01', prevTo: '2026-09-23',
    from: '2026-09-01', to: '2026-09-24', finest }), 'month');
  // เพดานของจอชนะทุกกรณี
  assert.equal(nextBucket({ curBucket: null, prevFrom: null, prevTo: null,
    from: '2026-09-23', to: '2026-09-23', finest: 'day' }), 'day');
});

/* ══ ⏰ ถังชั่วโมง — เวลาไทย + ตัดวันทำงาน 08:00 ══════════════════════════════════ */

test('🔴 bkkHourKey แปลงเป็นเวลาไทยเอง ไม่พึ่ง timezone ของเครื่อง (คอนเทนเนอร์เทสเป็น UTC)', () => {
  assert.equal(bkkHourKey('2026-09-23T14:05:00Z'), '2026-09-23 21');
  assert.equal(bkkHourKey('2026-09-23T17:30:00Z'), '2026-09-24 00', 'UTC 17:30 = ไทยเที่ยงคืนวันถัดไป');
  assert.equal(bkkHourKey('2026-09-23T00:59:00Z'), '2026-09-23 07');
  assert.equal(bkkHourKey('2026-09-23T10:00:00+07:00'), '2026-09-23 10', 'มี offset มาแล้วก็ต้องตรง');
  assert.equal(bkkHourKey(null), null);
  assert.equal(bkkHourKey('ไม่ใช่เวลา'), null, 'ค่าพัง = null ห้ามคืน NaN แล้วไปโผล่เป็นถังหนึ่ง');
});

test('🔴 แกนชั่วโมงเริ่ม 08:00 และข้ามเที่ยงคืน (วันทำงาน ≠ วันปฏิทิน — กะดึกห้ามถูกผ่าครึ่ง)', () => {
  const ax = hourAxis('2026-09-23');
  assert.equal(ax.length, 24);
  assert.equal(ax[0], '2026-09-23 08', 'วันทำงานเริ่ม 08:00 ไม่ใช่ 00:00');
  assert.equal(ax[15], '2026-09-23 23');
  assert.equal(ax[16], '2026-09-24 00', 'เที่ยงคืนยังเป็นวันทำงานเดิม');
  assert.equal(ax[23], '2026-09-24 07', 'จบ 07:00 ของวันถัดไป');
  const sorted = [...ax].sort();
  assert.deepEqual(sorted, ax, 'คีย์ต้องเรียงตามตัวอักษรแล้วได้ลำดับเวลาถูก');
  assert.equal(hourAxis('2026-09-23', '2026-09-24').length, 48);
  assert.deepEqual(hourAxis('พัง'), []);
});

test('🔴 bucketKey("hour") ต้องคืน null — หาถังชั่วโมงจากวันที่เปล่าๆ ไม่ได้', () => {
  assert.equal(bucketKey('2026-09-23', 'hour'), null,
    'ถ้าเดาเป็นรายวันแทน จอที่ลืมแปลงจะโชว์เลขผิดเงียบๆ');
  assert.equal(bucketLabel('2026-09-23 08', 'hour'), '08:00');
  assert.equal(bucketLabel('2026-09-24 00', 'hour'), '00:00');
});

test('🔴 bucketAxis เติมถังที่เงียบเสมอ (ไม่งั้นเส้นแนวโน้มลากข้ามช่วงเงียบเหมือนไม่เคยหยุด)', () => {
  assert.deepEqual(bucketAxis('2026-09-21', '2026-09-23', 'day'), ['2026-09-21', '2026-09-22', '2026-09-23']);
  assert.deepEqual(bucketAxis('2026-09-23', '2026-10-04', 'week'), ['2026-09-21', '2026-09-28'],
    'เริ่มที่จันทร์ของสัปดาห์แรกเสมอ');
  assert.deepEqual(bucketAxis('2025-11-05', '2026-02-01', 'month'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(bucketAxis('2024-03-01', '2026-01-01', 'year'), ['2024', '2025', '2026']);
  assert.equal(bucketAxis('2026-09-23', '2026-09-23', 'hour').length, 24);
  assert.deepEqual(bucketAxis('พัง', 'พัง', 'day'), []);
  const ax = bucketAxis('2026-01-01', '2026-12-31', 'week');
  assert.deepEqual([...ax].sort(), ax, 'แกนต้องเรียงเวลาถูกเสมอ');
});
