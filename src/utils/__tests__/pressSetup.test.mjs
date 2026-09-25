/* เทสเวลาเปลี่ยนรุ่นงานปั๊ม — src/utils/pressSetup.js
   ที่มา (user 2026-09-24): "มี setup time change over die มาเป็นตัวแปร ถ้า die height
   ต่างกันเกินมันมีผล เลยต้องมีการ drag จัดแผนเพื่อหา optimization"

   🔴 เทสชุดนี้ล็อก "ความซื่อสัตย์" เป็นหลัก ไม่ใช่แค่เลขถูก:
      ไม่มีกฎ → null ห้ามเป็น 0 · ไม่รู้ความสูง → ติดธง · ไม่รู้ว่าขึ้นเครื่องได้ไหม → null ห้ามเป็น false
   ข้อมูลจริงตอนเขียน: แม่พิมพ์ 262 ตัว กรอกความสูงแล้ว 0 ตัว ⇒ "ข้อมูลไม่ครบ" คือกรณีปกติ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSetupRule, stepAddMin, heightAddMin, setupMinutes, sequenceSetup,
  orderByDieHeight, fitsPress, setupDataReadiness,
} from '../pressSetup.js';

/* กฎตัวอย่าง — ตัวเลขสมมติเพื่อเทสตรรกะ ของจริงรอช่างปั๊ม */
const RULE = {
  scope_kind: 'global', scope_value: null, base_min: 20, same_die_min: 5,
  height_steps: [{ max_mm: 10, add_min: 0 }, { max_mm: 50, add_min: 15 }, { max_mm: null, add_min: 30 }],
};
const die = (id, h) => ({ id, die_height_mm: h });
/* นาทีที่ได้จากวินาที/60 เป็นทศนิยมฐานสอง — ผลรวมหลายช่วงไม่เท่ากับหารครั้งเดียวเป๊ะ
   (10/60 + 190/60 ≠ 200/60) ⇒ เทียบแบบมีค่าคลาดเคลื่อน · จอต้องปัดเศษก่อนแสดงเสมอ */
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg || `${a} ≈ ${b}`);

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

/* ── ⭐ อัตราต่อมิลลิเมตร — ตัวเลขจริงจากช่างปั๊ม 2026-09-25: 1mm = 1sec ─────────────── */
const RATE = { scope_kind: 'global', scope_value: null, per_mm_sec: 1, base_min: null, same_die_min: null, height_steps: [] };

test('1 มม. = 1 วินาที → Δ120 มม. = 2 นาที (heightAddMin คิดเป็นนาทีให้เลย)', () => {
  assert.equal(heightAddMin(RATE, 120), 2);
  assert.equal(heightAddMin(RATE, 0), 0);
  assert.equal(heightAddMin(RATE, 30), 0.5);
});

test('อัตราต่อมม. + ขั้นบันได บวกทับกันได้ (เผื่อวันหน้ามีเงื่อนไขแบบขั้น)', () => {
  const both = { per_mm_sec: 1, height_steps: [{ max_mm: 200, add_min: 0 }, { max_mm: null, add_min: 30 }] };
  assert.equal(heightAddMin(both, 60), 1, 'Δ60 = 1 นาที + ขั้นแรก 0');
  assert.equal(heightAddMin(both, 300), 35, 'Δ300 = 5 นาที + ขั้นสุดท้าย 30');
});

test('🔴 กฎที่ไม่ได้บอกผลของความสูงเลย = null ห้ามเป็น 0 (0 = ทุกลำดับเท่ากัน จอจะบอก "เรียงใหม่ไม่ช่วย" แบบมั่ว)', () => {
  assert.equal(heightAddMin({ base_min: 20 }, 150), null);
  assert.equal(heightAddMin({ base_min: 20, height_steps: [] }, 150), null);
});

/* ── ⭐ ไม่รู้เวลาฐาน แต่ยังเทียบลำดับได้ (เวลาฐานหักกลบจากผลต่าง) ──────────────────── */
test('🔴 ไม่รู้เวลาฐาน = totalMin null แต่ varMin ยังเป็นตัวเลขจริง', () => {
  const r = setupMinutes({ fromDie: die('a', 300), toDie: die('b', 420), rule: RATE });
  assert.equal(r.state, 'no_base');
  assert.equal(r.min, null, 'ตอบเวลารวมไม่ได้ ห้ามเดา');
  assert.equal(r.varMin, 2, 'Δ120 มม. = 2 นาที — ส่วนนี้รู้แน่');
  assert.equal(r.baseMin, null);
});

