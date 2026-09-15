/* เทส %A/%P สดของกะที่ยังไม่ปิด — computeLiveOee (src/utils/oee.js)
   ที่มา: คำสั่ง user 2026-09-14 "%A มันควรสูตรเดียวกันหมด ทำไมถึงมีแบบไม่หัก planned กับแบบหักล่ะ"
   ⇒ เทสล็อกว่า A สด = สูตรเดียวกับ computeOEE ตอนปิดกะ:
        netAvail = elapsed − หยุดตามแผน − เวลาพักตามนโยบาย
        A        = (netAvail − หยุดนอกแผน) / netAvail
   ห้ามแก้เทสนี้ให้ผ่านด้วยการกลับไปหาร elapsed ดิบ — นั่นคือบั๊กที่แก้ไปแล้ว */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLiveOee, policyBreakOverlapMin, breakIntervalsIn, dtMinOutsideBreaks } from '../oee.js';

const WD = '2026-09-01';
const OPEN = new Date(`${WD}T08:00:00`).getTime();
const at = (min) => OPEN + min * 60000;

/* นโยบายพักกะเช้าชุดจริงในฐาน (ทุกแถว process_type = 'common') */
const DAY_BREAKS = [
  { shift: 'day', process_type: 'common', start_time: '08:00:00', duration_min: 10 },
  { shift: 'day', process_type: 'common', start_time: '10:00:00', duration_min: 10 },
  { shift: 'day', process_type: 'common', start_time: '11:50:00', duration_min: 50 },
  { shift: 'day', process_type: 'common', start_time: '15:00:00', duration_min: 10 },
  { shift: 'day', process_type: 'common', start_time: '17:10:00', duration_min: 20 },
];
const SESSION = { start_time: '08:00:00', shift_min: 570, shift: 'day', work_date: WD };
const dt = (min, planned = false, startMin = 60) => ({
  machine_no: null, started_at: new Date(at(startMin)).toISOString(),
  ended_at: new Date(at(startMin + min)).toISOString(), duration_min: min,
  dr_downtime_types: { category: planned ? 'planned' : 'unplanned' },
});
const live = (extra = {}) => computeLiveOee({
  session: SESSION, orders: [], downtimes: [], workDate: WD, nowMs: at(570),
  breakPolicies: DAY_BREAKS, ...extra,
});

test('A สด: หักเวลาพัก + แยกหยุดตามแผนออกจากตัวหาร (สูตรเดียวกับตอนปิดกะ)', () => {
  const r = live({ downtimes: [dt(60, true), dt(30, false, 300)] });
  assert.equal(r.breakMin, 100, 'กะ 08:00-17:30 พักตามนโยบาย 100 นาที');
  assert.equal(r.plannedDtMin, 60);
  assert.equal(r.unplannedDtMin, 30);
  assert.equal(r.netAvailMin, 410, 'netAvail = 570 − 60 (ตามแผน) − 100 (พัก)');
  assert.equal(r.runMin, 380);
  assert.equal(r.A, 92.7, '380/410 — ไม่ใช่ (570−90)/570 = 84.2 แบบสูตรเก่า');
});

test('A สด ต้องเท่ากับสูตรตอนปิดกะเป๊ะ (คำนวณมือด้วยสูตร computeOEE)', () => {
  const shiftMin = 570, plannedDT = 60 + 100, unplanned = 30;      // logged planned + policy break
  const netAvail = shiftMin - plannedDT;
  const expected = Math.round(((netAvail - unplanned) / netAvail) * 1000) / 10;
  assert.equal(live({ downtimes: [dt(60, true), dt(30, false, 300)] }).A, expected);
});

test('หยุดตามแผนไม่กดค่า A — แต่หยุดนอกแผนเท่ากันต้องกด', () => {
  const planned = live({ downtimes: [dt(60, true)] });
  const unplanned = live({ downtimes: [dt(60, false)] });
  assert.equal(planned.A, 100, 'PM ตามแผน = ไม่ใช่ความสูญเสียของ A');
  assert.ok(unplanned.A < 100 && unplanned.A > 80);
  assert.ok(planned.netAvailMin < unplanned.netAvailMin, 'ตามแผนหักจากตัวหาร · นอกแผนหักจากตัวตั้ง');
});

test('ไม่ส่งนโยบายพัก = ไม่หักพัก + ต้องตั้งธง noBreakPolicy ให้จอรู้ว่าเทียบกับค่า stamp ไม่ได้', () => {
  const r = computeLiveOee({ session: SESSION, orders: [], downtimes: [dt(30)], workDate: WD, nowMs: at(570) });
  assert.equal(r.noBreakPolicy, true);
  assert.equal(r.breakMin, 0);
  assert.notEqual(r.A, live({ downtimes: [dt(30)] }).A, 'ต่างจากตอนส่งนโยบายมาแน่นอน');
});

