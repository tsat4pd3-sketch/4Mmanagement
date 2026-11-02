/**
 * ข้อยกเว้นเวลาพัก "รายไลน์" (`break_line_rules`) — 2026-10-20
 *
 * ที่มา: feedback หน้างาน *"เราแค่สามารถตั้งได้รึป่าว ว่า แต่ละไลน์จะไห้มาตรฐาน 5ส กี่นาที
 * บางไลน์เค้าทำ5สก่อนเลิกงานแค่ 10นาที หรือ5นาทีก็มี"*
 *
 * 🔴 สิ่งที่เทสชุดนี้ล็อกไว้:
 *   ① ไลน์ที่**ไม่ได้ตั้งอะไร** ต้องได้ช่วงพักเท่าเดิมทุกนาที + ได้ **array เดิม (===)**
 *      — ตัวเลข %A/%P ย้อนหลังทั้งโรงงานห้ามขยับจากงานนี้
 *   ② ไลน์ลูกตกทอดจากไลน์แม่ (ลึกหลายชั้น) · 🔴 ลูกที่ตั้งเองไว้ **ตัวเองชนะแม่**
 *   ③ ไลน์พี่น้องไม่โดนหางเลข
 *   ④ พักท้ายกะ (5ส.) เลื่อนโดย **รักษาระยะถึงปลายกะ** ไม่ใช่ค้าง offset เดิม
 *   ⑤ `duration_min = 0` = ไลน์นี้ไม่มีพักรายการนั้น (ไม่ใช่ค่าว่าง)
 *   ⑥ 🔴 `isOt` ต้องตัดสินจาก**ค่ากลาง** — ไลน์ที่ตั้งพักโอเป็น 0 ห้ามปลุกนโยบาย `no_ot` กลับมา
 *   ⑦ ไลน์ที่มีกฎแต่ไม่อยู่ในทะเบียน = รายงานเป็น `orphanLines` (ห้ามกลืน) แต่ยังใช้ได้แบบตรงชื่อ
 *   ⑧ ค่านาทีที่แกะไม่ออก/นอกช่วง = `null` (ห้ามเดา 0 — 0 มีความหมายของมันเอง)
 *   ⑩ แถบเงาบนบอร์ดไทม์ไลน์ (`halfDayBreakBands`) — ช่วงต้องตรงกับ `halfDayBreakIntervals`
 *      เป๊ะ + ติดป้ายชื่อพักและ "ไลน์นี้ตั้งเองกี่นาที" มาด้วย (20/10 รอบที่ 2)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakIntervalsIn } from '../oee.js';
import {
  buildBreakLineRuleIndex, applyBreakLineRules, breakRulesForLine,
  ruleDurationOf, hasBreakLineRules,
} from '../breakLineRules.js';

const WD = '2026-10-20';
const at = (hhmm, dayOffset = 0) => new Date(`${WD}T${hhmm}:00`).getTime() + dayOffset * 86400000;
const span = (iv) => iv.map(([a, b]) =>
  `${new Date(a).toTimeString().slice(0, 5)}-${new Date(b).toTimeString().slice(0, 5)}`).join(' ');
const total = (iv) => iv.reduce((s, [a, b]) => s + (b - a) / 60000, 0);

/* ทะเบียนไลน์ทดสอบ — GOR มีลูก 2 ตัว · GOR 1 มีลูกอีกชั้น (หลาน) */
const LINES = [
  { name: 'GOR',     parent_line_name: null },
  { name: 'GOR 1',   parent_line_name: 'GOR' },
  { name: 'GOR 2',   parent_line_name: 'GOR' },
  { name: 'GOR 1A',  parent_line_name: 'GOR 1' },
  { name: 'LINE C',  parent_line_name: null },
];

