import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStartOf, periodKey, lookbackStart, splitDueCps, amFreqOf, amFreqSetupIssue } from '../amCheckFreq.js';

test('สัปดาห์ = จ–อา · เดือน = YYYY-MM · กะ = วัน|กะ', () => {
  assert.equal(weekStartOf('2026-11-26'), '2026-11-23');   // พฤ → จ
  assert.equal(weekStartOf('2026-11-29'), '2026-11-23');   // อา → จ ก่อนหน้า
  assert.equal(weekStartOf('2026-11-30'), '2026-11-30');   // จ
  assert.equal(weekStartOf('bad'), null);
  assert.equal(periodKey('monthly', '2026-11-26'), '2026-11');
  assert.equal(periodKey('daily', '2026-11-26', 'night'), '2026-11-26');
  assert.equal(periodKey('shift', '2026-11-26', 'night'), '2026-11-26|night');
  assert.equal(lookbackStart('2026-12-02'), '2026-11-30');   // ต้นสัปดาห์ก่อนต้นเดือน
  assert.equal(lookbackStart('2026-11-26'), '2026-11-01');
});

test('ค่าว่าง/ไม่รู้จัก = ทุกกะ (พฤติกรรมเดิม)', () => {
  assert.equal(amFreqOf({}), 'shift');
  assert.equal(amFreqOf({ am_check_freq: 'yearly' }), 'shift');
  assert.equal(amFreqOf({ am_check_freq: 'weekly' }), 'weekly');
});

const CPS = [
  { id: 's', am_check_freq: 'shift' },
  { id: 'd', am_check_freq: 'daily' },
  { id: 'w', am_check_freq: 'weekly' },
  { id: 'm', am_check_freq: 'monthly' },
];
const slot = { workDate: '2026-11-26', shift: 'night' };

test('ยังไม่เคยตรวจในรอบ = ถึงรอบ · ตรวจในรอบแล้ว = ไม่ถึงรอบ (นับตามปฏิทิน)', () => {
  const done = new Map([
    ['d', [{ workDate: '2026-11-26', shift: 'day' }]],     // วันนี้กะเช้าตรวจแล้ว ⇒ กะดึกไม่ต้อง
    ['w', [{ workDate: '2026-11-22', shift: 'day' }]],     // อาทิตย์ที่แล้ว (สัปดาห์ก่อน) ⇒ ค้าง = ถึงรอบ
    ['m', [{ workDate: '2026-11-03', shift: 'day' }, { workDate: '2026-11-10', shift: 'night' }]],
  ]);
  const r = splitDueCps(CPS, slot, done);
  assert.deepEqual(r.due.map(c => c.id), ['s', 'w']);
  assert.deepEqual(r.notDue.map(x => [x.cp.id, x.freq, x.lastDate]), [['d', 'daily', '2026-11-26'], ['m', 'monthly', '2026-11-10']]);
  assert.equal(r.unknown, false);
});

test('อ่านประวัติไม่ได้ = ทุกข้อถึงรอบ + unknown', () => {
  const r = splitDueCps(CPS, slot, null);
  assert.equal(r.due.length, 4); assert.equal(r.unknown, true);
});

test('จุดคำนวณที่ถึงรอบ ลากจุดต้นทางที่ไม่ถึงรอบกลับมา', () => {
  const cps = [{ id: 'a', am_check_freq: 'weekly' }, { id: 'b', am_check_freq: 'weekly' }, { id: 'c', am_check_freq: 'shift', calc: { op: 'diff', a: 'a', b: 'b' } }];
  const done = new Map([['a', [{ workDate: '2026-11-24', shift: 'day' }]], ['b', [{ workDate: '2026-11-24', shift: 'day' }]]]);
  const r = splitDueCps(cps, slot, done);
  assert.deepEqual(r.due.map(c => c.id), ['a', 'b', 'c']);
  assert.equal(r.notDue.length, 0);
});

test('ตั้งค่า: ต้องมีอย่างน้อย 1 ข้อทุกกะ', () => {
  assert.equal(amFreqSetupIssue(CPS), '');
  assert.match(amFreqSetupIssue([{ am_check_freq: 'weekly' }, { am_check_freq: 'daily' }]), /ทุกกะ/);
  assert.equal(amFreqSetupIssue([]), '');
});
