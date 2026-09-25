/* เทสเวลาเปลี่ยนรุ่นงานปั๊ม — src/utils/pressSetup.js
   ที่มา (user 2026-09-24): "มี setup time change over die มาเป็นตัวแปร ถ้า die height
   ต่างกันเกินมันมีผล เลยต้องมีการ drag จัดแผนเพื่อหา optimization"

   🔴 เทสชุดนี้ล็อก "ความซื่อสัตย์" เป็นหลัก ไม่ใช่แค่เลขถูก:
      ไม่มีกฎ → null ห้ามเป็น 0 · ไม่รู้ความสูง → ติดธง · ไม่รู้ว่าขึ้นเครื่องได้ไหม → null ห้ามเป็น false
   ข้อมูลจริงตอนเขียน: แม่พิมพ์ 262 ตัว กรอกความสูงแล้ว 0 ตัว ⇒ "ข้อมูลไม่ครบ" คือกรณีปกติ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSetupRule, stepAddMin, setupMinutes, sequenceSetup,
  orderByDieHeight, fitsPress, setupDataReadiness,
} from '../pressSetup.js';

/* กฎตัวอย่าง — ตัวเลขสมมติเพื่อเทสตรรกะ ของจริงรอช่างปั๊ม */
const RULE = {
  scope_kind: 'global', scope_value: null, base_min: 20, same_die_min: 5,
  height_steps: [{ max_mm: 10, add_min: 0 }, { max_mm: 50, add_min: 15 }, { max_mm: null, add_min: 30 }],
};
const die = (id, h) => ({ id, die_height_mm: h });

/* ── resolve ขอบเขต ───────────────────────────────────────────────────────── */
test('เครื่อง ชนะ ไลน์ ชนะ ทั้งโรงงาน', () => {
  const rules = [
    { scope_kind: 'global', scope_value: null, base_min: 1 },
    { scope_kind: 'line', scope_value: 'LINE A', base_min: 2 },
    { scope_kind: 'machine', scope_value: 'P-01', base_min: 3 },
  ];
  assert.equal(resolveSetupRule(rules, { machineNo: 'P-01', lineName: 'LINE A' }).base_min, 3);
  assert.equal(resolveSetupRule(rules, { machineNo: 'P-99', lineName: 'LINE A' }).base_min, 2);
  assert.equal(resolveSetupRule(rules, { machineNo: 'P-99', lineName: 'LINE Z' }).base_min, 1);
});

test('กฎที่ปิดใช้งานแล้วต้องไม่ถูกหยิบ', () => {
  const rules = [{ scope_kind: 'global', scope_value: null, base_min: 1, is_active: false }];
  assert.equal(resolveSetupRule(rules, {}), null);
});

/* ── ขั้นบันไดความสูง ─────────────────────────────────────────────────────── */
test('stepAddMin เลือกขั้นแรกที่ครอบค่าได้ · ขั้น max_mm=null คือขั้นสุดท้าย', () => {
  const s = RULE.height_steps;
  assert.equal(stepAddMin(s, 0), 0);
  assert.equal(stepAddMin(s, 10), 0, 'ขอบบนของขั้นนับรวม (<=)');
  assert.equal(stepAddMin(s, 10.1), 15);
  assert.equal(stepAddMin(s, 50), 15);
  assert.equal(stepAddMin(s, 300), 30, 'เกินทุกขั้น → ขั้นสุดท้าย');
});

test('steps ที่เรียงสลับมา ต้องถูกจัดเรียงให้เองก่อนใช้', () => {
  const messy = [{ max_mm: null, add_min: 30 }, { max_mm: 50, add_min: 15 }, { max_mm: 10, add_min: 0 }];
  assert.equal(stepAddMin(messy, 5), 0);
  assert.equal(stepAddMin(messy, 40), 15);
});

