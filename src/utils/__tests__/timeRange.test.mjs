import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_SCALES, LOOKBACK_DAYS, scaleOf, addDays, rangeDays, normalizeRange,
  presetRange, matchPreset, isoWeek, weekMonday, bucketKey, bucketLabel, scaleWarning, suggestScale,
} from '../timeRange.js';

/* ⏱️ มาตรฐานกลางของตัวกรองช่วงเวลา — ล็อกพฤติกรรมที่ทุกหน้าต้องเหมือนกัน (2026-09-23)
   ⚠️ ทุกเคสตรึงวันที่เอง **ห้ามอ้าง new Date()** — ไม่งั้นเป็น "เทสระเบิดเวลา"
      (กฎ CLAUDE.md: `npm test` รันรอบนาฬิกา +400 วันด้วย) */

test('สเกลมี 4 ระดับตามที่ user สั่ง และเรียงจากเล็กไปใหญ่', () => {
  assert.deepEqual(TIME_SCALES.map(s => s.key), ['day', 'week', 'month', 'year']);
  assert.deepEqual(TIME_SCALES.map(s => s.label), ['รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายปี']);
  for (let i = 1; i < TIME_SCALES.length; i++)
    assert.ok(TIME_SCALES[i].okDays[0] > TIME_SCALES[i - 1].okDays[0], 'okDays ต้องไล่ขึ้น');
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
