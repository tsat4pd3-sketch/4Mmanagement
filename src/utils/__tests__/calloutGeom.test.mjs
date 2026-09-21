/* เรขาคณิตหมุด callout — ลากป้ายปรับทิศลูกศร (2026-09-21 · feedback "ลูกศรทับกัน")
   ล็อก 2 เรื่องที่พังแล้วเงียบ:
     · ไม่ตั้งค่า offset ต้องได้ทิศอัตโนมัติ "เหมือนเดิมเป๊ะ" (หมุดเก่าทุกตัวห้ามขยับ)
     · ป้ายต้องถูก clamp ไว้ในกล่องรูปเสมอ — ลากออกนอกรูปแล้วป้ายหายคือแก้คืนไม่ได้ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calloutLayout, autoOffsetPx, offsetPctFromPx, movedEnough, DRAG_SLOP_PX } from '../calloutGeom.js';

const BOX = { layerW: 1000, layerH: 500, size: 26 };

test('ไม่ตั้ง offset → ทิศอัตโนมัติเดิม (ขึ้นบน-ขวา)', () => {
  const g = calloutLayout({ xPct: 50, yPct: 50, ...BOX });
  const a = autoOffsetPx(50, 50, 26);
  assert.equal(g.custom, false);
  assert.equal(g.px, 500); assert.equal(g.py, 250);
  assert.equal(g.bx, 500 + a.dx);
  assert.equal(g.by, 250 + a.dy);
  assert.ok(a.dx > 0 && a.dy < 0, 'default = ขวา-บน');
});

test('อัตโนมัติหลบขอบ: ใกล้ขวาไปซ้าย · ใกล้บนไปล่าง', () => {
  assert.ok(autoOffsetPx(90, 50, 26).dx < 0);
  assert.ok(autoOffsetPx(50, 10, 26).dy > 0);
});

test('ตั้ง offset เอง → ป้ายไปตามที่สั่ง (หน่วย % ของกล่องรูป)', () => {
  const g = calloutLayout({ xPct: 50, yPct: 50, ...BOX, offX: -10, offY: 20 });
  assert.equal(g.custom, true);
  assert.equal(g.bx, 500 - 100);   // -10% ของ 1000
  assert.equal(g.by, 250 + 100);   // +20% ของ 500
});

test('offset ครึ่งเดียว (ขาด offY) = ยังถือว่าอัตโนมัติ ห้ามเดาอีกครึ่ง', () => {
  assert.equal(calloutLayout({ xPct: 50, yPct: 50, ...BOX, offX: -10 }).custom, false);
  assert.equal(calloutLayout({ xPct: 50, yPct: 50, ...BOX, offY: 20 }).custom, false);
  assert.equal(calloutLayout({ xPct: 50, yPct: 50, ...BOX, offX: null, offY: null }).custom, false);
});

test('ลากออกนอกรูป → clamp ไว้ในกล่องเสมอ (ป้ายห้ามหาย)', () => {
  const m = BOX.size * 0.7;
  const far = calloutLayout({ xPct: 50, yPct: 50, ...BOX, offX: 999, offY: 999 });
  assert.equal(far.bx, BOX.layerW - m);
  assert.equal(far.by, BOX.layerH - m);
  const neg = calloutLayout({ xPct: 50, yPct: 50, ...BOX, offX: -999, offY: -999 });
  assert.equal(neg.bx, m);
  assert.equal(neg.by, m);
});

test('กล่องรูปเล็กกว่าระยะ clamp ก็ต้องไม่ระเบิด (ค่า min > max)', () => {
  const g = calloutLayout({ xPct: 50, yPct: 50, layerW: 10, layerH: 10, size: 26, offX: 50, offY: 50 });
  assert.ok(Number.isFinite(g.bx) && Number.isFinite(g.by));
});

test('แปลง px กลับเป็น % สำหรับเก็บลงฐาน', () => {
  assert.deepEqual(offsetPctFromPx(500, 250, 400, 350, 1000, 500), { dx: -10, dy: 20 });
  assert.equal(offsetPctFromPx(0, 0, 10, 10, 0, 500), null);   // กล่องกว้าง 0 = ห้ามหาร 0
  assert.equal(offsetPctFromPx(0, 0, 10, 10, 1000, 0), null);
});

test('ไป-กลับ px ↔ % ต้องได้ตำแหน่งเดิม', () => {
  const g = calloutLayout({ xPct: 30, yPct: 70, ...BOX, offX: 12.5, offY: -8.25 });
  const off = offsetPctFromPx(g.px, g.py, g.bx, g.by, BOX.layerW, BOX.layerH);
  assert.deepEqual(off, { dx: 12.5, dy: -8.25 });
});

test('slop: ขยับนิดเดียว = คลิก ไม่ใช่ลาก (กันลากแล้วไปลบหมุด)', () => {
  assert.equal(movedEnough(0, 0), false);
  assert.equal(movedEnough(DRAG_SLOP_PX - 0.1, 0), false);
  assert.equal(movedEnough(DRAG_SLOP_PX, 0), true);
  assert.equal(movedEnough(0, -DRAG_SLOP_PX), true);
});
