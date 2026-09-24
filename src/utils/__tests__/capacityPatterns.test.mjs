import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_PATTERNS, monthDayCounts, patternHours, capacityRow, oeePair, DEFAULT_APQ } from '../capacityPatterns.js';

/* ─── ค่าที่ถอดจากสไลด์จริง ──────────────────────────────────────────────── */
test('SEED: 1 กะ = 7.75 ชม. และ 2 กะ = 15.5 ชม. พอดี (สไลด์: 2 shift = วันทำงาน × 15.5)', () => {
  const one = SEED_PATTERNS.find(p => p.key === '1s');
  const two = SEED_PATTERNS.find(p => p.key === '2s');
  assert.equal(one.hours_per_day, 7.75);
  assert.equal(two.hours_per_day, 15.5);
  assert.equal(two.hours_per_day, one.hours_per_day * 2);
});

test('SEED: OT = +2 ชม./กะ — 1 กะ+OT และ 2 กะ+OT ต้องสอดคล้องกัน', () => {
  const g = (k) => SEED_PATTERNS.find(p => p.key === k).hours_per_day;
  assert.equal(g('1s_ot'),  g('1s') + 2);
  assert.equal(g('2s_ot1'), g('2s') + 2);
  assert.equal(g('2s_ot2'), g('2s') + 4);
});

test('SEED: เพดานต้องเรียงจากน้อยไปมากตาม sort_order (จอวาดเส้นเพดานซ้อนกัน)', () => {
  const byOrder = [...SEED_PATTERNS].sort((a, b) => a.sort_order - b.sort_order);
  const cnt = monthDayCounts('2026-09', {});
  const hrs = byOrder.map(p => patternHours(p, cnt));
  for (let i = 1; i < hrs.length; i++) assert.ok(hrs[i] >= hrs[i - 1], `${byOrder[i].key} ต่ำกว่าตัวก่อนหน้า`);
});

/* ─── monthDayCounts — อ้างปฏิทินบริษัท ห้ามใช้ค่าคงที่ ────────────────── */
test('monthDayCounts: ก.ย. 2026 ไม่มีปฏิทิน = จ-ศ 22 วัน · เสาร์ 4 · ทั้งเดือน 30', () => {
  assert.deepEqual(monthDayCounts('2026-09', {}), { working: 22, working_sat: 26, all: 30 });
});

test('monthDayCounts: วันหยุดที่มาร์คไว้ต้องถูกหักออกจากวันทำงาน', () => {
  const cal = { '2026-09-01': 'ot15', '2026-09-02': 'ot2' };
  assert.equal(monthDayCounts('2026-09', cal).working, 20);
});

test('monthDayCounts: shutdown75 (ม.75) นับเป็นวันหยุดของเพดานด้วย', () => {
  assert.equal(monthDayCounts('2026-09', { '2026-09-03': 'shutdown75' }).working, 21);
});

test('monthDayCounts: เสาร์ที่มาร์ค working = วันทำงานเต็มตัว ห้ามนับซ้ำในโควตาเสาร์', () => {
  const c = monthDayCounts('2026-09', { '2026-09-05': 'working' });   // 5 ก.ย. 2026 = เสาร์
  assert.equal(c.working, 23);
  assert.equal(c.working_sat, 26, 'เสาร์ที่ถูกนับเป็นวันทำงานแล้ว ห้ามบวกซ้ำในโควตาเสาร์');
});

test('monthDayCounts: เดือนผิดรูป = 0 ทุกช่อง ไม่โยน error', () => {
  assert.deepEqual(monthDayCounts('', {}), { working: 0, working_sat: 0, all: 0 });
  assert.deepEqual(monthDayCounts('abcd', {}), { working: 0, working_sat: 0, all: 0 });
});

/* ─── patternHours — เพดานต่างกันที่ "จำนวนวัน" ด้วย ─────────────────────── */
const CNT = { working: 22, working_sat: 26, all: 30 };

test('patternHours: 2 กะ = วันทำงาน × 15.5', () => {
  assert.equal(patternHours({ hours_per_day: 15.5, day_source: 'working' }, CNT), 341);
});

test('patternHours: +เสาร์ ใช้จำนวนวันชุด working_sat ไม่ใช่ working', () => {
  const sat = SEED_PATTERNS.find(p => p.key === '2s_sat');
  assert.equal(patternHours(sat, CNT), 19.5 * 26);
  assert.notEqual(patternHours(sat, CNT), 19.5 * 22, 'ถ้าใช้ working = เพดาน +Sat ผิดทุกเดือน');
});

