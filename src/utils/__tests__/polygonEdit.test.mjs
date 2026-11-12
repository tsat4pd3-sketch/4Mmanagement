import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  edgeAxis, edgeTiltDeg, isAxisAligned, dragVertex, dragEdge, maxShiftPct,
  isSelfIntersecting, checkPolygonEdit, straightenPolygon, JUMP_CONFIRM_PCT,
} from '../polygonEdit.js';

const RECT = [[10, 10], [30, 10], [30, 20], [10, 20]];
const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 30], [0, 30]];

test('แนวขอบตัดสินในหน่วยจริง (หาร aspect)', () => {
  assert.equal(edgeAxis([0, 0], [10, 0], 1), 'h');
  assert.equal(edgeAxis([0, 0], [0, 10], 1), 'v');
  // dx 10 dy 12 : aspect 2 ⇒ dy จริง = 6 < 10 ⇒ นอน
  assert.equal(edgeAxis([0, 0], [10, 12], 2), 'h');
  assert.equal(edgeTiltDeg([0, 0], [10, 0], 1), 0);
  assert.ok(Math.abs(edgeTiltDeg([0, 0], [10, 10], 1) - 45) < 1e-9);
});

test('ลากมุมสี่เหลี่ยมแบบคงมุมฉาก = ยังเป็นสี่เหลี่ยม', () => {
  const out = dragVertex(RECT, 2, 5, 3, { ortho: true, aspect: 1 });
  // เพื่อนบ้านของมุม 2: มุม 1 (ขอบตั้ง → รับ dx) · มุม 3 (ขอบนอน → รับ dy)
  assert.deepEqual(out, [[10, 10], [35, 10], [35, 23], [10, 23]]);
  assert.ok(isAxisAligned(out, 1));
});

test('ลากมุมรูป L ยังคงมุมฉาก', () => {
  const out = dragVertex(L, 3, 2, 4, { ortho: true, aspect: 1 });
  assert.ok(isAxisAligned(out, 1, 0));
});

test('ortho=false = ขยับจุดเดียว (พฤติกรรมเดิม)', () => {
  const out = dragVertex(RECT, 2, 5, 3, { ortho: false });
  assert.deepEqual(out, [[10, 10], [30, 10], [35, 23], [10, 20]]);
});

test('ลากกลางขอบ = ดันทั้งด้าน ตั้งฉากกับขอบเท่านั้น', () => {
  assert.deepEqual(dragEdge(RECT, 0, 7, -4, { aspect: 1 }), [[10, 6], [30, 6], [30, 20], [10, 20]]);
  assert.deepEqual(dragEdge(RECT, 1, 5, 9, { aspect: 1 }), [[10, 10], [35, 10], [35, 20], [10, 20]]);
});

test('ค่าถูกบีบใน 0-100', () => {
  const out = dragVertex(RECT, 0, -50, -50, { ortho: true, aspect: 1 });
  out.forEach(p => p.forEach(v => assert.ok(v >= 0 && v <= 100)));
});

test('ด่านกันพลาด: เคส Laser GOR (จุดหลุด) = ต้องยืนยัน · ปรับขนาดปกติ = ผ่าน', () => {
  const good = [[63.41, 69.57], [63.41, 75.41], [59.12, 75.23], [59.11, 69.64]];
  const bad = [[63.41, 69.57], [63.41, 75.41], [68.49, 23.77], [59.11, 68.89]];
  assert.equal(checkPolygonEdit(good, bad).verdict, 'confirm');
  assert.equal(checkPolygonEdit(RECT, dragVertex(RECT, 2, 3, 2, { ortho: true })).verdict, 'ok');
  // ขอบพอดีเกณฑ์ = ยังไม่ถาม
  const edge = RECT.map(p => [p[0] + JUMP_CONFIRM_PCT, p[1]]);
  assert.equal(checkPolygonEdit(RECT, edge).verdict, 'ok');
});

test('เส้นตัดกันเอง = ห้ามบันทึก', () => {
  const bow = [[10, 10], [30, 20], [30, 10], [10, 20]];
  assert.ok(isSelfIntersecting(bow));
  assert.ok(!isSelfIntersecting(RECT));
  assert.ok(!isSelfIntersecting(L));
  assert.equal(checkPolygonEdit(RECT, bow).verdict, 'block');
});

test('maxShiftPct: จำนวนจุดไม่เท่ากัน = Infinity (ไม่ปล่อยผ่านเงียบ)', () => {
  assert.equal(maxShiftPct(RECT, RECT.slice(0, 3)), Infinity);
});

test('จัดให้ตรง: ขอบเกือบตรงดีดเข้าแกน · ขอบเฉียงจริงไม่แตะ', () => {
  const skewRect = [[10, 10], [30, 10.5], [30.4, 20], [10, 20]];
  const s = straightenPolygon(skewRect, 1);
  assert.ok(s.changed);
  assert.ok(isAxisAligned(s.points, 1, 0));
  const tri = [[0, 0], [20, 0], [10, 20]];          // ขอบเฉียง 2 เส้น
  const t = straightenPolygon(tri, 1);
  assert.equal(t.skewed, 2);
  assert.deepEqual(t.points[2], [10, 20]);
  assert.equal(straightenPolygon(RECT, 1).changed, false);
});
