import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekCol, barsOf, todayCol } from '../planGantt.js';

test('ช่องสัปดาห์: 12 เดือน × 4 · วันที่ 22 ขึ้นไป = สัปดาห์ 4 · นอกปี = -1 / 48', () => {
  assert.equal(weekCol('2026-01-01', 2026), 0);
  assert.equal(weekCol('2026-01-08', 2026), 1);
  assert.equal(weekCol('2026-01-31', 2026), 3);
  assert.equal(weekCol('2026-12-31', 2026), 47);
  assert.equal(weekCol('2025-12-31', 2026), -1);
  assert.equal(weekCol('2027-01-01', 2026), 48);
  assert.equal(weekCol('', 2026), null);
});

test('แท่ง: เสร็จตามแผน / ยังไม่เสร็จ (ถึงวันนี้) / เสร็จช้า (ส่วนเกิน = แดง)', () => {
  const done = barsOf({ start_date: '2026-02-02', end_date: '2026-02-13', progress: 100, done_on: '2026-02-13' }, 2026, '2026-06-01');
  assert.deepEqual(done.plan, { from: 4, to: 5, clipL: false, clipR: false });
  assert.deepEqual(done.actual, { from: 4, to: 5 });
  assert.equal(done.late, null);
  assert.equal(done.tone, 'green');

  const going = barsOf({ start_date: '2026-03-01', end_date: '2026-11-30', progress: 50 }, 2026, '2026-06-10');
  assert.deepEqual(going.actual, { from: 8, to: 21 });

  const late = barsOf({ start_date: '2026-06-02', end_date: '2026-06-06', progress: 100, done_on: '2026-06-26' }, 2026, '2026-12-01');
  assert.deepEqual(late.actual, { from: 20, to: 20 });
  assert.deepEqual(late.late, { from: 21, to: 23 });
  assert.equal(late.tone, 'red');

  const none = barsOf({ start_date: '2026-03-01', end_date: '2026-03-31', progress: 0 }, 2026, '2026-03-15');
  assert.equal(none.actual, null);
  assert.equal(barsOf({ progress: 0 }, 2026, '2026-01-01').plan, null);
  assert.equal(barsOf({ start_date: '2025-01-01', end_date: '2025-02-01', progress: 0 }, 2026, '2026-01-01').plan, null);
});

test('เส้นวันนี้อยู่เฉพาะปีที่ดู', () => {
  assert.equal(todayCol('2026-11-28', 2026), 43);   // พ.ย. (เดือน 11) สัปดาห์ 4
  assert.equal(todayCol('2026-11-28', 2025), null);
});