test('patternHours: Max = ทุกวันในเดือน × 24', () => {
  assert.equal(patternHours(SEED_PATTERNS.find(p => p.key === 'max'), CNT), 720);
});

test('patternHours: day_source ที่ไม่รู้จัก = 0 ไม่ใช่เดาเป็น working', () => {
  assert.equal(patternHours({ hours_per_day: 10, day_source: 'ไม่มีจริง' }, CNT), 0);
});

/* ─── capacityRow — ศัพท์ตรงกับสไลด์ ────────────────────────────────────── */
const ROW = (workloadHr, oee) => capacityRow({ workloadHr, oee, patterns: SEED_PATTERNS, dayCounts: CNT });

test('capacityRow: Cap OEE Act = เพดาน 2 กะ × OEE · RworkOEE = ภาระ ÷ OEE', () => {
  const r = ROW(200, 0.8);
  assert.equal(r.baseHours, 341);
  assert.equal(r.capOeeAct, 341 * 0.8);
  assert.equal(r.rworkOee, 250);
});

test('capacityRow: Diff OT OEE บวก = เหลือ · ลบ = ต้องเพิ่มกะ', () => {
  assert.ok(ROW(200, 0.8).diffOtOee > 0);
  assert.ok(ROW(300, 0.8).diffOtOee < 0);
});

test('capacityRow: fitPattern = รูปแบบเล็กสุดที่ยังไหว (คิด OEE แล้ว)', () => {
  // 1 กะ×OEE = 22×7.75×0.8 = 136.4 · 1 กะ+OT = 171.6 · 2 กะ = 272.8
  assert.equal(ROW(100, 0.8).fitPattern.key, '1s');
  assert.equal(ROW(150, 0.8).fitPattern.key, '1s_ot');
  assert.equal(ROW(200, 0.8).fitPattern.key, '2s');
});

test('capacityRow: ภาระเกินทุกรูปแบบ = fitPattern null (ห้ามคืนตัวสุดท้ายแล้วบอกว่าไหว)', () => {
  assert.equal(ROW(99999, 0.8).fitPattern, null);
});

test('capacityRow: ไม่มี OEE = ช่องที่ต้องใช้ OEE เป็น null ห้ามแอบใช้ 1.0', () => {
  const r = ROW(200, null);
  assert.equal(r.rworkOee, null);
  assert.equal(r.capOeeAct, null);
  assert.equal(r.diffOtOee, null);
  assert.equal(r.fitPattern, null);
  assert.equal(r.baseHours, 341, 'เพดานดิบยังบอกได้ ไม่ต้องรอ OEE');
});

test('capacityRow: ส่งรูปแบบมาไม่เรียง ก็ต้องเรียงให้เองก่อนหา fitPattern', () => {
  const shuffled = [...SEED_PATTERNS].reverse();
  const r = capacityRow({ workloadHr: 100, oee: 0.8, patterns: shuffled, dayCounts: CNT });
  assert.equal(r.fitPattern.key, '1s');
  assert.deepEqual(r.ceilings.map(p => p.key), SEED_PATTERNS.map(p => p.key));
});

/* ─── oeePair — 2 เส้นเสมอ (คำสั่ง user) ────────────────────────────────── */
test('oeePair: เป้า OEE คำนวณจาก A×P×Q เสมอ ห้ามรับค่า target_oee ตรงๆ', () => {
  const { target } = oeePair(0.7, { target_a: 90, target_p: 90, target_q: 99, target_oee: 0.5 });
  assert.equal(Math.round(target * 10000) / 10000, 0.8019);
});

test('oeePair: ไม่มีแถวเป้า = ใช้ค่ามาตรฐาน 90/90/99', () => {
  const { target } = oeePair(0.7, null);
  const std = (DEFAULT_APQ.a / 100) * (DEFAULT_APQ.p / 100) * (DEFAULT_APQ.q / 100);
  assert.equal(target, std);
});

test('oeePair: ไม่มี OEE จริง = actual null + hasActual false (จอต้องบอกว่ายังไม่มีข้อมูล)', () => {
  const r = oeePair(null, null);
  assert.equal(r.actual, null);
  assert.equal(r.hasActual, false);
  assert.ok(r.target > 0, 'เส้นเป้ายังต้องมีเสมอ');
});

test('oeePair: OEE จริงเป็น 0 = ถือว่ายังไม่มีข้อมูล ไม่ใช่ "แย่มาก" (หารด้วย 0 ไม่ได้)', () => {
  assert.equal(oeePair(0, null).hasActual, false);
});
