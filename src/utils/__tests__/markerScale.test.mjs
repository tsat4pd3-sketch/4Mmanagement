/**
 * เทสสูตรขนาด marker บนผัง — เคสจริงที่ user ทัก 2026-08-24
 * "ทำไมขนาดสัญลักษณ์ไม่เท่ากัน อันใหญ่มันเบียด"
 *
 * รัน: node --test 'src/utils/__tests__/*.test.mjs'
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { markerScale } from '../markerScale.js';

/** สร้างหมุด n ตัวกระจายเป็นตาราง ภายในกรอบ % ที่กำหนด (เลียนผังจริง) */
function grid(n, { x0 = 5, y0 = 5, x1 = 95, y1 = 95 } = {}) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push({
      pos_left: String(x0 + (cols > 1 ? (c * (x1 - x0)) / (cols - 1) : 0)),
      pos_top: String(y0 + (rows > 1 ? (r * (y1 - y0)) / (rows - 1) : 0)),
    });
  }
  return out;
}

const MAP = { w: 1385, h: 430 };   // ขนาดรูปผังที่ render จริงบนจอ 1920 (จากภาพที่ user ส่งมา)

test('ไม่ส่ง points = สูตรเดิมเป๊ะ (caller เก่าต้องไม่กระทบ)', () => {
  const mk = markerScale(1385, { machineCount: 14 });
  assert.equal(mk.MK, 76);
  assert.equal(mk.SUB, Math.round(76 * 0.6));          // ≤18 = 0.6× ตามสูตรเดิม
  assert.equal(markerScale(1385, { machineCount: 25 }).SUB, Math.round(76 * 0.5));
  assert.equal(markerScale(1385, { machineCount: 40 }).SUB, Math.round(76 * 0.42));
  // ส่ง points มาแต่ไม่มี mapHeight ก็ต้องถอยไปสูตรเดิม (ไม่มีความสูง = คำนวณระยะจริงไม่ได้)
  assert.equal(markerScale(1385, { machineCount: 14, points: grid(14) }).SUB, Math.round(76 * 0.6));
});

test('เครื่องน้อยแต่กระจุกมุมเดียว ต้องเล็กลง (เคส HDF1 ที่ยืมผังไลน์แม่)', () => {
  // 14 ตัวอัดอยู่ในพื้นที่ ~28% ของผัง — สูตรเดิมนับ "14 ตัว" แล้วให้วงใหญ่สุดจนทับกันมั่ว
  const packed = grid(14, { x0: 33, y0: 30, x1: 61, y1: 62 });
  const now = markerScale(MAP.w, { machineCount: 14, points: packed, mapHeight: MAP.h });
  const before = markerScale(MAP.w, { machineCount: 14 });
  assert.ok(now.SUB < before.SUB, `ต้องเล็กลงจากเดิม (เดิม ${before.SUB} → ตอนนี้ ${now.SUB})`);
  assert.ok(now.SUB >= Math.round(now.MK * 0.34), 'ต้องไม่เล็กกว่าเพดานล่างจนอ่านไม่ออก');
});

test('เครื่องเยอะแต่กระจายเต็มผัง ต้องไม่ถูกย่อเพราะ "จำนวนเยอะ"', () => {
  // 26 ตัวกระจายเต็มผัง — สูตรเดิมตี 0.5× ทั้งที่ยังมีที่ว่างเหลือ
  const spread = grid(26);
  const now = markerScale(MAP.w, { machineCount: 26, points: spread, mapHeight: MAP.h });
  const before = markerScale(MAP.w, { machineCount: 26 });
  assert.ok(now.SUB > before.SUB, `กระจายแล้วต้องได้ใหญ่กว่าสูตรนับจำนวน (เดิม ${before.SUB} → ${now.SUB})`);
});

