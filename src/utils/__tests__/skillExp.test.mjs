import test from 'node:test';
import assert from 'node:assert/strict';
import { bandOf, bandProgress, cyclesToNextBand, daysToNextBand, evidenceState, shadowDelta, BAND_CEILING } from '../skillExp.js';

/* cfg จำลองค่า default ของ skill_exp_config (ตัวเลขจริงอยู่ใน DB — ที่นี่แค่ตรึงรูปโค้ง) */
const cfg = { band_cum_0: 0.1, band_cum_1: 1.1, band_cum_2: 4.1, band_cum_3: 12.1 };

test('bandOf ล้อกับเพดานขั้น 24/49/74/99', () => {
  assert.equal(bandOf(0), 0);   assert.equal(bandOf(24), 0);
  assert.equal(bandOf(25), 1);  assert.equal(bandOf(49), 1);
  assert.equal(bandOf(50), 2);  assert.equal(bandOf(74), 2);
  assert.equal(bandOf(75), 3);  assert.equal(bandOf(99), 3);
  assert.equal(bandOf(100), 4);
  assert.deepEqual(BAND_CEILING, [24, 49, 74, 99, 100]);
});

test('bandProgress: ถึงขอบขั้น = 1 · กลางขั้น = ครึ่ง · เกินขอบไม่ทะลุ 1', () => {
  // ขั้น 1 กินช่วง cum_ratio 0.1 → 1.1
  assert.equal(bandProgress(0.1, 1, cfg), 0);
  assert.equal(bandProgress(1.1, 1, cfg), 1);
  assert.equal(Math.round(bandProgress(0.6, 1, cfg) * 100), 50);
  assert.equal(bandProgress(99, 1, cfg), 1);
  assert.equal(bandProgress(0, 4, cfg), 1);      // ขั้นสูงสุด = เต็มเสมอ
});

test('🔴 bandProgress รับ "สัดส่วน" ไม่ใช่ "รอบ" — คนละสถานี n_ref ต่างกัน 34 เท่าต้องเทียบกันได้', () => {
  // คนไลน์ประกอบ (n_ref 7,826 · ทำมา 8,609 shot) กับคนไลน์ปั๊ม (n_ref 172,800 · 190,080 shot)
  // ทั้งคู่คืบหน้าเท่ากัน = 1.1 เท่าของรอบอ้างอิง ⇒ ต้องได้ progress เท่ากัน
  const assy  = 8609 / 7826;
  const press = 190080 / 172800;
  assert.equal(bandProgress(assy, 1, cfg), bandProgress(press, 1, cfg));
  assert.equal(bandProgress(press, 1, cfg), 1);
});

test('รูปโค้ง Wright: ขั้นสูงต้องกินปริมาณสะสมมากกว่าขั้นต่ำเสมอ', () => {
  const w1 = cfg.band_cum_1 - cfg.band_cum_0;   // 1.0
  const w2 = cfg.band_cum_2 - cfg.band_cum_1;   // 3.0
  const w3 = cfg.band_cum_3 - cfg.band_cum_2;   // 8.0
  assert.ok(w2 > w1 && w3 > w2, 'ช่วงของขั้นสูงต้องกว้างกว่าขั้นต่ำเสมอ');
  // ⚠️ ถ้าวันหน้าปรับ band_cum_* ใน skill_exp_config ให้แคบลงจนผิดลำดับ = เส้นโค้งกลับเป็นเชิงเส้น
  //    (ซึ่งคือบั๊กเดิมของ v1: +1/วัน เท่ากันทุกขั้น) — เทสนี้กันที่ "รูปทรง" ไม่ใช่ค่าตายตัว
  assert.ok(bandProgress(1.1, 1, cfg) === 1 && bandProgress(1.1, 2, cfg) < 1);
});

test('cyclesToNextBand แปลงสัดส่วนที่ขาดกลับเป็นรอบ และไม่ติดลบ', () => {
  assert.equal(cyclesToNextBand(0.6, 2000, 1, cfg), 1000);   // (1.1 - 0.6) × 2000
  assert.equal(cyclesToNextBand(9, 2000, 1, cfg), 0);
  assert.equal(cyclesToNextBand(0, 2000, 4, cfg), null);     // ขั้นสูงสุดไม่มีขั้นถัดไป
  assert.equal(cyclesToNextBand(0, 0, 1, cfg), null);        // ไม่รู้ n_ref = ตอบไม่ได้
});

test('daysToNextBand: ประเมินจากอัตราจริงของคนนั้น · ไม่มีประวัติ = null ห้ามเดา', () => {
  // คืบมา 0.6 เท่าใน 13 วัน ⇒ 0.0462/วัน · เหลือ 0.5 ⇒ ~11 วัน
  assert.equal(daysToNextBand(0.6, 13, 1, cfg), 11);
  assert.equal(daysToNextBand(1.5, 30, 1, cfg), 0);      // เลยเพดานขั้นแล้ว
  assert.equal(daysToNextBand(0, 10, 1, cfg), null);     // ยังไม่เคยคืบ = ตอบไม่ได้
  assert.equal(daysToNextBand(0.5, 0, 1, cfg), null);    // ไม่มีวันทำงาน = ตอบไม่ได้
  assert.equal(daysToNextBand(0.5, 10, 4, cfg), null);   // ขั้นสูงสุด
});

test('🔴 "ประเมินไม่ได้" ต้องไม่ถูกแสดงเป็นคะแนนต่ำ', () => {
  assert.equal(evidenceState(null).key, 'none');
  assert.equal(evidenceState({ shadow_score: null, verified: false }).key, 'unknown');
  assert.equal(evidenceState({ shadow_score: 80, verified: false }).key, 'unverified');
  assert.equal(evidenceState({ shadow_score: 49, verified: true, next_level: 50 }).key, 'ready');
  assert.equal(evidenceState({ shadow_score: 30, verified: true, next_level: null }).key, 'ok');
});

test('shadowDelta: null เมื่อประเมินไม่ได้ (ห้ามคืน 0 — คนละความหมาย)', () => {
  assert.equal(shadowDelta(50, null), null);
  assert.equal(shadowDelta(50, 30), -20);
  assert.equal(shadowDelta(null, 30), 30);
});