test('⭐ หัวใจของการลากแผน: เทียบลำดับได้แม้ไม่รู้เวลาฐาน (จำนวนครั้งเปลี่ยนเท่ากัน ฐานหักกลบ)', () => {
  const A = die('A', 300), B = die('B', 310), C = die('C', 500);
  const bad  = sequenceSetup([A, C, B], RATE);   // Δ200 + Δ190 = 390 วิ = 6.5 น.
  const good = sequenceSetup([A, B, C], RATE);   // Δ10  + Δ190 = 200 วิ = 3.33 น.
  assert.equal(bad.totalMin, null, 'เวลารวมตอบไม่ได้ (ยังไม่รู้เวลาฐาน)');
  assert.equal(good.totalMin, null);
  near(bad.varMin, 390 / 60);
  near(good.varMin, 200 / 60);
  assert.ok(bad.varMin - good.varMin > 3, 'สลับลำดับ 3 ใบ ประหยัด > 3 นาที');
  assert.equal(good.baseUnknown, true, 'จอต้องรู้ว่าเวลาฐานยังไม่รู้ เพื่อเขียนกำกับ');
});

test('⭐ เรียงความสูงทางเดียว = ค่าน้อยสุดที่เป็นไปได้ของ Σ|Δ| (อัตราเชิงเส้น)', () => {
  const list = [die('a', 100), die('b', 450), die('c', 220), die('d', 380)];
  const sorted = sequenceSetup(orderByDieHeight(list), RATE).varMin;
  near(sorted, (450 - 100) / 60, 'ไล่ทางเดียว = ช่วงสูงสุด−ต่ำสุด');
  /* ทุกลำดับอื่นต้องไม่ดีกว่านี้ */
  const perm = (a) => a.length <= 1 ? [a] : a.flatMap((x, i) => perm([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [x, ...r]));
  for (const p of perm(list)) assert.ok(sequenceSetup(p, RATE).varMin >= sorted - 1e-9);
});

test('เวลาฐานที่ไม่รู้ ห้ามทำให้ varMin หาย (จอต้องยังจัดลำดับได้)', () => {
  const s = sequenceSetup([die('a', 100), die('b', 200)], RATE);
  assert.equal(s.totalMin, null);
  assert.ok(s.varMin > 0);
  assert.equal(s.unknownCount, 0, 'รู้ความสูงครบ = ไม่มีช่วงที่ประเมินไม่ได้');
});

test('มีกฎ + รู้ความสูง ≥ 2 ตัว = เริ่มเทียบลำดับได้', () => {
  const r = setupDataReadiness({ dies: [die('a', 100), die('b', 200)], presses: [], rules: [RULE] });
  assert.equal(r.canPlan, true);
});

test('รู้ความสูงแค่ตัวเดียว = ยังเทียบลำดับไม่ได้', () => {
  const r = setupDataReadiness({ dies: [die('a', 100), die('b', null)], presses: [], rules: [RULE] });
  assert.equal(r.canPlan, false);
});

test('🔴 กฎที่มีแต่เวลาฐาน (ไม่มีผลของความสูง) = จัดลำดับไม่ได้ แม้จะ "มีกฎ" แล้ว', () => {
  const onlyBase = { scope_kind: 'global', base_min: 20, height_steps: [] };
  const r = setupDataReadiness({ dies: [die('a', 100), die('b', 200)], presses: [], rules: [onlyBase] });
  assert.equal(r.ruleCount, 1);
  assert.equal(r.ruleWithHeight, 0);
  assert.equal(r.canPlan, false, 'ทุกลำดับเท่ากันหมด = ไม่มีอะไรให้จัด');
});

test('canPlan (จัดลำดับ) กับ canTotal (ตอบเวลารวม) เป็นคนละคำถาม', () => {
  const r = setupDataReadiness({ dies: [die('a', 100), die('b', 200)], presses: [], rules: [RATE] });
  assert.equal(r.canPlan, true, 'รู้ผลของความสูง = จัดลำดับได้');
  assert.equal(r.canTotal, false, 'ยังไม่รู้เวลาฐาน = ตอบเวลารวมไม่ได้');
});
