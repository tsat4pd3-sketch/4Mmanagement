/* ⏱️ ไลน์หยุด 1 ครั้ง = 4 ช่วง (11/11 · user วาดไดอะแกรมมาให้ + เคาะชื่อช่วง ④ = "คืนไลน์")
 * 🔴 M/C Breakdown = Line stop → Repair Done (①+②+③) · Line stop = ①+②+③+④
 * 🔴 ไม่รู้ = null ห้าม 0 · เวลาย้อนหลัง = ไม่สอดคล้อง ห้ามปัดเป็น 0 เงียบ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { moTimeline, mcBreakdownMinOf, MO_SEGMENTS, segMeta } from '../mtnTimeline.js';

const T = (h, m) => `2026-11-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`;
/* เคสปกติ: หยุด 09:00 · เรียกช่าง 09:02 · ช่างรับ 09:07 · ซ่อมเสร็จ 09:20 · เดินอีกครั้ง 09:30 */
const OK = {
  lineStopAt: T(9, 0), callAt: T(9, 2), ackAt: T(9, 7),
  repairDoneAt: T(9, 20), runAgainAt: T(9, 30), lineStopMin: 30,
};

test('แบ่ง 4 ช่วงตามไดอะแกรม + ชื่อช่วงตรงตามที่เคาะ', () => {
  const r = moTimeline(OK);
  assert.deepEqual(r.segs.map(s => s.key), ['precall', 'mtta', 'ttr', 'restart']);
  assert.deepEqual(r.segs.map(s => s.min), [2, 5, 13, 10]);
  assert.equal(r.segs[3].label, 'คืนไลน์ (Restart)');
  assert.equal(segMeta('restart').owner, 'prod', 'ช่วงคืนไลน์เป็นของฝ่ายผลิต ไม่ใช่ของช่าง');
  assert.equal(segMeta('mtta').owner, 'mtn');
  assert.equal(r.missing.length, 0);
  assert.equal(r.outOfOrder, false);
});

test('🔴 M/C Breakdown = Line stop → Repair Done (ไม่รวมคืนไลน์) · Line stop รวมทุกช่วง', () => {
  const r = moTimeline(OK);
  assert.equal(r.mcBreakdownMin, 20, '09:00 → 09:20');
  assert.equal(r.lineStopMin, 30, 'ใช้ duration_min ที่ฝ่ายผลิตลงไว้');
  assert.equal(r.restartMin, 10);
  assert.equal(r.lineStopMin - r.mcBreakdownMin, r.restartMin, 'ส่วนต่าง = ช่วงคืนไลน์พอดี');
});

test('🔴 ใช้ duration_min ก่อนเสมอ ห้ามคิดใหม่จาก started/ended', () => {
  /* ฝ่ายผลิตลง 45 นาที แม้เวลาหัว-ท้ายจะห่างกัน 30 — ต้องเชื่อ duration_min (เลขที่ KPI ใช้) */
  assert.equal(moTimeline({ ...OK, lineStopMin: 45 }).lineStopMin, 45);
  /* ไม่มี duration_min = ถอยไปคิดจาก 2 ปลาย */
  const { lineStopMin, ...noDur } = OK;
  assert.equal(moTimeline(noDur).lineStopMin, 30);
});

test('🔴 stamp ขาด = null + บอกว่าขาดอะไร ห้ามเป็น 0', () => {
  const r = moTimeline({ ...OK, ackAt: null });
  assert.equal(r.segs.find(s => s.key === 'mtta').min, null);
  assert.equal(r.segs.find(s => s.key === 'ttr').min, null);
  assert.equal(r.segs.find(s => s.key === 'mtta').known, false);
  assert.match(r.missing.join(' '), /ช่างรับงาน/);
  /* กฎ 3 — ช่วงกลางหายแต่ยังตอบ M/C Breakdown ได้ เพราะคิดจาก 2 ปลาย */
  assert.equal(r.mcBreakdownMin, 20);
  /* ไม่มีใบ MO เลย (รู้แค่ไลน์หยุด) */
  const bare = moTimeline({ lineStopAt: T(9, 0), runAgainAt: T(9, 30), lineStopMin: 30 });
  assert.equal(bare.mcBreakdownMin, null, 'ไม่รู้ Repair Done = ตอบ M/C Breakdown ไม่ได้');
  assert.equal(bare.lineStopMin, 30, 'แต่ไลน์หยุดยังรู้');
  assert.equal(bare.restartMin, null);
});

test('🔴 กดปุ่มย้อนหลัง (เวลาไม่เรียง) = outOfOrder + ช่วงนั้น null ห้ามปัดเป็น 0', () => {
  /* ซ่อมเสร็จ 10:30 ทั้งที่ไลน์เดินไปตั้งแต่ 09:30 — เกิดจริง 34% ของใบ */
  const r = moTimeline({ ...OK, repairDoneAt: T(10, 30) });
  assert.equal(r.outOfOrder, true);
  assert.equal(r.segs.find(s => s.key === 'restart').min, null, 'ติดลบ = ไม่รู้ ไม่ใช่ 0');
  assert.equal(r.segs.find(s => s.key === 'restart').known, false);
  /* กฎ 3 — M/C Breakdown ห้ามล้นเกิน Line stop */
  assert.equal(r.mcBreakdownMin, 30, 'ตัดที่ Line stop (90 นาทีดิบต้องไม่หลุดออกไป)');
});

test('mcBreakdownMinOf — ตัด ④ ได้เฉพาะเมื่อรู้ ④ จริง', () => {
  assert.deepEqual(mcBreakdownMinOf(30, 10), { min: 20, trimmed: true });
  /* 🔴 ไม่มีใบ MO = ไม่รู้ ④ ⇒ ใช้เวลาเต็ม ห้ามเดาเป็น 0 แล้วตัดมั่ว */
  assert.deepEqual(mcBreakdownMinOf(30, null), { min: 30, trimmed: false });
  assert.deepEqual(mcBreakdownMinOf(30, 0), { min: 30, trimmed: false }, '④ = 0 ก็คือไม่ได้ตัดอะไร');
  /* ④ ยาวกว่าไลน์หยุด (ข้อมูลเพี้ยน) = 0 ห้ามติดลบ */
  assert.deepEqual(mcBreakdownMinOf(10, 99), { min: 0, trimmed: true });
  assert.deepEqual(mcBreakdownMinOf(null, 5), { min: null, trimmed: false });
});

test('ของเข้าแปลกๆ ไม่ทำให้ล้ม', () => {
  for (const bad of [null, undefined, {}, 'x', 42]) {
    const r = moTimeline(bad);
    assert.equal(r.segs.length, 4);
    assert.ok(r.segs.every(s => s.min === null));
    assert.equal(r.mcBreakdownMin, null);
    assert.equal(r.lineStopMin, null);
  }
  assert.equal(MO_SEGMENTS.length, 4, 'ทะเบียนช่วงต้องมี 4 ช่วง — เพิ่ม/ลดต้องตามไปแก้จอที่วาดแถบ');
  assert.equal(segMeta('ไม่มี'), null);
});