/* ── เวลาเปลี่ยน 1 ครั้ง ──────────────────────────────────────────────────── */
test('🔴 ไม่มีกฎ = null ห้ามเป็น 0 (0 ทำให้แผนดูดีเกินจริงแล้วคนเชื่อ)', () => {
  const r = setupMinutes({ fromDie: die('a', 100), toDie: die('b', 200), rule: null });
  assert.equal(r.min, null);
  assert.equal(r.state, 'no_rule');
  assert.notEqual(r.min, 0);
});

test('ใบแรกของกะ = ไม่มีของเดิมให้ถอด → 0 นาที', () => {
  assert.equal(setupMinutes({ fromDie: null, toDie: die('a', 100), rule: RULE }).state, 'first');
  assert.equal(setupMinutes({ fromDie: null, toDie: die('a', 100), rule: RULE }).min, 0);
});

test('แม่พิมพ์ตัวเดิม (เปลี่ยนแค่ล็อต) = same_die_min ไม่ใช่ base', () => {
  const r = setupMinutes({ fromDie: die('a', 100), toDie: die('a', 100), rule: RULE });
  assert.equal(r.state, 'same_die');
  assert.equal(r.min, 5);
});

test('ความสูงต่างกันน้อย = ฐานอย่างเดียว · ต่างมาก = ฐาน + ขั้น', () => {
  assert.equal(setupMinutes({ fromDie: die('a', 300), toDie: die('b', 305), rule: RULE }).min, 20);
  assert.equal(setupMinutes({ fromDie: die('a', 300), toDie: die('b', 340), rule: RULE }).min, 35);
  assert.equal(setupMinutes({ fromDie: die('a', 300), toDie: die('b', 500), rule: RULE }).min, 50);
});

test('🔴 ไม่รู้ความสูงข้างใดข้างหนึ่ง → คืนเวลาฐาน + ติดธง unknown_height + บอกว่าตัวไหนขาด', () => {
  const r = setupMinutes({ fromDie: die('a', null), toDie: die('b', 200), rule: RULE });
  assert.equal(r.state, 'unknown_height');
  assert.equal(r.min, 20, 'รู้แค่ว่าต้องเปลี่ยนแม่พิมพ์ = เวลาฐาน');
  assert.equal(r.diffMm, null);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].id, 'a');
});

/* ── ทั้งลำดับ ───────────────────────────────────────────────────────────── */
test('🔴 หัวใจ — สลับลำดับแล้วเวลา setup รวมต้องต่างกัน (นี่คือเหตุผลที่ต้องลากการ์ด)', () => {
  const A = die('A', 300), B = die('B', 310), C = die('C', 500);
  // แย่  : 300→500 (Δ200 = ฐาน20+30) → 310 (Δ190 = 20+30) = 100 นาที
  // ดี   : 300→310 (Δ10  = ฐาน20+0)  → 500 (Δ190 = 20+30) =  70 นาที
  const bad  = sequenceSetup([A, C, B], RULE);
  const good = sequenceSetup([A, B, C], RULE);
  assert.equal(bad.totalMin, 100);
  assert.equal(good.totalMin, 70);
  assert.equal(bad.totalMin - good.totalMin, 30, 'สลับลำดับ 3 ใบ ได้เวลาผลิตคืน 30 นาที');
  assert.ok(good.totalMin < bad.totalMin, 'จัดลำดับตามความสูงแล้วต้องประหยัดกว่า');
});

test('🔴 ไม่มีกฎ → totalMin = null (จอต้องบอกว่าเทียบลำดับไม่ได้ ห้ามโชว์ 0)', () => {
  const s = sequenceSetup([die('A', 100), die('B', 200)], null);
  assert.equal(s.totalMin, null);
  assert.equal(s.noRule, true);
});

