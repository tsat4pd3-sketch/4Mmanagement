/* เทสขอบเขตแผนต่อเนื่องหลายกะ/หลายวัน (2026-09-30 · คำสั่ง user
   *"วางได้ทีเดียวทั้ง 2 กะต่อกัน · เกินกะล้นไปกะดึก · เกิน 1 วันล้นไปอีกวัน"*)
   ⏱️ ตรึงวันที่เอง ไม่มี Date.now() — 2026-10-01 = พฤหัส · 10-03 = เสาร์ · 10-04 = อาทิตย์ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, nextShift, runDay, buildHorizon, assignShifts, horizonSummary,
  clipToSegment, sliceBySegments, visibleRows, rowTicks, orderAcrossHorizon, SEG_HOURS,
} from '../planHorizon.js';
import { layoutLots, nextOpenMs } from '../planTimeline.js';

const H = 3600_000, M = 60_000;
const hz = (o = {}) => buildHorizon({ startDate: '2026-10-01', maxSegments: 4, ...o });

test('addDays / nextShift: ดึกจบแล้วขึ้นเช้าของวันถัดไป · ข้ามสิ้นเดือนได้', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(nextShift('2026-10-01', 'day'), { workDate: '2026-10-01', shift: 'night' });
  assert.deepEqual(nextShift('2026-10-01', 'night'), { workDate: '2026-10-02', shift: 'day' });
});

test('🔴 "วันหยุด" 2 ความหมาย — shutdown75 หยุดจริง · ot15/ot2 เปิด OT ได้ (ห้ามเหมารวม)', () => {
  assert.equal(runDay('2026-10-01', 'shutdown75').run, false);
  assert.equal(runDay('2026-10-01', 'ot15').run, false, 'default = ไม่เรียก OT');
  assert.equal(runDay('2026-10-01', 'ot15', { includeOtHoliday: true }).run, true, 'คนวางแผนสั่งเปิด OT ได้');
  assert.equal(runDay('2026-10-01', 'ot2', { includeOtHoliday: true }).run, true);
  assert.equal(runDay('2026-10-01', 'shutdown75', { includeOtHoliday: true }).run, false, 'ม.75 เปิด OT ไม่ได้');
  assert.equal(runDay('2026-10-03', null).run, false, 'เสาร์ไม่มาร์ค = หยุด');
  assert.equal(runDay('2026-10-03', 'working').run, true, 'เสาร์ที่มาร์คว่าทำงาน = เดิน');
  assert.equal(runDay('2026-10-01', null).run, true, 'พฤหัสไม่มาร์ค = เดิน');
});

test('กะต่อกันสนิท — เช้าจบ 20:00 แล้วดึกเริ่ม 20:00 (เครื่องไม่ได้หยุด แค่เปลี่ยนคน)', () => {
  const r = hz();
  assert.equal(r.segments.length, 4);
  assert.deepEqual(r.segments.map(s => `${s.workDate} ${s.shift}`), [
    '2026-10-01 day', '2026-10-01 night', '2026-10-02 day', '2026-10-02 night',
  ]);
  r.segments.forEach((s, i) => {
    assert.equal(s.endMs - s.startMs, SEG_HOURS * H, 'ทุกกะยาว 12 ชม.');
    if (i > 0) assert.equal(s.startMs, r.segments[i - 1].endMs, 'ไม่มีช่องว่างระหว่างกะ');
  });
  assert.deepEqual(r.closed, [], 'ไม่มีวันหยุดคั่น = ไม่มีช่วงปิด');
});

test('🔴 วันหยุดถูกข้าม แต่ต้อง "เห็น" — คืน skipped + ช่วงปิดให้หยุดนับเวลา', () => {
  /* เริ่มศุกร์ 02/10 → เสาร์-อาทิตย์หยุด → ต่อที่จันทร์ 05/10 */
  const r = buildHorizon({ startDate: '2026-10-02', maxSegments: 4 });
  assert.deepEqual(r.segments.map(s => `${s.workDate} ${s.shift}`), [
    '2026-10-02 day', '2026-10-02 night', '2026-10-05 day', '2026-10-05 night',
  ]);
  assert.deepEqual(r.skipped.map(s => s.workDate), ['2026-10-03', '2026-10-04'], 'ห้ามข้ามเงียบ');
  assert.equal(r.closed.length, 1, 'ช่องว่าง เสาร์+อาทิตย์ = 1 ช่วงปิดยาว');
  assert.equal(r.closed[0][1] - r.closed[0][0], 48 * H);
});

