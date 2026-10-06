// timeStrToMs — เวลา "HH:MM" ต้องได้เวลาจริงของวันงาน (QC 05/10: เดิมเลื่อน +8 ชม. ทุกตัว)
import test from 'node:test';
import assert from 'node:assert/strict';
import { timeStrToMs, dayFrameMs, getRoundStatus } from '../deliveryRounds.js';

const at = (d, hm) => new Date(`${d}T${hm}:00`).getTime();

test('timeStrToMs — กะเช้าตรงเวลาจริง ไม่เลื่อน 8 ชม.', () => {
  assert.equal(timeStrToMs('2026-10-05', '10:00'), at('2026-10-05', '10:00'));
  assert.equal(timeStrToMs('2026-10-05', '08:00'), dayFrameMs('2026-10-05').startMs);
  assert.equal(timeStrToMs('2026-10-05', '19:45'), at('2026-10-05', '19:45'));
});

test('timeStrToMs — ก่อน 08:00 = กะดึกข้ามเที่ยงคืน (วันถัดไป)', () => {
  assert.equal(timeStrToMs('2026-10-05', '02:30'), at('2026-10-06', '02:30'));
  assert.ok(timeStrToMs('2026-10-05', '07:59') < dayFrameMs('2026-10-05').endMs);
});

test('timeStrToMs — ค่าว่าง/พัง = null', () => {
  assert.equal(timeStrToMs('2026-10-05', null), null);
  assert.equal(timeStrToMs('2026-10-05', 'xx:yy'), null);
});

test('getRoundStatus — เทียบเวลาจริง: เลยเวลาส่ง = ค้างส่ง · ระหว่างตัดยอด→ส่ง = กำลังเตรียม', () => {
  const r = { line_name: 'L', shift: 'day', round_no: 1, cutoff_time: '09:30', delivery_time: '10:00', points_count: 1, time_per_point_min: 10 };
  const none = new Set();
  assert.ok(getRoundStatus(r, none, {}, '2026-10-05', at('2026-10-05', '10:30')).label.includes('ค้างส่ง'));
  assert.ok(getRoundStatus(r, none, {}, '2026-10-05', at('2026-10-05', '09:45')).label.includes('กำลังเตรียม'));
});
