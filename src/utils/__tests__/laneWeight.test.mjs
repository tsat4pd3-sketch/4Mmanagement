/* ══ ไลน์เครื่องขนาน — นาที downtime ต้องหารด้วยจำนวนเลนก่อนหักจากเวลากะ (oee.js §3.2) ══
   ที่มา (2026-10-12 · recheck ใบรายงาน OEE/Defect PD3+PD4 เดือน ก.ย. 2026):
   `computeSessionOee` หาร 1/N มาตั้งแต่แรก (⇒ %A ที่ stamp ถูก) แต่ `dtMinBySession`
   ซึ่งเป็นตัวป้อน **น้ำหนัก wLoad ของค่าเฉลี่ยรายเดือน** ไม่เคยหาร
   ⇒ LASER-345 (3 เครื่อง) บันทึก DT รายเครื่องรวม 1,025 นาทีบนกะ 720 นาที
     ⇒ plannedMin > shift_min ⇒ wLoad = max(0, …) = 0 ⇒ **กะนั้นหายจากค่าเฉลี่ยโดยไม่มี error**
     (ก.ย. 2026: 11 กะน้ำหนัก 0 · LASER-345 22/37 กะโดนลดน้ำหนักเกินครึ่ง
      ⇒ OEE เดือนเพี้ยน 82.9% → 80.6% แล้วถูก export เป็นฟอร์มไปเซ็น) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneWeightFn, parallelNBySession, dtMinBySession, wLoad } from '../oee.js';

const WD = '2026-09-09';
const sess = (id, line) => ({ id, line_name: line, work_date: WD, shift: 'day', start_time: '08:00:00', shift_min: 720 });
const dt = (sid, min, o = {}) => ({
  session_id: sid, duration_min: min,
  started_at: `${WD}T09:00:00`, ended_at: `${WD}T09:${String(min).padStart(2, '0')}:00`,
  dr_downtime_types: { category: 'planned' }, ...o,
});
const LINES = [
  { name: 'LASER-345', flow_mode: 'one_piece_flow', parallel_stations: 3 },
  { name: 'Line 60', flow_mode: 'one_piece_flow', parallel_stations: null },
];

test('laneWeightFn — หารเฉพาะแถวที่ระบุเครื่อง · ไลน์เลนเดียวไม่หาร', () => {
  const w3 = laneWeightFn(3);
  assert.equal(w3({ machine_no: 'SW10' }), 1 / 3);
  // ไม่ระบุเครื่อง = หยุดทั้งไลน์ (ไฟดับ/ไม่มีแผนผลิต) — หารแล้วจะต่ำกว่าจริง
  assert.equal(w3({ machine_no: null }), 1);
  assert.equal(laneWeightFn(1)({ machine_no: 'SW10' }), 1);
  assert.equal(laneWeightFn()({ machine_no: 'SW10' }), 1);
});

test('parallelNBySession — รับได้ทั้งอาร์เรย์และแมป · ไลน์ที่ไม่รู้จัก = 1 เลน', () => {
  const byArr = parallelNBySession(LINES);
  assert.equal(byArr({ line_name: 'LASER-345' }), 3);
  assert.equal(byArr({ line_name: 'Line 60' }), 1);
  assert.equal(byArr({ line_name: 'ไม่มีในทะเบียน' }), 1);
  const byMap = parallelNBySession(Object.fromEntries(LINES.map(l => [l.name, l])));
  assert.equal(byMap({ line_name: 'LASER-345' }), 3);
});

test('🔴 dtMinBySession + { lines } — DT รายเครื่องของไลน์ขนานถูกหาร ⇒ wLoad ไม่เหลือ 0', () => {
  const s = sess('s1', 'LASER-345');
  const rows = [dt('s1', 340, { machine_no: 'L3' }), dt('s1', 340, { machine_no: 'L4' }), dt('s1', 345, { machine_no: 'L5' })];

  // เดิม (ไม่ส่ง lines) — 1,025 นาทีบนกะ 720 ⇒ น้ำหนักเหลือ 0 = กะหายจากค่าเฉลี่ย
  const before = dtMinBySession([s], rows, []);
  assert.equal(Math.round(before.s1.planned), 1025);
  assert.equal(wLoad({ ...s, plannedMin: before.s1.planned }), 0);

  // ใหม่ — หาร 3 เลน ⇒ ~342 นาทีของไลน์ ⇒ เวลารับภาระ ~378 นาที
  const after = dtMinBySession([s], rows, [], { lines: LINES });
  assert.equal(Math.round(after.s1.planned), 342);
  assert.equal(Math.round(wLoad({ ...s, plannedMin: after.s1.planned })), 378);
});

test('ไลน์เลนเดียว — ส่ง lines แล้วตัวเลขต้องเท่าเดิมเป๊ะ (ห้ามกระทบไลน์ปกติ)', () => {
  const s = sess('s2', 'Line 60');
  const rows = [dt('s2', 60, { machine_no: 'W1' }), dt('s2', 30, { machine_no: null, dr_downtime_types: { category: 'breakdown' } })];
  const a = dtMinBySession([s], rows, []);
  const b = dtMinBySession([s], rows, [], { lines: LINES });
  assert.deepEqual(a.s2, b.s2);
  assert.equal(Math.round(b.s2.planned), 60);
  assert.equal(Math.round(b.s2.unplanned), 30);
});

test('กะที่ไม่ได้ส่งมาใน sessions (ไม่รู้ไลน์) = น้ำหนัก 1 — ห้ามเดาว่าเป็นไลน์ขนาน', () => {
  const out = dtMinBySession([], [dt('ghost', 90, { machine_no: 'L3' })], [], { lines: LINES });
  assert.equal(Math.round(out.ghost.planned), 90);
});