test('🔴 หยุดคือหยุดทั้งวัน ไม่ใช่ทีละกะ — ไม่มีกะดึกโผล่ในวันที่โรงงานปิด', () => {
  const r = buildHorizon({ startDate: '2026-10-01', maxSegments: 6, dayTypeOf: (d) => d === '2026-10-02' ? 'shutdown75' : null });
  assert.equal(r.segments.filter(s => s.workDate === '2026-10-02').length, 0);
});

test('📺 1 กะ = 1 บรรทัด — งานคร่อมเส้นแบ่งกะโผล่ทั้ง 2 บรรทัดเป็นท่อนต่อ', () => {
  const r = hz();
  /* ใบเดียว 20 ชม. เริ่ม 08:00 ⇒ กะเช้า 08:00-20:00 (12 ชม.) + กะดึก 20:00-04:00 (8 ชม.) */
  const lay = layoutLots({ lots: [lot('a', 1, 1200)], ctOf, startMs: r.startMs, endMs: r.endMs });
  const rows = sliceBySegments(lay.boxes, r.segments);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].pieces.length, 1);
  assert.equal(rows[1].pieces.length, 1, '🔴 ท่อนต่อต้องโผล่ในกะดึกด้วย ห้ามหาย');
  assert.equal(rows[2].pieces.length, 0);

  const a = rows[0].pieces[0].run, b = rows[1].pieces[0].run;
  assert.equal(a.cutLeft, false);
  assert.equal(a.cutRight, true, 'ท่อนแรกยังไม่จบ — ไปต่อกะถัดไป');
  assert.equal(b.cutLeft, true, 'ท่อนหลังต่อมาจากกะก่อน');
  assert.equal(b.cutRight, false);
  /* พิกัดเป็นสเกลของบรรทัดนั้นเอง (ไม่ใช่ของทั้งขอบเขต) */
  assert.equal(a.leftPct, 0);
  assert.equal(a.widthPct, 100, 'กินเต็มกะเช้า');
  assert.equal(b.leftPct, 0);
  assert.equal(Math.round(b.widthPct), 67, '8 ชม. จาก 12 ชม. ของกะดึก');
});

test('📺 clipToSegment: อยู่นอกกะ = null (ไม่ใช่ความกว้าง 0)', () => {
  const r = hz();
  const s0 = r.segments[0];
  assert.equal(clipToSegment(s0, s0.endMs, s0.endMs + H), null);
  assert.equal(clipToSegment(s0, s0.startMs - 2 * H, s0.startMs), null);
  assert.equal(clipToSegment(null, 1, 2), null);
});

test('📺 visibleRows: วาดถึงกะสุดท้ายที่มีงาน +1 กะว่าง · กะว่างที่คั่นกลางต้องไม่หาย', () => {
  const mk = (flags) => flags.map(f => ({ hasWork: f }));
  assert.equal(visibleRows(mk([true, false, false, false])).length, 2);
  assert.equal(visibleRows(mk([true, false, true, false])).length, 4, 'กะว่างคั่นกลางต้องวาด');
  assert.equal(visibleRows(mk([false, false])).length, 1, 'ยังไม่มีงาน = เห็นรางเปล่า 1 บรรทัด');
  assert.deepEqual(visibleRows([]), []);
});

test('⏭️ nextOpenMs: ไม่เริ่มงานกลางช่วงปิด — ขยับไปเวลาเปิดถัดไป', () => {
  const closed = [[100, 200], [200, 300]];
  assert.equal(nextOpenMs(50, closed), 50);
  assert.equal(nextOpenMs(150, closed), 300, 'ทะลุ 2 ช่วงที่ติดกัน');
  assert.equal(nextOpenMs(300, closed), 300, 'ปลายช่วง = เปิดแล้ว');
});