/* ชุดนโยบายกลาง — ตรงกับของจริงหลัง migration 20/10 (5ส. = แถวเดียวผูกปลายกะ) */
/* 🔴 `name_th` ต้องมี — เทส ⑩ ล็อกว่าป้ายบนแถบต้องเป็นชื่อพักจริง ไม่ใช่ "undefined"/"พัก" */
const P_LUNCH = { id: 'p-lunch', name_th: 'พักกลางวัน',  shift: 'day',  start_time: '11:50:00', duration_min: 50, process_type: 'common', ot_scope: 'always', anchor: 'clock' };
const P_5S    = { id: 'p-5s',    name_th: '5ส. ท้ายกะ',  shift: 'both', start_time: null,       duration_min: 20, process_type: 'common', ot_scope: 'always', anchor: 'shift_end', offset_min: 20 };
const P_OTBRK = { id: 'p-ot',    name_th: 'เบรค OT',     shift: 'day',  start_time: '17:30:00', duration_min: 30, process_type: 'common', ot_scope: 'ot',    anchor: 'clock' };
const POLICIES = [P_LUNCH, P_5S, P_OTBRK];

/** กฎรายไลน์ชุดมาตรฐานของเทส ⑩ — ไลน์แม่ GOR ตั้ง 5ส. 10 นาที (ลูกตกทอด · LINE C ไม่เกี่ยว) */
const ROWS_5S = [{ policy_id: 'p-5s', line_name: 'GOR', duration_min: 10 }];

/** กะเช้าปกติ 08:00–17:30 */
const dayShift = (extra = {}) => ({
  policies: POLICIES, startMs: at('08:00'), endMs: at('17:30'), workDate: WD,
  shift: 'day', shiftEndMs: at('17:30'), ...extra,
});

const idx = (rows) => buildBreakLineRuleIndex(rows, LINES);

/* ─── ① ไลน์ที่ไม่ได้ตั้งอะไร = เหมือนเดิมเป๊ะ ─────────────────────────────────── */
test('ไม่มีกฎรายไลน์เลย → ช่วงพักเท่าเดิม + คืน array เดิม (===)', () => {
  const base = breakIntervalsIn(dayShift());
  assert.equal(span(base), '11:50-12:40 17:10-17:30');

  const empty = idx([]);
  assert.equal(hasBreakLineRules(empty), false);
  assert.equal(applyBreakLineRules(POLICIES, empty, 'GOR 1'), POLICIES);     // ← array เดิม ไม่ใช่สำเนา
  assert.equal(applyBreakLineRules(POLICIES, null, 'GOR 1'), POLICIES);
  assert.equal(span(breakIntervalsIn(dayShift({ lineRules: empty, lineName: 'GOR 1' }))), span(base));
});

test('ไลน์ที่ไม่ได้ตั้ง แม้ทะเบียนมีกฎของไลน์อื่น → array เดิม + ช่วงพักเท่าเดิม', () => {
  const i = idx([{ policy_id: 'p-5s', line_name: 'LINE C', duration_min: 5 }]);
  const base = breakIntervalsIn(dayShift());
  assert.equal(applyBreakLineRules(POLICIES, i, 'GOR 1'), POLICIES);
  assert.equal(span(breakIntervalsIn(dayShift({ lineRules: i, lineName: 'GOR 1' }))), span(base));
});

/* ─── ②③ ตกทอดแม่→ลูก · ตัวเองชนะแม่ · พี่น้องไม่โดน ──────────────────────────── */
test('ตั้งที่ไลน์แม่ → ลูกและหลานได้ตามกัน · พี่น้องของแม่ไม่โดน', () => {
  const i = idx([{ policy_id: 'p-5s', line_name: 'GOR', duration_min: 10 }]);
  for (const ln of ['GOR', 'GOR 1', 'GOR 2', 'GOR 1A']) {
    assert.equal(breakRulesForLine(i, ln).get('p-5s'), 10, ln);
  }
  assert.equal(breakRulesForLine(i, 'LINE C'), null);                        // ไลน์นอกสายไม่โดน
  assert.equal(i.orphanLines.length, 0);
  assert.equal(i.ruleCount, 1);
});

test('🔴 ลูกตั้งเองไว้ = ตัวเองชนะแม่ (กฎ "ชื่อไลน์ตัวเองชนะไลน์แม่เสมอ")', () => {
  const i = idx([
    { policy_id: 'p-5s', line_name: 'GOR',   duration_min: 10 },
    { policy_id: 'p-5s', line_name: 'GOR 1', duration_min: 5 },
  ]);
  assert.equal(breakRulesForLine(i, 'GOR').get('p-5s'), 10);
  assert.equal(breakRulesForLine(i, 'GOR 1').get('p-5s'), 5);
  assert.equal(breakRulesForLine(i, 'GOR 1A').get('p-5s'), 5);               // หลานตามพ่อ (ไม่ใช่ปู่)
  assert.equal(breakRulesForLine(i, 'GOR 2').get('p-5s'), 10);               // พี่น้องยังตามปู่
});

