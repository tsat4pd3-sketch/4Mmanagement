import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ST, worstStatus, statusVsTarget, statusVsBaseline,
  safetyKind, isInjury, daysWithoutLti, dayAdd, daysBetween, dayAxis, sumByDay, avgOfDays,
} from '../obeya.js';

/* ── กฎ ①: "ประเมินไม่ได้" ต้องเป็น unknown ห้ามกลายเป็นแดง/ศูนย์ ── */
test('ไม่มีค่า หรือ ไม่มีเป้า = unknown (ห้ามตัดสินว่าแย่)', () => {
  assert.equal(statusVsTarget(null, 80, 'up'), ST.unknown);
  assert.equal(statusVsTarget(75, null, 'up'), ST.unknown);
  assert.equal(statusVsTarget(NaN, 80, 'up'), ST.unknown);
});

test('ทิศ up — ถึงเป้า=เขียว · เฉียด=เหลือง · ต่ำกว่ามาก=แดง', () => {
  assert.equal(statusVsTarget(81, 80, 'up'), ST.good);
  assert.equal(statusVsTarget(80, 80, 'up'), ST.good);
  assert.equal(statusVsTarget(77, 80, 'up'), ST.warn);   // อยู่ในแถบ 5%
  assert.equal(statusVsTarget(60, 80, 'up'), ST.bad);
});

test('ทิศ down — เป้า 0 (อุบัติเหตุ) เกินแม้แต่ 1 ครั้ง = แดงทันที ห้ามเป็นเหลือง', () => {
  assert.equal(statusVsTarget(0, 0, 'down'), ST.good);
  assert.equal(statusVsTarget(1, 0, 'down'), ST.bad);
  assert.equal(statusVsTarget(900, 1000, 'down'), ST.good);
  assert.equal(statusVsTarget(1040, 1000, 'down'), ST.warn);
  assert.equal(statusVsTarget(2000, 1000, 'down'), ST.bad);
});

/* ── กฎ ③: ไม่มีเป้า → เทียบค่าเฉลี่ยตัวเอง และห้ามแดง ── */
test('เทียบค่าเฉลี่ยตัวเอง — แย่กว่าค่าเฉลี่ยได้แค่ "เหลือง" ห้ามเป็นแดง (ยังไม่มีเป้าให้หลุด)', () => {
  assert.equal(statusVsBaseline(50, 100, 'down').status, ST.good);
  assert.equal(statusVsBaseline(500, 100, 'down').status, ST.warn);
  assert.notEqual(statusVsBaseline(9999, 100, 'down').status, ST.bad);
});

test('baseline = 0 หรือไม่มี → unknown (หารไม่ได้ ห้ามเดา)', () => {
  assert.equal(statusVsBaseline(5, 0, 'down').status, ST.unknown);
  assert.equal(statusVsBaseline(5, null, 'down').status, ST.unknown);
});

/* ── ไฟรวมของบอร์ด ── */
test('worstStatus — unknown 1 ตัวต้องไม่ทำให้บอร์ดทั้งใบเป็นเทา', () => {
  assert.equal(worstStatus([ST.good, ST.unknown]), ST.good);
  assert.equal(worstStatus([ST.good, ST.warn, ST.unknown]), ST.warn);
  assert.equal(worstStatus([ST.good, ST.bad]), ST.bad);
  assert.equal(worstStatus([ST.unknown, ST.unknown]), ST.unknown);
  assert.equal(worstStatus([]), ST.unknown);
});

/* ── Safety ── */
test('ชนิดเหตุการณ์ที่ไม่รู้จักต้องโชว์ key ดิบ ห้ามหายเงียบ/ห้าม throw', () => {
  const k = safetyKind('เหตุแบบใหม่');
  assert.equal(k.unknown, true);
  assert.equal(k.label, 'เหตุแบบใหม่');
  assert.equal(safetyKind('lti').resetsStreak, true);
  assert.equal(safetyKind('near_miss').resetsStreak, false);
});

test('isInjury — near miss / ทรัพย์สินเสียหาย ไม่ใช่การบาดเจ็บของคน', () => {
  assert.equal(isInjury({ kind: 'lti' }), true);
  assert.equal(isInjury({ kind: 'first_aid' }), true);
  assert.equal(isInjury({ kind: 'property' }), false);
  assert.equal(isInjury({ kind: 'near_miss' }), false);
});

test('ไม่มีบันทึก LTI เลย = unknown ห้ามอ้างว่าปลอดภัยมา N วัน', () => {
  const r = daysWithoutLti([{ event_date: '2026-08-01', kind: 'near_miss' }], '2026-08-27');
  assert.equal(r.unknown, true);
  assert.equal(r.days, null);
});