/* ══ หัวใจของคำสั่ง user: งานล้นกะ → ไหลไปกะดึก → ล้นวัน → ไหลไปวันถัดไป ══ */
const CT = { M1: 60 };                                  // 60 วิ/ชิ้น ⇒ 60 ชิ้น = 60 นาที
const ctOf = (m) => CT[m] ?? null;
const lot = (id, seq, qty) => ({ id, seq, mat_no: 'M1', qty_plan: qty, status: 'planned' });

test('🔗 งาน 20 ชม. ในวันเดียว = ล้นจากกะเช้าไปลงกะดึก (ไม่ใช่ "ใช้ 158% ของกะ" แล้วจบ)', () => {
  const r = hz();
  const lay = layoutLots({
    lots: [lot('a', 1, 720), lot('b', 2, 480)],        // 12 ชม. + 8 ชม.
    ctOf, startMs: r.startMs, endMs: r.endMs, closed: r.closed,
  });
  const at = assignShifts(lay.boxes, r.segments);
  assert.equal(at[0].shift, 'day');
  assert.equal(at[1].shift, 'night', 'ใบที่ 2 ตกกะดึกของวันเดียวกัน');
  assert.equal(at[1].workDate, '2026-10-01');
  assert.equal(at[1].sure, true);
  assert.equal(lay.boxes[1].startMs, r.segments[1].startMs, 'เริ่มพอดีตอนกะเช้าจบ — เครื่องไม่ได้หยุด');
});

test('🔗 งานเกิน 1 วัน = ล้นไปวันถัดไป', () => {
  const r = hz();
  const lay = layoutLots({
    lots: [lot('a', 1, 1440), lot('b', 2, 600)],       // 24 ชม. + 10 ชม.
    ctOf, startMs: r.startMs, endMs: r.endMs, closed: r.closed,
  });
  const at = assignShifts(lay.boxes, r.segments);
  assert.deepEqual([at[0].workDate, at[0].shift], ['2026-10-01', 'day']);
  assert.deepEqual([at[1].workDate, at[1].shift], ['2026-10-02', 'day'], 'ใบที่ 2 ไปโผล่เช้าวันถัดไป');
});

test('🔗 งานคร่อมวันหยุด = เวลาหยุดนับ ไปต่อวันเปิดถัดไป (ไม่ใช่เดินข้ามเสาร์-อาทิตย์)', () => {
  const r = buildHorizon({ startDate: '2026-10-02', maxSegments: 4 });   // ศุกร์ → จันทร์
  const lay = layoutLots({
    lots: [lot('a', 1, 1440), lot('b', 2, 120)],       // 24 ชม. เต็มวันศุกร์ + 2 ชม.
    ctOf, startMs: r.startMs, endMs: r.endMs, closed: r.closed,
  });
  const at = assignShifts(lay.boxes, r.segments);
  assert.deepEqual([at[1].workDate, at[1].shift], ['2026-10-05', 'day'], 'ข้ามเสาร์-อาทิตย์ไปจันทร์');
  assert.equal(lay.boxes[1].startMs, r.segments[2].startMs);
});

test('🔴 ไม่มี CT = จัดกะให้ไม่ได้ (sure=false) — ห้ามบันทึกทับกะเดิม', () => {
  const r = hz();
  const lay = layoutLots({
    lots: [lot('a', 1, 60), { id: 'z', seq: 2, mat_no: 'ZZ', qty_plan: 10, status: 'planned' }, lot('c', 3, 60)],
    ctOf, startMs: r.startMs, endMs: r.endMs,
  });
  const at = assignShifts(lay.boxes, r.segments);
  assert.equal(at[0].sure, true);
  assert.equal(at[1].sure, false, 'ตัวที่ไม่มี CT เอง');
  assert.equal(at[2].sure, false, 'ตัวที่อยู่หลังตัวคำนวณไม่ได้ — เวลาเชื่อไม่ได้');
});

test('🔴 งานล้นเลยขอบเขต = ติดธง overflow (ยังหาที่ลงไม่ได้) ห้ามยัดลงกะสุดท้ายเงียบๆ', () => {
  const r = buildHorizon({ startDate: '2026-10-01', maxSegments: 2 });   // ขอบเขตแค่ 24 ชม.
  const lay = layoutLots({
    lots: [lot('a', 1, 1440), lot('b', 2, 60)],
    ctOf, startMs: r.startMs, endMs: r.endMs,
  });
  const at = assignShifts(lay.boxes, r.segments);
  assert.equal(at[1].overflow, true);
  assert.equal(at[1].workDate, null, 'ไม่รู้ว่าลงวันไหน = null ห้ามเดา');
});