test('ตั้งคนละรายการพักกันระหว่างแม่-ลูก → รวมกัน ไม่ทับกันทั้งชุด', () => {
  const i = idx([
    { policy_id: 'p-5s',    line_name: 'GOR',   duration_min: 10 },
    { policy_id: 'p-lunch', line_name: 'GOR 1', duration_min: 40 },
  ]);
  const m = breakRulesForLine(i, 'GOR 1');
  assert.equal(m.get('p-5s'), 10);        // ตกทอดจากแม่
  assert.equal(m.get('p-lunch'), 40);     // ของตัวเอง
  assert.equal(breakRulesForLine(i, 'GOR').get('p-lunch'), undefined);       // แม่ไม่ได้รับจากลูก
});

/* ─── ④ พักท้ายกะ — รักษาระยะถึงปลายกะ ────────────────────────────────────────── */
test('5ส. ท้ายกะ: ไลน์ตั้ง 10 นาที → ได้ 10 นาทีสุดท้ายของกะ (ไม่ใช่ 17:10-17:20)', () => {
  const i = idx([{ policy_id: 'p-5s', line_name: 'GOR 1', duration_min: 10 }]);
  const iv = breakIntervalsIn(dayShift({ lineRules: i, lineName: 'GOR 1' }));
  assert.equal(span(iv), '11:50-12:40 17:20-17:30');
  assert.equal(total(iv), 60);                                               // 50 + 10
});

test('5ส. ท้ายกะ: เลื่อนตามเวลาเลิกกะของวันนั้น (วันหยุดมาโอ 8 ชม. เลิก 17:00)', () => {
  const i = idx([{ policy_id: 'p-5s', line_name: 'GOR 1', duration_min: 10 }]);
  const iv = breakIntervalsIn(dayShift({
    endMs: at('17:00'), shiftEndMs: at('17:00'), lineRules: i, lineName: 'GOR 1',
  }));
  assert.equal(span(iv), '11:50-12:40 16:50-17:00');
});

test('5ส. ท้ายกะ: กะดึก (เลิก 08:00 วันถัดไป) ไลน์ตั้ง 5 นาที', () => {
  const i = idx([{ policy_id: 'p-5s', line_name: 'GOR 2', duration_min: 5 }]);
  const iv = breakIntervalsIn({
    policies: POLICIES, startMs: at('20:00'), endMs: at('08:00', 1), workDate: WD,
    shift: 'night', shiftEndMs: at('08:00', 1), lineRules: i, lineName: 'GOR 2',
  });
  assert.equal(span(iv), '07:55-08:00');
  assert.equal(total(iv), 5);
});

test('ค่ากลางที่พักจบ "ก่อน" เลิกกะ (offset 30 / ยาว 20) → ไลน์ตั้ง 10 ต้องรักษาช่องว่าง 10 นาที', () => {
  const pols = [{ ...P_5S, offset_min: 30 }];                                 // 17:00-17:20 (เว้น 10 นาที)
  const i = idx([{ policy_id: 'p-5s', line_name: 'GOR 1', duration_min: 10 }]);
  const base = breakIntervalsIn({ policies: pols, startMs: at('08:00'), endMs: at('17:30'), workDate: WD, shift: 'day', shiftEndMs: at('17:30') });
  assert.equal(span(base), '17:00-17:20');
  const iv = breakIntervalsIn({ policies: pols, startMs: at('08:00'), endMs: at('17:30'), workDate: WD, shift: 'day', shiftEndMs: at('17:30'), lineRules: i, lineName: 'GOR 1' });
  assert.equal(span(iv), '17:10-17:20');                                      // ยาว 10 · ยังจบ 17:20 เหมือนเดิม
});

/* ─── ⑤ duration 0 = ไลน์นี้ไม่มีพักรายการนั้น ─────────────────────────────────── */
test('ตั้ง 0 นาที = ไลน์นี้ไม่มีพักรายการนั้น (พักอื่นยังอยู่)', () => {
  const i = idx([{ policy_id: 'p-5s', line_name: 'GOR 1', duration_min: 0 }]);
  assert.equal(breakRulesForLine(i, 'GOR 1').get('p-5s'), 0);
  const iv = breakIntervalsIn(dayShift({ lineRules: i, lineName: 'GOR 1' }));
  assert.equal(span(iv), '11:50-12:40');
  assert.equal(total(iv), 50);
});

