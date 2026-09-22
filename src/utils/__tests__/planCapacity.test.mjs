/* ═══ เทสกฎการวางแผนกำลังผลิต — ตรึง 2 บั๊กที่ audit 2026-09-22 จับได้ ═══════════
   ① งานคู่ RH/LH: ภาระเวลาต้องนับครั้งเดียว (ยอดชิ้นยังบวกทั้งคู่)
   ② ฐานเวลาของกำลังทางทฤษฎีต้องเป็น "นาทีสุทธิ" (หักพักแล้ว) ไม่ใช่เวลากะดิบ
   ทั้งคู่เคยทำให้แผนสั่งเปิด OT/กะดึก/🚨 เกินจำเป็น หรือวางแผนน้อยกว่าที่ต้องใช้
   ══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairLoadTotal } from '../pairTotals.js';
import {
  estimateCapacity, netShiftMin, DEFAULT_SHIFT_MIN, FALLBACK_SHIFT_BREAK_MIN,
} from '../capacityModel.js';
import { policyBreakForShift } from '../oee.js';

/* ── ① งานคู่ ───────────────────────────────────────────────────────────── */

// ของจริงในฐาน DR 22/09: 20059957 ↔ 20059959 บน LINE D (110&300 Ton)
const PAIRS = { 20059957: '20059959', 20059959: '20059957' };
const pairOf = (m) => PAIRS[m] || null;

test('คู่ RH/LH ที่มีทั้ง 2 ข้าง — ภาระเวลา = max ไม่ใช่ผลบวก', () => {
  const load = { 20059957: 3.2, 20059959: 3.5 };
  assert.equal(pairLoadTotal(load, pairOf), 3.5);
  assert.notEqual(pairLoadTotal(load, pairOf), 6.7, 'บวกกัน = บั๊กเดิม (นับเวลา 2 เท่า)');
});

test('คู่ที่มีข้างเดียวในชุดข้อมูล — นับเต็ม (รอบนี้ผลิตเดี่ยว)', () => {
  assert.equal(pairLoadTotal({ 20059957: 3.2 }, pairOf), 3.2);
});

test('พาร์ทเดี่ยวปนกับคู่ — เดี่ยวบวกตามปกติ คู่ยุบ', () => {
  const load = { 20059957: 3.2, 20059959: 3.5, 10100401: 1.5, 20065635: 2 };
  assert.equal(pairLoadTotal(load, pairOf), 3.5 + 1.5 + 2);
});

test('ไม่มี pairOf (เช่นลืม select pair_mat_no) — คืนผลบวกเดิมทุกกรณี (ไม่พังของเดิม)', () => {
  const load = { a: 1, b: 2, c: 3 };
  assert.equal(pairLoadTotal(load), 6);
  assert.equal(pairLoadTotal(load, () => null), 6);
});

test('รับทั้ง object และ Map · ค่าที่ไม่ใช่ตัวเลขนับเป็น 0', () => {
  assert.equal(pairLoadTotal(new Map([['20059957', 3.2], ['20059959', 3.5]]), pairOf), 3.5);
  assert.equal(pairLoadTotal({ a: null, b: undefined, c: 'x', d: 2 }), 2);
  assert.equal(pairLoadTotal(null), 0);
  assert.equal(pairLoadTotal({}), 0);
});

test('pair_mat_no ชี้ตัวเอง (ข้อมูลเพี้ยน) — ต้องไม่ยุบทิ้งและไม่วนลูป', () => {
  assert.equal(pairLoadTotal({ x: 4 }, () => 'x'), 4);
});

/* ── ② ฐานเวลาสุทธิ ───────────────────────────────────────────────────── */

// ชุดเวลาพักกะเช้าจริงจากตาราง break_policies (ot_scope='always')
const DAY_BREAKS = [
  { shift: 'day', start_time: '08:00:00', duration_min: 10, process_type: 'common', ot_scope: 'always' },
  { shift: 'day', start_time: '10:00:00', duration_min: 10, process_type: 'common', ot_scope: 'always' },
  { shift: 'day', start_time: '11:50:00', duration_min: 50, process_type: 'common', ot_scope: 'always' },
  { shift: 'day', start_time: '15:00:00', duration_min: 10, process_type: 'common', ot_scope: 'always' },
  { shift: 'day', start_time: '17:10:00', duration_min: 20, process_type: 'common', ot_scope: 'no_ot' },
];

test('นาทีพักกะเช้าในกรอบ 08:00–17:30 = 80 นาที (5ส. 17:10 ยังอยู่ในกรอบ = 100 เมื่อไม่ทำโอ)', () => {
  const brk = policyBreakForShift({
    policies: DAY_BREAKS.filter(p => p.ot_scope === 'always'),
    shift: 'day', shiftMin: DEFAULT_SHIFT_MIN, workDate: '2026-09-22',
  });
  assert.equal(brk, 80);
  assert.equal(netShiftMin(DEFAULT_SHIFT_MIN, brk), 490);
  // ค่าสำรองในโค้ดต้องตรงกับของจริง ไม่งั้น fallback จะพาไปคนละทาง
  assert.equal(FALLBACK_SHIFT_BREAK_MIN, 80);
});

test('กำลังทางทฤษฎีต้องคิดบนเวลาสุทธิ — ใช้เวลาดิบ = เฟ้อ ~16%', () => {
  const opt = { ctSec: 60, lineOee: 0.75 };
  const gross = estimateCapacity([], { ...opt, shiftMin: DEFAULT_SHIFT_MIN }).perShift; // ของเดิม
  const net = estimateCapacity([], { ...opt, shiftMin: netShiftMin(DEFAULT_SHIFT_MIN, 80) }).perShift;
  assert.equal(gross, 428);   // (570×60÷60)×0.75
  assert.equal(net, 368);     // (490×60÷60)×0.75
  assert.ok(gross / net > 1.16, `เฟ้อจริง ${(gross / net).toFixed(3)} เท่า`);
});

test('netShiftMin กันค่าเพี้ยน — พักเกินเวลากะ/ค่าติดลบ ต้องไม่คืน 0 หรือติดลบ', () => {
  assert.equal(netShiftMin(570, 999), 60);
  assert.equal(netShiftMin(570, -50), 570);
  assert.equal(netShiftMin(undefined, 80), 490);
});

test('มีประวัติจริง ≥ MIN_SESSIONS — ฐานเวลาไม่ถูกใช้เลย (median ของจริงชนะ)', () => {
  const rows = [400, 420, 410, 430];
  const a = estimateCapacity(rows, { ctSec: 60, lineOee: 0.75, shiftMin: 570 });
  const b = estimateCapacity(rows, { ctSec: 60, lineOee: 0.75, shiftMin: 490 });
  assert.equal(a.method, 'actual');
  assert.deepEqual(a, b, 'ทางที่มีประวัติจริงต้องไม่ขึ้นกับฐานเวลา');
});