test('แน่นพอกัน = ขนาดพอกัน (ไม่กระโดดตรงเลข 18/19 แบบไม่มีเหตุผล)', () => {
  const a = markerScale(MAP.w, { machineCount: 18, points: grid(18), mapHeight: MAP.h });
  const b = markerScale(MAP.w, { machineCount: 19, points: grid(19), mapHeight: MAP.h });
  assert.ok(Math.abs(a.SUB - b.SUB) <= 4, `ผังที่แน่นใกล้กันต้องขนาดใกล้กัน (${a.SUB} vs ${b.SUB})`);
  // ของเดิมกระโดดจาก 0.6× เป็น 0.5× ทันทีที่เครื่องที่ 19 ถูกวาง
  const oldA = markerScale(MAP.w, { machineCount: 18 }).SUB;
  const oldB = markerScale(MAP.w, { machineCount: 19 }).SUB;
  assert.ok(Math.abs(oldA - oldB) > 4, 'ยืนยันว่าสูตรเดิมกระโดดจริง (กันเทสนี้กลายเป็นเทสเปล่า)');
});

test('วงกลมต้องไม่กว้างกว่าระยะเพื่อนบ้าน (ไม่ทับกัน)', () => {
  for (const n of [8, 14, 20, 26, 36]) {
    const pts = grid(n);
    const mk = markerScale(MAP.w, { machineCount: n, points: pts, mapHeight: MAP.h });
    // ระยะเพื่อนบ้านที่ใกล้ที่สุดจริงของชุดนี้ (px)
    const px = pts.map(p => [(parseFloat(p.pos_left) / 100) * MAP.w, (parseFloat(p.pos_top) / 100) * MAP.h]);
    let minGap = Infinity;
    for (let i = 0; i < px.length; i++) {
      for (let j = i + 1; j < px.length; j++) {
        minGap = Math.min(minGap, Math.hypot(px[i][0] - px[j][0], px[i][1] - px[j][1]));
      }
    }
    // ยอมให้ชนได้เฉพาะตอนโดนเพดานล่าง (ผังแน่นเกินกว่าจะย่อไปมากกว่านี้แล้วยังอ่านออก)
    const floored = mk.SUB <= Math.round(mk.MK * 0.34) + 1;
    assert.ok(mk.SUB <= minGap || floored, `n=${n}: วง ${mk.SUB}px กว้างกว่าระยะ ${minGap.toFixed(0)}px`);
  }
});

test('หมุดตัวเดียว / ข้อมูลพิกัดเสีย = ไม่พัง ถอยไปสูตรนับจำนวน', () => {
  assert.equal(markerScale(MAP.w, { machineCount: 1, points: grid(1), mapHeight: MAP.h }).SUB, Math.round(76 * 0.6));
  const junk = [{ pos_left: null, pos_top: undefined }, { pos_left: 'x', pos_top: 'y' }];
  assert.equal(markerScale(MAP.w, { machineCount: 2, points: junk, mapHeight: MAP.h }).SUB, Math.round(76 * 0.6));
});

test('ป้ายชื่อยังต้องอ่านออกเสมอ แม้ผังแน่นสุดขั้ว (บทเรียนเก่า: ป้ายเหลือ "S…" = ไร้ประโยชน์)', () => {
  const packed = grid(30, { x0: 40, y0: 40, x1: 58, y1: 58 });   // อัดกันในพื้นที่ 18%×18%
  const mk = markerScale(MAP.w, { machineCount: 30, points: packed, mapHeight: MAP.h });
  assert.ok(mk.subPillFont >= 11, 'ฟอนต์ป้ายห้ามต่ำกว่า 11px (UI-CONVENTIONS จอ TV)');
  // ห้ามเอา "ระยะเพื่อนบ้าน" มาบีบความกว้างป้าย — ผังแน่นจะได้ป้าย ~10px อ่านไม่ออก
  assert.ok(mk.subPillMaxW >= 88, `ป้ายต้องกว้างพออ่านชื่อเครื่อง ~8-10 ตัวอักษร (ได้ ${mk.subPillMaxW}px)`);
});