test('ยังอยู่ในประชุมแถว/พักทั้งช่วง (netAvail ≤ 0) = ประเมินไม่ได้ → null ห้ามคืน A = 0', () => {
  // 08:00-08:10 คือประชุมแถว 10 นาที — elapsed 10 นาทีพอดี ⇒ netAvail = 0
  const r = computeLiveOee({
    session: SESSION, orders: [], downtimes: [], workDate: WD, nowMs: at(10), breakPolicies: DAY_BREAKS,
  });
  assert.equal(r, null);
});

test('downtime ที่ยังเปิดค้าง นับถึงตอนนี้ และแยก planned/unplanned ได้เหมือนกัน', () => {
  // เปิดค้าง 17:00 → ตอนนี้ 17:30 = 30 นาที แต่ 17:10-17:30 เป็น 5ส. (พักตามนโยบาย)
  // ⇒ หักจากฐานเวลาได้แค่ 10 นาที · อีก 20 ถูกกันออกไปแล้วตอนหักพัก (ห้ามหักซ้ำ · oee.js §3.1)
  const open = { machine_no: null, started_at: new Date(at(540)).toISOString(), ended_at: null, duration_min: null,
    dr_downtime_types: { category: 'unplanned' } };
  const r = live({ downtimes: [open] });
  assert.equal(r.unplannedDtMin, 10, 'เปิดค้าง 30 นาที − 20 นาทีที่ทับ 5ส. = 10');
  // ไม่ทับพักเลย (10:20-10:50) ต้องนับเต็ม 30 เหมือนเดิม
  const clear = { machine_no: null, started_at: new Date(at(140)).toISOString(), ended_at: null, duration_min: null,
    dr_downtime_types: { category: 'unplanned' } };
  assert.equal(live({ downtimes: [clear], nowMs: at(170) }).unplannedDtMin, 30);
});

/* ═══ 🔴 downtime ที่ทับ "เวลาพักตามนโยบาย" ห้ามหักซ้ำ (2026-09-15 · user ถาม) ═══
   พักเป็น planned stop ที่ถูกกันออกจากฐานเวลาไปแล้ว — บวก duration_min เต็มใบเข้าไปอีก = หักซ้ำ
   วัดจริง 90 วัน: 664/1,298 กะโดน · %A ต่ำกว่าจริงเฉลี่ย 1.52 จุด (สูงสุด 41.1) · %P เฟ้อ
   ห้ามแก้เทสกลุ่มนี้ให้ผ่านด้วยการกลับไปบวก duration_min ดิบ */
test('DT คร่อมพักกลางวัน — หักเฉพาะนาทีนอกพัก', () => {
  // เครื่องเสีย 11:30-13:00 (90 น.) · พักกลางวัน 11:50-12:40 (50 น.) ⇒ นับเป็น DT ได้ 40 น.
  const d = { machine_no: null, started_at: new Date(at(210)).toISOString(),
    ended_at: new Date(at(300)).toISOString(), duration_min: 90,
    dr_downtime_types: { category: 'unplanned' } };
  const r = live({ downtimes: [d] });
  assert.equal(r.unplannedDtMin, 40, '90 − 50 (ทับพักกลางวัน) = 40');
  assert.equal(r.netAvailMin, 470, '570 − 100 (พัก) — ไม่มีหยุดตามแผน');
  assert.equal(r.runMin, 430, '470 − 40 · สูตรเก่าได้ 380 = หักซ้ำ 50 นาที');
});

test('DT อยู่ในช่วงพักทั้งก้อน — ไม่หักเลย (เวลานั้นไม่ได้ตั้งใจเดินเครื่องอยู่แล้ว)', () => {
  const d = { machine_no: null, started_at: new Date(at(230)).toISOString(),   // 11:50
    ended_at: new Date(at(260)).toISOString(), duration_min: 30,               // 12:20
    dr_downtime_types: { category: 'unplanned' } };
  assert.equal(live({ downtimes: [d] }).unplannedDtMin, 0);
  assert.equal(live({ downtimes: [d] }).A, 100, 'เสียตอนพัก = ไม่กระทบ %A');
});

test('หยุดตามแผนคร่อมพัก — netAvail ต้องไม่ยุบ 2 รอบ', () => {
  // นับสต๊อก 11:00-14:00 (180 น.) คร่อมพักกลางวัน 50 น. ⇒ หักจริง 130
  const d = { machine_no: null, started_at: new Date(at(180)).toISOString(),
    ended_at: new Date(at(360)).toISOString(), duration_min: 180,
    dr_downtime_types: { category: 'planned' } };
  const r = live({ downtimes: [d] });
  assert.equal(r.plannedDtMin, 130);
  assert.equal(r.netAvailMin, 340, '570 − 100 (พัก) − 130 · สูตรเก่าได้ 290 = ตัวหาร %P เล็กเกินจริง');
});

