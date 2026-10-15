import test from 'node:test';
import assert from 'node:assert/strict';
import { pillarHeight, SEVERITY_H } from '../mapPillar.js';

test('OEE: สูงตาม %OEE · clamp 0-100', () => {
  assert.equal(pillarHeight('oee', 'good', 80).h, 0.8);
  assert.equal(pillarHeight('oee', 'good', 140).h, 1);
});
test('OEE ไม่มีค่า = เตี้ยสุด ห้ามเดาค่ากลาง', () => {
  assert.equal(pillarHeight('oee', 'idle', null).h, 0.04);
});
test('metric อื่น: ปัญหาหนักกว่าต้องสูงกว่า', () => {
  const h = (c) => pillarHeight('health', c, null).h;
  assert.ok(h('down') > h('bad') && h('bad') > h('ok') && h('ok') > h('good') && h('good') > h('idle'));
  assert.equal(pillarHeight('health', 'ไม่รู้จัก', null).h, SEVERITY_H.idle);
});

import { liftLabels } from '../mapPillar.js';

test('liftLabels: เสาจุดเดียวกัน สูงเท่ากัน → ใบหนึ่งอยู่ที่หัวเสา อีกใบถูกยกขึ้นพ้น', () => {
  const items = [
    { key: 'a', name: 'Line 60', text: '0/5', x: 50, y: 50, h: 0.8 },
    { key: 'b', name: 'Line 61', text: '0/5', x: 50.5, y: 50, h: 0.8 },
  ];
  const m = liftLabels(items, { Wpx: 1200, Hpx: 700, maxH: 200 });
  const lifts = [m.get('a').lift, m.get('b').lift].sort((x, y) => x - y);
  assert.equal(lifts[0], 0);
  assert.ok(lifts[1] > 0);
  assert.ok(m.get('a').ok && m.get('b').ok);
});
test('liftLabels: ใบสำคัญ (เสาสูงกว่า) ได้ที่ก่อน — ไม่ถูกยก', () => {
  const items = [
    { key: 'lo', name: 'Line 60', x: 50, y: 50, h: 0.75 },
    { key: 'hi', name: 'Line 61', x: 50, y: 50, h: 0.8 },
  ];
  const m = liftLabels(items, { Wpx: 1200, Hpx: 700, maxH: 200 });
  assert.equal(m.get('hi').lift, 0);
  assert.ok(m.get('lo').lift > 0);
});
test('liftLabels: ห่างกันพอ = ไม่ยก · ไม่รู้ขนาดผัง = ไม่ยก', () => {
  const items = [{ key: 'a', name: 'A', x: 10, y: 10, h: 0.5 }, { key: 'b', name: 'B', x: 90, y: 90, h: 0.5 }];
  const m = liftLabels(items, { Wpx: 1200, Hpx: 700, maxH: 200 });
  assert.equal(m.get('a').lift + m.get('b').lift, 0);
  assert.equal(liftLabels(items, {}).get('a').lift, 0);
});
test('liftLabels: แน่นเกินเพดาน = ok:false ห้ามยกไม่สิ้นสุด', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ key: i, name: 'LINE APRON ASSY', x: 50, y: 50, h: 0.5 }));
  const m = liftLabels(items, { Wpx: 1200, Hpx: 700, maxH: 100 });
  const bad = [...m.values()].filter(v => !v.ok);
  assert.ok(bad.length > 0);
  assert.ok([...m.values()].every(v => v.lift <= 160));
});

import { clampTilt, normDeg, orbitFromDrag, TILT_MIN, TILT_MAX } from '../mapPillar.js';

test('มุมกล้อง: tilt ถูกบีบในช่วง · rot วนอยู่ใน (-180,180]', () => {
  assert.equal(clampTilt(5), TILT_MIN);
  assert.equal(clampTilt(99), TILT_MAX);
  assert.equal(clampTilt('x'), 48);
  assert.equal(normDeg(190), -170);
  assert.equal(normDeg(-28 + 360 * 50), -28);
  assert.equal(normDeg(180), 180);
});
test('ลากขวา = หมุนเพิ่ม · ลากขึ้น = เอียงมากขึ้น (ก้มลง)', () => {
  const o = orbitFromDrag({ rot: 0, tilt: 48 }, 100, -40);
  assert.ok(o.rot > 0);
  assert.ok(o.tilt > 48);
});

import { orbitScale } from '../mapPillar.js';
test('orbitScale: มุมเริ่มต้น = 0.72 · หมุนจนผังกว้างตั้งขวาง = ย่อลง', () => {
  assert.equal(orbitScale(-28, 48, 0.56), 0.72);
  assert.ok(orbitScale(62, 48, 0.56) < 0.72);
  assert.ok(orbitScale(0, 48, 0.56) <= 0.72 * 1.15);
});