test('มีตัวที่ไม่รู้ความสูงปน → ยังรวมเวลาได้ แต่ต้องนับไว้ว่าตัวเลขต่ำกว่าจริง', () => {
  const s = sequenceSetup([die('A', 300), die('B', null), die('C', 500)], RULE);
  assert.equal(s.unknownCount, 2, 'ทั้งขาเข้าและขาออกของใบที่ไม่รู้ความสูง');
  assert.ok(s.totalMin > 0);
});

test('นับจำนวนครั้งที่ต้องเปลี่ยนแม่พิมพ์จริง (ตัวเดิมติดกันไม่นับ)', () => {
  const s = sequenceSetup([die('A', 100), die('A', 100), die('B', 200)], RULE);
  assert.equal(s.changeCount, 1);
});

/* ── heuristic จัดลำดับ ──────────────────────────────────────────────────── */
test('orderByDieHeight เรียงจากเตี้ยไปสูง', () => {
  const out = orderByDieHeight([die('c', 500), die('a', 100), die('b', 300)]);
  assert.deepEqual(out.map(d => d.id), ['a', 'b', 'c']);
});

test('🔴 ตัวที่ไม่รู้ความสูงต้องต่อท้าย ห้ามหายจากแผน', () => {
  const out = orderByDieHeight([die('x', null), die('a', 100), die('y', null), die('b', 300)]);
  assert.equal(out.length, 4, 'งานห้ามหายเพราะข้อมูลไม่ครบ');
  assert.deepEqual(out.map(d => d.id), ['a', 'b', 'x', 'y']);
});

/* ── ขึ้นเครื่องได้ไหม ───────────────────────────────────────────────────── */
test('อยู่ในช่วง = ok · นอกช่วง = ไม่ ok พร้อมเหตุผลที่อ่านรู้เรื่อง', () => {
  const press = { shut_height_min_mm: 200, shut_height_max_mm: 400 };
  assert.equal(fitsPress(die('a', 300), press).ok, true);
  assert.equal(fitsPress(die('a', 150), press).ok, false);
  assert.match(fitsPress(die('a', 150), press).reason, /เตี้ยกว่า/);
  assert.equal(fitsPress(die('a', 500), press).ok, false);
  assert.match(fitsPress(die('a', 500), press).reason, /สูงกว่า/);
});

test('🔴 ข้อมูลไม่ครบ = null ไม่ใช่ false ("ไม่รู้" ห้ามแปลว่า "ขึ้นไม่ได้")', () => {
  assert.equal(fitsPress(die('a', null), { shut_height_min_mm: 200, shut_height_max_mm: 400 }).ok, null);
  assert.equal(fitsPress(die('a', 300), {}).ok, null);
});

/* ── ความพร้อมของข้อมูล ─────────────────────────────────────────────────── */
test('readiness บอกตรงๆ ว่ายังขาดอะไร และยังวางแผนไม่ได้', () => {
  const r = setupDataReadiness({
    dies: [die('a', 100), die('b', null), die('c', null)],
    presses: [{ shut_height_min_mm: 200 }, {}],
    rules: [],
  });
  assert.equal(r.dieTotal, 3);
  assert.equal(r.dieWithHeight, 1);
  assert.equal(r.dieMissing, 2);
  assert.equal(r.pressWithRange, 1);
  assert.equal(r.ruleCount, 0);
  assert.equal(r.canPlan, false, 'ไม่มีกฎ = วางแผนไม่ได้ แม้จะมีความสูงบ้างแล้ว');
});

test('มีกฎ + รู้ความสูง ≥ 2 ตัว = เริ่มเทียบลำดับได้', () => {
  const r = setupDataReadiness({ dies: [die('a', 100), die('b', 200)], presses: [], rules: [RULE] });
  assert.equal(r.canPlan, true);
});

test('รู้ความสูงแค่ตัวเดียว = ยังเทียบลำดับไม่ได้', () => {
  const r = setupDataReadiness({ dies: [die('a', 100), die('b', null)], presses: [], rules: [RULE] });
  assert.equal(r.canPlan, false);
});