test('breakIntervalsIn: คืนช่วงเวลา + รวมช่วงที่ทับกัน (ห้ามนับพักซ้อน)', () => {
  const iv = breakIntervalsIn({ policies: DAY_BREAKS, startMs: OPEN, endMs: at(570), workDate: WD, shift: 'day' });
  assert.equal(iv.length, 5);
  assert.equal(iv.reduce((a, [x, y]) => a + (y - x) / 60000, 0), 100);
  // นโยบาย 2 แถวที่ทับกันเอง ต้องถูก union ไม่ใช่บวกซ้ำ
  const dup = [
    { shift: 'day', process_type: 'common', start_time: '10:00:00', duration_min: 30 },
    { shift: 'day', process_type: 'common', start_time: '10:10:00', duration_min: 30 },
  ];
  const iv2 = breakIntervalsIn({ policies: dup, startMs: OPEN, endMs: at(570), workDate: WD, shift: 'day' });
  assert.equal(iv2.length, 1);
  assert.equal((iv2[0][1] - iv2[0][0]) / 60000, 40, '10:00-10:40 = 40 นาที ไม่ใช่ 60');
});

test('dtMinOutsideBreaks: แถวไม่มีเวลาเริ่ม ตัดไม่ได้ → คืนเต็มตามเดิม (ห้ามเดา)', () => {
  const iv = breakIntervalsIn({ policies: DAY_BREAKS, startMs: OPEN, endMs: at(570), workDate: WD, shift: 'day' });
  assert.equal(dtMinOutsideBreaks({ duration_min: 45, started_at: null }, iv), 45);
});

/* ── ot_scope: พักที่เกิด "อย่างใดอย่างหนึ่ง" ระหว่างวันทำโอ/ไม่ทำโอ (2026-09-14) ──
   เคสจริงที่ user จับได้: กะเช้าไม่ทำโอหัก 100 · ทำโอหัก 150 → ต่างกัน 50 ทั้งที่ควรต่าง 30
   เพราะ 5ส. ถูกนับทั้ง 17:10 (ไม่ทำโอ) และ 19:40 (ทำโอ) */
const FULL_DAY = [
  { shift: 'day', process_type: 'common', start_time: '08:00:00', duration_min: 10, ot_scope: 'always' },
  { shift: 'day', process_type: 'common', start_time: '10:00:00', duration_min: 10, ot_scope: 'always' },
  { shift: 'day', process_type: 'common', start_time: '11:50:00', duration_min: 50, ot_scope: 'always' },
  { shift: 'day', process_type: 'common', start_time: '15:00:00', duration_min: 10, ot_scope: 'always' },
  { shift: 'day', process_type: 'common', start_time: '17:10:00', duration_min: 20, ot_scope: 'no_ot' },  // 5ส. วันไม่ทำโอ
  { shift: 'day', process_type: 'common', start_time: '17:30:00', duration_min: 30, ot_scope: 'ot' },     // เบรค OT
  { shift: 'day', process_type: 'common', start_time: '19:40:00', duration_min: 20, ot_scope: 'ot' },     // 5ส. วันทำโอ
];
const brkFor = (shiftMin, policies = FULL_DAY) => policyBreakOverlapMin({
  policies, startMs: OPEN, endMs: at(shiftMin), workDate: WD, shift: 'day',
});

test('ot_scope: กะเช้าทำโอกับไม่ทำโอ ต้องต่างกันแค่เบรค OT 30 นาที (ไม่ใช่ 50)', () => {
  assert.equal(brkFor(570), 100, 'ไม่ทำโอ 08:00-17:30 = ประชุม 10 + เบรค 10 + พักกลางวัน 50 + เบรค 10 + 5ส. 20');
  assert.equal(brkFor(720), 130, 'ทำโอ 08:00-20:00 = 100 − 5ส.(ไม่ทำโอ) 20 + เบรค OT 30 + 5ส.(ทำโอ) 20');
  assert.equal(brkFor(720) - brkFor(570), 30, 'ต่างกันแค่เบรค OT — เคยเป็น 50 เพราะนับ 5ส. 2 รอบ');
});

test('ot_scope: แถวที่ไม่ได้ตั้ง (undefined/always) = พฤติกรรมเดิมเป๊ะ — migration ยังไม่ apply ก็ไม่พัง', () => {
  const legacy = FULL_DAY.map(p => ({ shift: p.shift, process_type: p.process_type, start_time: p.start_time, duration_min: p.duration_min }));
  assert.equal(brkFor(720, legacy), 150, 'ไม่มีคอลัมน์ = นับทุกแถวเหมือนเดิม');
  assert.equal(brkFor(570, legacy), 100);
});

test('ot_scope: กะสั้นที่ไม่แตะนโยบาย ot เลย ต้องไม่ถูกมองว่าทำโอ', () => {
  assert.equal(brkFor(540), 80, 'เลิก 17:00 — ยังไม่ถึง 5ส. 17:10 ด้วยซ้ำ');
  // เลิก 18:00 = ทำโอ (แตะเบรค OT 17:30 เต็ม 30 นาที) ⇒ ทิ้ง 5ส.(ไม่ทำโอ) · ยังไม่ถึง 5ส.(ทำโอ) 19:40
  assert.equal(brkFor(600), 110, '10+10+50+10 + เบรค OT 30 — ไม่มี 5ส. ทั้งสองรอบ');
});