test('ตั้งพักเที่ยง (clock) เป็น 0 → ช่วงนั้นหายไป ไม่ใช่กลายเป็นช่วงยาว 0 ที่ค้างในลิสต์', () => {
  const i = idx([{ policy_id: 'p-lunch', line_name: 'GOR 1', duration_min: 0 }]);
  const iv = breakIntervalsIn(dayShift({ lineRules: i, lineName: 'GOR 1' }));
  assert.equal(span(iv), '17:10-17:30');
  assert.equal(iv.length, 1);
});

/* ─── ⑥ isOt ต้องตัดสินจากค่ากลาง ──────────────────────────────────────────────── */
test('🔴 ไลน์ตั้งพักโอเป็น 0 ห้ามปลุกนโยบาย no_ot กลับมา (= หักพักซ้ำ)', () => {
  /* ทะเบียนแบบเก่าที่ยังมี no_ot ปนอยู่ — กรอบกะทำโอถึง 20:00 */
  const pols = [
    P_LUNCH, P_OTBRK,
    { id: 'p-5s-noot', shift: 'day', start_time: '17:10:00', duration_min: 20, process_type: 'common', ot_scope: 'no_ot', anchor: 'clock' },
  ];
  const frame = { policies: pols, startMs: at('08:00'), endMs: at('20:00'), workDate: WD, shift: 'day', shiftEndMs: at('20:00') };
  const base = breakIntervalsIn(frame);
  assert.equal(span(base), '11:50-12:40 17:30-18:00');                        // no_ot ถูกทิ้งเพราะกะนี้ทำโอ

  const i = idx([{ policy_id: 'p-ot', line_name: 'GOR 1', duration_min: 0 }]);
  const iv = breakIntervalsIn({ ...frame, lineRules: i, lineName: 'GOR 1' });
  assert.equal(span(iv), '11:50-12:40');                                      // พักโอหาย · no_ot **ยังไม่กลับมา**
});

/* ─── ⑦ ไลน์กำพร้า (มีกฎแต่ไม่อยู่ในทะเบียน) ──────────────────────────────────── */
test('ไลน์ที่ไม่อยู่ในทะเบียน → รายงานใน orphanLines แต่ยังใช้ได้แบบตรงชื่อ', () => {
  const i = idx([
    { policy_id: 'p-5s', line_name: 'ไลน์ที่ถูกเปลี่ยนชื่อ', duration_min: 15 },
    { policy_id: 'p-5s', line_name: 'GOR', duration_min: 10 },
  ]);
  assert.deepEqual(i.orphanLines, ['ไลน์ที่ถูกเปลี่ยนชื่อ']);
  assert.equal(breakRulesForLine(i, 'ไลน์ที่ถูกเปลี่ยนชื่อ').get('p-5s'), 15);
  assert.equal(breakRulesForLine(i, 'GOR 1').get('p-5s'), 10);                // ของดีไม่โดนกระทบ
});

test('ทะเบียนไลน์ว่าง (โหลดไม่ได้) → กฎยังใช้ได้แบบตรงชื่อ ไม่ตกทอด และรายงานทุกตัวเป็นกำพร้า', () => {
  const i = buildBreakLineRuleIndex([{ policy_id: 'p-5s', line_name: 'GOR', duration_min: 10 }], []);
  assert.deepEqual(i.orphanLines, ['GOR']);
  assert.equal(breakRulesForLine(i, 'GOR').get('p-5s'), 10);
  assert.equal(breakRulesForLine(i, 'GOR 1'), null);                          // ไม่รู้สาย = ไม่เดา
});

