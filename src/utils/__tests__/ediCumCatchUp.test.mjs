/* แถว "ยอดค้างตาม Cum" ของ 862 (Forecast Date = วันออกไฟล์ · ไม่มีเวลา · qty = Cum − Shipped)
   เคสจริง 01–02/10 AAT/GRBNA: สร้างเป็นใบ 540 ชิ้นค้างแดงข้างใบ e-SMART ⇒ ship-to ที่ใช้ e-SMART ห้ามเป็นใบส่ง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCumCatchUp } from '../ediMerge.js';

const r = (shipTo, date, time, qty, part = 'RB3B 16E060 BA', dock = 'B5') => ({ shipTo, part, dock, date, time, qty });
const FILE = [
  r('GRBNA', '2026-09-30', null, 540),          // ยอดค้างตาม Cum
  r('GRBNA', '2026-10-05', '08:00', 50),
  r('GRBNA', '2026-10-05', '10:00', 20),
  r('GRBNA', '2026-09-30', null, 525, 'RB3B 8C306 BC'),
  r('GRBNA', '2026-10-05', '08:00', 35, 'RB3B 8C306 BC'),
  r('GBL9A', '2026-09-30', null, 112, 'MB3B 8A297 CB', 'T6'),   // ไม่มี e-SMART
  r('GBL9A', '2026-10-01', '05:30', 56, 'MB3B 8A297 CB', 'T6'),
  r('GBJWE', '2026-10-01', null, 183, 'X1', null),               // ชีตไม่มีเวลาเลย
  r('GBJWE', '2026-10-02', null, 200, 'X1', null),
];

test('🔴 ship-to ที่ใช้ e-SMART: แถวไม่มีเวลาวันแรกของชุด = ยอดค้างตาม Cum ไม่ใช่ใบส่ง', () => {
  const { keep, catchUp } = splitCumCatchUp(FILE, ['GRBNA']);
  assert.deepEqual(catchUp.map(x => [x.part, x.qty]), [['RB3B 16E060 BA', 540], ['RB3B 8C306 BC', 525]]);
  assert.equal(keep.length, FILE.length - 2);
  assert.ok(keep.every(x => x.shipTo !== 'GRBNA' || x.time), 'แถวมีเวลาของ GRBNA ต้องอยู่ครบ');
});

test('ship-to ที่ไม่มี e-SMART คงเดิม — ไม่มีใครดึงแทน ยอดค้างต้องเป็นใบ', () => {
  const { catchUp } = splitCumCatchUp(FILE, ['GRBNA']);
  assert.ok(!catchUp.some(x => x.shipTo === 'GBL9A'));
  assert.equal(splitCumCatchUp(FILE, []).catchUp.length, 0);
});

test('ชีตที่ไม่มีเวลาทั้งชีตไม่เข้าข่าย แม้จะอยู่ในรายชื่อ e-SMART', () => {
  const { catchUp } = splitCumCatchUp(FILE, ['GBJWE']);
  assert.equal(catchUp.length, 0);
});

test('แถวไม่มีเวลาที่ไม่ใช่วันแรกของชุด ไม่ถูกตัด (ห้ามเดาเกินหลักฐาน)', () => {
  const recs = [r('GRBNA', '2026-10-05', '08:00', 50), r('GRBNA', '2026-10-06', null, 30)];
  assert.equal(splitCumCatchUp(recs, ['GRBNA']).catchUp.length, 0);
});