test('📊 สรุป: ใช้กี่กะ · จบเมื่อไหร่ — มีล็อตคำนวณไม่ได้ = finishMs null (ห้ามเดา)', () => {
  const r = hz();
  const mk = (lots) => layoutLots({ lots, ctOf, startMs: r.startMs, endMs: r.endMs });
  const ok = mk([lot('a', 1, 720), lot('b', 2, 480)]);
  const s1 = horizonSummary({ boxes: ok.boxes, segments: r.segments, endMs: ok.endMs, unknownCount: ok.unknownCount });
  assert.equal(s1.shiftsUsed, 2);
  assert.equal(s1.lastSegment.shift, 'night');
  assert.equal(s1.finishMs, ok.endMs);

  const bad = mk([lot('a', 1, 720), { id: 'z', seq: 2, mat_no: 'ZZ', qty_plan: 5, status: 'planned' }]);
  const s2 = horizonSummary({ boxes: bad.boxes, segments: r.segments, endMs: bad.endMs, unknownCount: bad.unknownCount });
  assert.equal(s2.finishMs, null);
});

test('🕐 ป้ายเวลาของบรรทัดเดียว = สเกลของกะนั้น (08:00 → 20:00)', () => {
  const r = hz();
  const t = rowTicks(r.segments[0], 2);
  assert.equal(t.length, 7, '08,10,12,14,16,18,20');
  assert.equal(t[0].label, '08:00');
  assert.equal(t[0].pct, 0);
  assert.equal(t[t.length - 1].label, '20:00');
  assert.equal(t[t.length - 1].pct, 100);
  assert.equal(rowTicks(r.segments[1], 2)[0].label, '20:00', 'กะดึกเริ่ม 20:00');
  assert.deepEqual(rowTicks(null), []);
});

test('ขอบเขตว่าง/ไม่มีวันเริ่ม ต้องไม่พัง', () => {
  const r = buildHorizon({});
  assert.deepEqual(r.segments, []);
  assert.equal(r.startMs, null);
  assert.deepEqual(assignShifts([], []), []);
  assert.deepEqual(sliceBySegments([], []), []);
});

test('🔢 orderAcrossHorizon: seq เป็นลำดับ**ในกะ** ⇒ ต้องเรียงตามกะก่อน ไม่งั้นคิวสลับมั่ว', () => {
  const r = hz();
  const L = (id, wd, sh, seq) => ({ id, work_date: wd, shift: sh, seq });
  /* กะเช้า 1,2,3 · กะดึก 1,2 — เรียงด้วย seq เฉยๆ จะได้ d1,n1,d2,n2,d3 (งานกะดึกแทรกกลาง) */
  const mixed = [
    L('n1', '2026-10-01', 'night', 1), L('d2', '2026-10-01', 'day', 2),
    L('d1', '2026-10-01', 'day', 1),   L('n2', '2026-10-01', 'night', 2),
    L('d3', '2026-10-01', 'day', 3),
  ];
  const out = orderAcrossHorizon(mixed, r.segments);
  assert.deepEqual(out.map(l => l.id), ['d1', 'd2', 'd3', 'n1', 'n2']);
  assert.deepEqual(out.map(l => l.seq), [1, 2, 3, 4, 5], 'นับใหม่ต่อเนื่องทั้งขอบเขต');
});

test('🔢 orderAcrossHorizon: ล็อตที่กะไม่อยู่ในขอบเขต ต่อท้าย ห้ามตัดทิ้ง', () => {
  const r = hz();
  const out = orderAcrossHorizon([
    { id: 'far', work_date: '2026-12-25', shift: 'day', seq: 1 },
    { id: 'now', work_date: '2026-10-01', shift: 'day', seq: 9 },
  ], r.segments);
  assert.deepEqual(out.map(l => l.id), ['now', 'far']);
  assert.equal(out.length, 2);
});
