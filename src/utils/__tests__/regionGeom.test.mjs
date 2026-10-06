import test from 'node:test';
import assert from 'node:assert/strict';
import { polyArea, labelAnchor, bboxOf, plainLabelLayout } from '../regionGeom.js';

const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

test('polyArea / labelAnchor / bboxOf', () => {
  assert.equal(polyArea(sq(0, 0, 10)), 100);
  assert.deepEqual(labelAnchor(sq(10, 20, 10)), [15, 20]);
  assert.equal(bboxOf(sq(10, 20, 5)).w, 5);
});

test('⭐ plainLabelLayout: ทุกกรอบได้ชื่อ · ทับกัน = กรอบเล็กสละ (จอ TV /tv · 05/10)', () => {
  const regions = [
    { id: 1, line_name: 'BIG', points: sq(10, 10, 30) },
    { id: 2, line_name: 'FAR', points: sq(60, 60, 20) },
    { id: 3, line_name: 'OVERLAP', points: sq(21, 21, 8) },   // กลางกรอบใหญ่ ทับป้าย BIG
  ];
  const out = plainLabelLayout(regions, { wrapW: 1000, wrapH: 600 });
  assert.deepEqual(out.map(o => o.name).sort(), ['BIG', 'FAR']);
  // ไม่รู้ขนาดผัง = วางทุกกรอบ
  assert.equal(plainLabelLayout(regions, {}).length, 3);
  // ไลน์ที่มีป้ายเด่นอยู่แล้ว (skip) ไม่ได้ชื่อซ้ำ
  assert.ok(!plainLabelLayout(regions, { wrapW: 1000, wrapH: 600, skip: new Set(['FAR']) }).some(o => o.name === 'FAR'));
});
