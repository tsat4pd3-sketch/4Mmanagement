import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodHead, isTodayPeriod, startIndexForToday } from '../periodHead.js';

test('ป้ายรายวัน: วันนี้/วันในสัปดาห์/ข้ามปีมีปีกำกับ', () => {
  assert.deepEqual(periodHead('2026-10-08', { today: '2026-10-08' }), { top: '📍 วันนี้', bot: '8/10', isToday: true, weekend: false });
  assert.equal(periodHead('2026-10-10', { today: '2026-10-08' }).top, 'ส');
  assert.equal(periodHead('2026-10-10', { today: '2026-10-08' }).weekend, true);
  assert.equal(periodHead('2025-12-14', { today: '2026-10-08', seed: true }).bot, '14/12/25');
  assert.equal(periodHead('2025-12-14', { today: '2026-10-08', seed: true }).top, 'ยกมา');
});

test('รายสัปดาห์: วันนี้อยู่ในสัปดาห์ไหน = คอลัมน์นั้นคือวันนี้ (เดิมไม่เคยชี้)', () => {
  assert.equal(isTodayPeriod('2026-10-04', '2026-10-08', 'week'), true);
  assert.equal(isTodayPeriod('2026-10-11', '2026-10-08', 'week'), false);
  assert.equal(periodHead('2026-10-04', { kind: 'week', today: '2026-10-08' }).top, '📍 วันนี้');
  assert.equal(periodHead('2026-10-11', { kind: 'week', today: '2026-10-08' }).top, 'สัปดาห์');
});

test('คอลัมน์ยกมาไม่ถูกตีเป็นวันนี้ · ใส่ป้ายล่างเองได้ (Stock ตอนนี้)', () => {
  const h = periodHead('2026-10-08', { today: '2026-10-08', seed: true, seedBot: 'ตอนนี้' });
  assert.deepEqual([h.top, h.bot, h.isToday], ['ยกมา', 'ตอนนี้', false]);
});

test('เปิดตารางมาเริ่มที่วันนี้ · เลยท้ายตาราง = หน้าสุดท้าย · ก่อนต้นตาราง = 0', () => {
  const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}` }));
  assert.equal(startIndexForToday(days, '2026-09-10', 'day', 13), 9);
  assert.equal(startIndexForToday(days, '2026-09-29', 'day', 13), 17);   // ชนท้าย
  assert.equal(startIndexForToday(days, '2026-12-01', 'day', 13), 17);
  assert.equal(startIndexForToday(days, '2026-08-01', 'day', 13), 0);
  const weeks = [{ date: '2025-12-14' }, { date: '2025-12-21' }, { date: '2026-10-04' }, { date: '2026-10-11' }];
  assert.equal(startIndexForToday(weeks, '2026-10-08', 'week', 2), 2);
});
