/* งานคู่ gang die / RH-LH — "1 shot ได้ 2 ชิ้น" ต้องนับเป็น shot ตอนคิดเวลามาตรฐาน (%P)
   ที่มา (user 2026-09-18): *"ถ้างานคู่ แบบ gang die / 1 shot ได้งาน 2 ชิ้น หรือ คู่ซ้าย-ขวา
   ต้องนับเป็น shot หรือ cycle"*

   🔴 กติกาที่ห้ามสลับ — **ชิ้น ≠ shot**
     · %Q · ยอดผลิต · ของเสีย   → นับ **ชิ้น** (1 shot = 2 ชิ้น)
     · %P (เวลามาตรฐาน Σ qty×CT) → นับ **shot** เพราะ CT คือเวลาต่อ 1 จังหวะเครื่อง

   บั๊กที่เคยเกิด (วัดจริง 18/09 บนข้อมูลสดของ HDF1/LASER-345):
     บวก qty×CT ทั้ง RH และ LH ⇒ เวลามาตรฐาน 2 เท่า ⇒ %P ดิบ 159-160%
     แล้วโดน `Math.min(1, …)` กดเหลือ 100 เงียบๆ ⇒ OEE สูงเกินจริง + จอขึ้น "⚠%P ตัน"
   ratio (เวลามาตรฐาน ÷ เวลาเครื่องเดิน · เกิน 1 = เป็นไปไม่ได้) ก่อน→หลังยุบ 45 วัน:
     LASER-345 1.80→1.04 · HDF2 1.15→0.72 · HDF1 1.14→0.66
     ไลน์ไม่มีคู่ไม่ขยับเลย (Line 61 0.71 · BENDING E50 0.59) */
import test from 'node:test';
import assert from 'node:assert';
import { collapsePairShots } from '../pairTotals.js';
import { computeLiveOee } from '../oee.js';

const PAIR = { RH: 'LH', LH: 'RH' };
const pairOf = (m) => PAIR[m] ?? null;

test('collapsePairShots — คู่ที่มีครบ 2 ข้าง ยุบเหลือ 1 shot (qty = max ไม่ใช่ผลบวก)', () => {
  const out = collapsePairShots([
    { mat_no: 'RH', qty: 204, ct: 45 },
    { mat_no: 'LH', qty: 200, ct: 45 },
    { mat_no: 'SOLO', qty: 50, ct: 30 },
  ], pairOf);
  assert.equal(out.length, 2);
  const pair = out.find(r => r.mat_no === 'RH');
  assert.equal(pair.qty, 204, 'ต้องเป็น max(204,200) — จำนวนจังหวะ ไม่ใช่ 404 ชิ้น');
  assert.equal(out.find(r => r.mat_no === 'SOLO').qty, 50, 'พาร์ทเดี่ยวห้ามโดนแตะ');
});

test('collapsePairShots — window ของคู่ union กัน (ปั๊มจังหวะเดียวกัน = ช่วงเดียว)', () => {
  const [r] = collapsePairShots([
    { mat_no: 'RH', qty: 10, ct: 45, winStart: 100, winEnd: 900 },
    { mat_no: 'LH', qty: 10, ct: 45, winStart: 50, winEnd: 800 },
  ], pairOf);
  assert.equal(r.winStart, 50);
  assert.equal(r.winEnd, 900);
});

test('🛡️ ไม่ส่ง pairOf / คู่ไม่ครบ 2 ข้าง = คืนแถวเดิมเป๊ะ (backward compatible)', () => {
  const rows = [{ mat_no: 'RH', qty: 204, ct: 45 }, { mat_no: 'SOLO', qty: 50, ct: 30 }];
  assert.deepEqual(collapsePairShots(rows), rows, 'ไม่ส่ง pairOf ต้องไม่ยุบอะไรเลย');
  assert.deepEqual(collapsePairShots(rows, pairOf), rows, 'คู่ไม่อยู่ในชุด (LH ไม่ได้ผลิต) = ไม่ยุบ');
});

