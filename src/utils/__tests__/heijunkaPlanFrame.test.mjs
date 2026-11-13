/* 🖼️ กรอบ "คิวตามอุดมคติ" ของใบ — พิกัดบนราง (13/11)
   ที่มา: user ส่งภาพบอร์ดมาถามว่า "กรอบเส้นประมั่วๆ" — ไล่แล้วเจอว่าสูตรถูกก๊อปไว้ 2 หน้า
   แล้วสีเพี้ยนกัน (Management ฮาร์ดโค้ด #e5e7eb = สีธีมมืด ⇒ บนธีมสว่างใบที่หลุดแผนแทบมองไม่เห็น)
   🔴 เทสนี้ล็อก "สูตรเดียว" ไว้ · เวลาตรึงค่าทั้งหมด (ด่านนาฬิกา +400 วัน) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFramePct, PLAN_SLIP_TOLERANCE_MS } from '../heijunkaQueue.js';

const HS = Date.parse('2026-11-13T01:00:00Z');       // เวลาเริ่มราง
const PCT = 100 / (12 * 3600000);                     // ราง 12 ชม. = 100%
const h = (n) => HS + n * 3600000;

/** ใบที่ตรงแผนเป๊ะ: ควรเริ่ม h1 จบ h3 และทำได้ตามนั้น */
const onPlan = { planStartMs: h(1), plannedEndMs: h(3), startMs: h(1), endMs: h(3), occupiedEndMs: h(3) };

test('ใบที่ตรงแผน — กรอบทับแท่งพอดี และไม่ใช่ใบหลุดกรอบ', () => {
  const r = planFramePct(onPlan, HS, PCT);
  assert.equal(Math.round(r.planLeftPct), 8);        // 1/12 ชม.
  assert.equal(Math.round(r.planWidthPct), 17);      // 2/12 ชม.
  assert.equal(r.planSlipped, false);
});

test('🔴 ไม่รู้กรอบ = ไม่วาด (ห้ามเดาเป็น 0–0 แล้ววาดเส้นหลอก)', () => {
  for (const bad of [null, undefined, {}, { planStartMs: h(1) }, { plannedEndMs: h(3) }]) {
    const r = planFramePct(bad, HS, PCT);
    assert.equal(r.planWidthPct, 0, JSON.stringify(bad));
    assert.equal(r.planSlipped, false);
  }
});

test('กรอบที่อยู่นอกรางทั้งอัน = ไม่วาด', () => {
  const before = { ...onPlan, planStartMs: h(-5), plannedEndMs: h(-3) };
  assert.equal(planFramePct(before, HS, PCT).planWidthPct, 0);
  const after = { ...onPlan, planStartMs: h(20), plannedEndMs: h(22) };
  assert.equal(planFramePct(after, HS, PCT).planWidthPct, 0);
});

test('กรอบที่ล้นขอบราง ถูกตัดที่ 0–100 ไม่ใช่ค่าติดลบ/เกิน 100', () => {
  const r = planFramePct({ ...onPlan, planStartMs: h(-2), plannedEndMs: h(99) }, HS, PCT);
  assert.equal(r.planLeftPct, 0);
  assert.equal(r.planWidthPct, 100);
});

test('🔴 หลุดกรอบเพราะ "เริ่มช้า" — เผื่อ 2 นาที ขอบเกณฑ์ต้องไม่พลิกก่อน', () => {
  const at = (ms) => planFramePct({ ...onPlan, startMs: h(1) + ms }, HS, PCT).planSlipped;
  assert.equal(at(PLAN_SLIP_TOLERANCE_MS), false, 'เท่าเกณฑ์ = ยังไม่หลุด');
  assert.equal(at(PLAN_SLIP_TOLERANCE_MS + 1000), true, 'เกินเกณฑ์ = หลุด');
});

test('🔴 หลุดกรอบเพราะ "ครองไลน์ยาวกว่าที่ควร" — ต้องดู occupiedEndMs ไม่ใช่แค่ endMs', () => {
  /* ใบปิดตรงเวลาแต่ยังครองรางต่อ (ยังไม่ปิดงานจริง) = หลุดกรอบ */
  const r = planFramePct({ ...onPlan, endMs: h(3), occupiedEndMs: h(5) }, HS, PCT);
  assert.equal(r.planSlipped, true);
  /* ถ้าดูแต่ endMs จะพลาดเคสนี้ — ล็อกไว้ว่าต้องไม่กลับไปแบบนั้น */
  assert.equal(planFramePct({ ...onPlan, endMs: h(5), occupiedEndMs: h(3) }, HS, PCT).planSlipped, true);
});

test('ใบที่หลุดกรอบ กรอบยังอยู่ที่ "ตำแหน่งที่ควรอยู่" ไม่ใช่ตำแหน่งจริง', () => {
  const r = planFramePct({ ...onPlan, startMs: h(6), endMs: h(8), occupiedEndMs: h(8) }, HS, PCT);
  assert.equal(Math.round(r.planLeftPct), 8);   // ยังชี้ที่ h1 ตามแผน
  assert.equal(r.planSlipped, true);
});