test('นับวันปลอดอุบัติเหตุจาก LTI ครั้งล่าสุด (near miss ไม่รีเซ็ต)', () => {
  const ev = [
    { event_date: '2026-05-10', kind: 'lti' },
    { event_date: '2026-07-01', kind: 'lti' },
    { event_date: '2026-08-20', kind: 'near_miss' },
    { event_date: '2026-08-25', kind: 'first_aid' },
  ];
  const r = daysWithoutLti(ev, '2026-08-27');
  assert.equal(r.unknown, false);
  assert.equal(r.since, '2026-07-01');
  assert.equal(r.days, 57);
});

/* ── วันที่: ต้องเป็น local ล้วน (กฎห้าม toISOString) ── */
test('dayAdd/daysBetween ข้ามเดือน-ปี และข้ามเส้น UTC ได้ถูก', () => {
  assert.equal(dayAdd('2026-08-31', 1), '2026-09-01');
  assert.equal(dayAdd('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetween('2026-07-01', '2026-08-27'), 57);
  assert.equal(daysBetween('2026-08-27', '2026-08-27'), 0);
});

test('dayAxis ต่อเนื่องทุกวัน ห้ามข้ามวันที่ไม่มีข้อมูล', () => {
  const ax = dayAxis('2026-03-02', 4);
  assert.deepEqual(ax, ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});

/* ── รวมยอด ── */
test('sumByDay รวมหลายแถวของวันเดียวกัน · ค่าที่ไม่ใช่ตัวเลขนับเป็น 0 ไม่พัง', () => {
  const rows = [
    { d: '2026-08-26', q: 5 }, { d: '2026-08-26', q: 3 },
    { d: '2026-08-27', q: null }, { d: null, q: 9 },
  ];
  const m = sumByDay(rows, r => r.d, r => r.q);
  assert.equal(m['2026-08-26'], 8);
  assert.equal(m['2026-08-27'], 0);
  assert.equal(m[null], undefined);
});

test('avgOfDays หารด้วย "วันที่มีข้อมูลจริง" ไม่ใช่วันปฏิทิน', () => {
  const m = { '2026-08-25': 10, '2026-08-27': 20 };            // 26 ไม่ได้เดินไลน์
  assert.equal(avgOfDays(m, ['2026-08-25', '2026-08-26', '2026-08-27']), 15);
  assert.equal(avgOfDays(m, ['2026-08-01']), null);
});

/* ── กฎเหล็ก: แกน Safety "ไม่มีบันทึก" ห้ามขึ้นเขียว ─────────────────────────
   เป้าอุบัติเหตุ = 0 ⇒ ส่วนงานที่ยังไม่มีใครบันทึกจะได้ 0 = "ผ่านเป้า" ฟรีๆ
   ซึ่งเป็นคำกล่าวอ้างเท็จ (เจอจริงตอนเรนเดอร์ครั้งแรก บอร์ดเขียวทั้งใบทั้งที่ตารางว่าง) */
import { safetyStatus } from '../obeya.js';

test('ตาราง safety ว่างเปล่า = unknown ห้ามเป็นเขียว', () => {
  assert.equal(safetyStatus([], { monthInjuries: 0 }), ST.unknown);
});

test('ยังไม่ได้ apply migration = unknown', () => {
  assert.equal(safetyStatus([{ kind: 'near_miss' }], { tableMissing: true }), ST.unknown);
});

test('มีบันทึกจริงแล้วไม่มีคนเจ็บ = เขียว (นี่คือเคสเดียวที่เขียวได้)', () => {
  assert.equal(safetyStatus([{ kind: 'near_miss', event_date: '2026-08-20' }], { monthInjuries: 0 }), ST.good);
});

test('มีคนเจ็บวันนี้ = แดงทันที แม้ทั้งเดือนจะเพิ่งครั้งแรก', () => {
  const ev = [{ kind: 'first_aid', event_date: '2026-08-27' }];
  assert.equal(safetyStatus(ev, { todayEvents: ev, monthInjuries: 1 }), ST.bad);
});

test('เดือนนี้มีคนเจ็บแล้ว (แต่ไม่ใช่วันนี้) = แดง เพราะเป้าคือ 0', () => {
  const ev = [{ kind: 'lti', event_date: '2026-08-10' }];
  assert.equal(safetyStatus(ev, { todayEvents: [], monthInjuries: 1 }), ST.bad);
});

test('near miss ไม่นับเป็นบาดเจ็บ — แจ้ง near miss เยอะไม่ทำให้แดง', () => {
  const ev = [{ kind: 'near_miss', event_date: '2026-08-27' }, { kind: 'property', event_date: '2026-08-27' }];
  assert.equal(safetyStatus(ev, { todayEvents: ev, monthInjuries: 0 }), ST.good);
});