/* ─── ⑧ ค่านาทีที่ใช้ไม่ได้ ──────────────────────────────────────────────────────── */
test('นาทีที่แกะไม่ออก/นอกช่วง = null (ห้ามเดา 0) และแถวนั้นถูกข้าม', () => {
  assert.equal(ruleDurationOf({ duration_min: 0 }), 0);
  assert.equal(ruleDurationOf({ duration_min: 10 }), 10);
  assert.equal(ruleDurationOf({ duration_min: '15' }), 15);
  assert.equal(ruleDurationOf({ duration_min: null }), null);
  assert.equal(ruleDurationOf({ duration_min: undefined }), null);
  assert.equal(ruleDurationOf({ duration_min: 'ยี่สิบ' }), null);
  assert.equal(ruleDurationOf({ duration_min: -1 }), null);
  assert.equal(ruleDurationOf({ duration_min: 481 }), null);

  const i = idx([
    { policy_id: 'p-5s', line_name: 'GOR 1', duration_min: null },
    { policy_id: '',     line_name: 'GOR 2', duration_min: 10 },
    { policy_id: 'p-5s', line_name: '   ',   duration_min: 10 },
  ]);
  assert.equal(i.ruleCount, 0);
  assert.equal(hasBreakLineRules(i), false);
});

test('ชื่อไลน์มีช่องว่างหัว-ท้าย → trim ให้ตรงทะเบียน', () => {
  const i = idx([{ policy_id: 'p-5s', line_name: '  GOR 1  ', duration_min: 10 }]);
  assert.equal(breakRulesForLine(i, 'GOR 1').get('p-5s'), 10);
  assert.equal(breakRulesForLine(i, ' GOR 1 ').get('p-5s'), 10);
});

/* ─── ⑨ จอตั้งค่า: "ใครตกทอดจากใคร" (กฎใกล้ชนะไกล ต้องมีเจ้าของเดียว) ─────────── */
test('breakRuleFollowers: ลูก-หลานที่ได้ตามกฎของแม่ · ตัวที่ตั้งเองไม่นับเป็นผู้ตาม', async () => {
  const { breakRuleFollowers } = await import('../breakLineRules.js');
  const rows = [
    { policy_id: 'p-5s',    line_name: 'GOR',   duration_min: 10 },
    { policy_id: 'p-5s',    line_name: 'GOR 1', duration_min: 5 },
    { policy_id: 'p-lunch', line_name: 'GOR',   duration_min: 40 },
  ];
  const f5s = breakRuleFollowers(rows, LINES, 'p-5s');
  assert.deepEqual(f5s.get('GOR'), ['GOR 2']);          // GOR 1 ตั้งเอง · GOR 1A ตามพ่อ ไม่ใช่ปู่
  assert.deepEqual(f5s.get('GOR 1'), ['GOR 1A']);
  assert.equal(f5s.has('LINE C'), false);

  const fLunch = breakRuleFollowers(rows, LINES, 'p-lunch');
  assert.deepEqual(fLunch.get('GOR'), ['GOR 1', 'GOR 1A', 'GOR 2']);   // ไม่มีลูกคนไหนตั้งเอง
  assert.equal(breakRuleFollowers(rows, LINES, 'p-ot').size, 0);
  assert.equal(breakRuleFollowers([], LINES, 'p-5s').size, 0);
});

/* ─── ⑩ แถบเงาบนบอร์ดไทม์ไลน์ 24 ชม. — `halfDayBreakBands` (20/10 รอบที่ 2) ──────────
   ที่มาของเทสชุดนี้: บอร์ด 3 จอ (`/dashboard` · `/management` · `/heijunka-kanban`)
   เคยหา "แถบนี้คือพักอะไร" ด้วยการ **จับคู่เวลาเริ่มกับ `break_policies.start_time` เอง**
   ⇒ พัก `anchor='shift_end'` (5ส.) มี `start_time = null` ⇒ จับไม่ติด ⇒ tooltip เขียน
      "undefined" และบนจอ TV พิมพ์ "🚫undefined" ลงบนแถบ · ไลน์ที่ตั้งเวลาพักเองยังเลื่อน
      offset อีก = ยิ่งจับไม่ติด ⇒ ย้ายมาให้ `breakBandsIn` ติดป้ายมาให้ตั้งแต่ต้นทาง */