/* ── ต่อสายจริงกับ computeLiveOee — ตัวเลขจากกะจริง HDF1 18/09 ── */
const HDF1 = {
  session: { start_time: '08:00:00', shift: 'day', work_date: '2026-09-17', shift_min: null },
  // 193 จังหวะ ได้ RH+LH อย่างละ 193 ชิ้น · CT 50 วิ/จังหวะ
  orders: [
    { status: 'open', qty_actual: 193, mat_no: '90031601', opened_at: '2026-09-17T08:00:00' },
    { status: 'open', qty_actual: 193, mat_no: '90031602', opened_at: '2026-09-17T08:00:00' },
  ],
  ctMap: { 90031601: 50, 90031602: 50 },
  workDate: '2026-09-17',
  /* ⏱ ต้องสร้างเป็น "เวลาท้องถิ่น" แบบเดียวกับที่ computeLiveOee ต่อ work_date+start_time
     ห้ามใช้ …Z (UTC) — เครื่อง CI รัน TZ=UTC แล้ว elapsed เพี้ยนทันที = เทสระเบิดเวลา
     แบบนี้ได้ elapsed = 305 นาที เท่ากันทุก timezone */
  nowMs: new Date('2026-09-17T13:05:00').getTime(),
  breakPolicies: [
    { shift: 'day', process_type: 'common', start_time: '08:00:00', duration_min: 10, ot_scope: 'always' },
    { shift: 'day', process_type: 'common', start_time: '10:00:00', duration_min: 10, ot_scope: 'always' },
    { shift: 'day', process_type: 'common', start_time: '11:50:00', duration_min: 50, ot_scope: 'always' },
  ],
  downtimes: [],
};
const PAIR_MAT = { 90031601: '90031602', 90031602: '90031601' };

test('computeLiveOee — งานคู่: เวลามาตรฐานนับ shot แต่ยอดผลิตยังนับชิ้น', () => {
  const before = computeLiveOee({ ...HDF1 });
  const after  = computeLiveOee({ ...HDF1, pairMap: PAIR_MAT });

  assert.equal(before.produced, 386, 'ยอดผลิตคือ "ชิ้น" — 193 จังหวะ × 2 ข้าง');
  assert.equal(after.produced, 386, '🔴 ยุบคู่แล้วยอดผลิต/ฐาน %Q ต้องไม่เปลี่ยน (ชิ้น ≠ shot)');

  assert.equal(before.stdMin, 322, 'ของเดิมนับ 386 ชิ้น × 50 วิ = 322 นาที (เกินจริง 2 เท่า)');
  assert.equal(after.stdMin, 161, 'ที่ถูกคือ 193 จังหวะ × 50 วิ = 161 นาที');

  assert.equal(before.pOver, true, 'ของเดิม %P ทะลุ 100 แล้วโดน cap');
  assert.equal(before.P, 100);
  assert.equal(after.pOver, false, 'ยุบคู่แล้วต้องไม่ตันเพดานอีก');
  assert.ok(after.P > 60 && after.P < 90, `%P ต้องกลับมาอยู่ในย่านที่อ่านได้ (ได้ ${after.P})`);
});

test('🛡️ ไลน์ที่ไม่มีงานคู่ — ส่ง pairMap ไปก็ต้องได้เลขเดิมเป๊ะ', () => {
  const solo = {
    ...HDF1,
    orders: [{ status: 'open', qty_actual: 196, mat_no: '20067039', opened_at: '2026-09-17T08:00:00' }],
    ctMap: { 20067039: 73 },
  };
  const a = computeLiveOee({ ...solo });
  const b = computeLiveOee({ ...solo, pairMap: PAIR_MAT });
  assert.deepEqual(b, a, 'พาร์ทเดี่ยวต้องไม่ถูกแตะแม้ส่ง pairMap');
});