test('halfDayBreakBands: ช่วงตรงกับ halfDayBreakIntervals เป๊ะ (ตัวเลข %A/%P ห้ามขยับ)', async () => {
  const { halfDayBreakIntervals, halfDayBreakBands } = await import('../oee.js');
  const half = { key: 'am', startMs: new Date('2026-10-20T08:00:00').getTime() };
  for (const lineName of [null, 'GOR', 'GOR 1', 'GOR 1A', 'LINE C', 'ไม่มีไลน์นี้']) {
    const lineRules = idx(ROWS_5S);
    const iv = halfDayBreakIntervals({ policies: POLICIES, half, lineRules, lineName });
    const bands = halfDayBreakBands({ policies: POLICIES, half, lineRules, lineName });
    assert.deepEqual(bands.map(b => [b.s, b.e]), iv, `ช่วงไม่ตรงกันที่ไลน์ ${lineName}`);
  }
});

test('halfDayBreakBands: ป้ายชื่อพัก — พักท้ายกะ (start_time = null) ต้องไม่เป็น undefined', async () => {
  const { halfDayBreakBands, breakBandName, breakBandTitle } = await import('../oee.js');
  const half = { key: 'am', startMs: new Date('2026-10-20T08:00:00').getTime() };
  const bands = halfDayBreakBands({ policies: POLICIES, half });
  const names = bands.map(breakBandName);
  assert.equal(names.includes('undefined'), false, 'ชื่อพักหลุดเป็น undefined (บั๊กเดิมของบอร์ด)');
  assert.ok(names.every(n => n && n !== 'พัก'), `ชื่อพักต้องมาจากนโยบายจริง: ${names.join(' | ')}`);
  // ไลน์ที่ไม่ได้ตั้งอะไร = ห้ามมีท่อน "ตั้งเอง" ในป้าย
  assert.equal(bands.some(b => breakBandTitle(b, 'LINE C').includes('ตั้งเอง')), false);
});

test('halfDayBreakBands: ไลน์ที่ตั้งเอง ต้องติดป้าย "ตั้งเอง N นาที (ค่ากลาง M)" · ไลน์อื่นไม่ติด', async () => {
  const { halfDayBreakBands, breakBandTitle } = await import('../oee.js');
  const half = { key: 'am', startMs: new Date('2026-10-20T08:00:00').getTime() };
  const lineRules = idx(ROWS_5S);

  const own = halfDayBreakBands({ policies: POLICIES, half, lineRules, lineName: 'GOR' })
    .find(b => b.lineRuleMin !== null);
  assert.ok(own, 'ไลน์ที่ตั้งเองต้องมี band ที่ lineRuleMin ไม่ใช่ null');
  assert.equal(own.lineRuleMin, 10);
  assert.equal(own.centralMin, 20);
  const t = breakBandTitle(own, 'GOR');
  assert.match(t, /GOR ตั้งเอง 10 นาที/);
  assert.match(t, /ค่ากลาง 20 นาที/);

  // 🔴 ไลน์ลูกที่ตกทอดจากแม่ ก็ต้องเห็นป้าย (ไม่งั้นคนนึกว่าจอเพี้ยนเพราะแถบไม่เท่าไลน์ข้างๆ)
  const kid = halfDayBreakBands({ policies: POLICIES, half, lineRules, lineName: 'GOR 1A' })
    .find(b => b.lineRuleMin !== null);
  assert.ok(kid, 'ไลน์ลูกที่ตกทอดต้องติดป้ายด้วย');

  // ไลน์ที่ไม่เกี่ยวข้อง = ไม่มี band ไหนติดป้าย
  const other = halfDayBreakBands({ policies: POLICIES, half, lineRules, lineName: 'LINE C' });
  assert.equal(other.every(b => b.lineRuleMin === null), true);
});

test('halfDayBreakBands: ไลน์ที่ตั้ง 0 นาที = ไม่มีแถบรายการนั้นเลย (ห้ามวาดแถบยาว 0)', async () => {
  const { halfDayBreakBands, breakBandName } = await import('../oee.js');
  const half = { key: 'am', startMs: new Date('2026-10-20T08:00:00').getTime() };
  const zero = idx([{ policy_id: 'p-5s', line_name: 'GOR', duration_min: 0 }]);
  const bands = halfDayBreakBands({ policies: POLICIES, half, lineRules: zero, lineName: 'GOR' });
  assert.equal(bands.some(b => breakBandName(b).includes('5ส')), false, 'ตั้ง 0 แล้วยังวาดแถบ 5ส.');
  assert.equal(bands.every(b => b.e > b.s), true, 'มีแถบที่ยาว 0 หรือติดลบหลุดออกมา');
});
