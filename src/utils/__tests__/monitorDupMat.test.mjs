/* แถวซ้ำในชีทเดียว — ต้องรวมเป็นแถวเดียวก่อนส่ง ไม่งั้น upsert ล้มทั้งบอร์ด
   ("ON CONFLICT DO UPDATE command cannot affect row a second time")
   🔴 คีย์ = MAT + เลขพาร์ท (เท่ากับ `row_key` ฝั่ง DB) — ยุบด้วย MAT เดี่ยวทำพาร์ทจริงหายไปทั้งแถว */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDuplicateParts } from '../monitoringSheet.js';

const P = (mat, cells, extra = {}) => ({ mat_no: mat, cells, texts: {}, ...extra });

test('🔴🔴 MAT เดียวกันแต่คนละเลขพาร์ท = คนละแถว ห้ามยุบ (300T คว่ำครีบ/หงายครีบ · เคสจริง 08/10)', () => {
  /* ของจริง: MAT 20059152 มี 2 บรรทัด Total SL 2,100 กับ 1,500
     ยุบด้วย MAT = บอร์ดเหลือแถวเดียว ยอดคงเหลือของอีกพาร์ทหายจากจอเงียบๆ */
  const { parts, warnings } = mergeDuplicateParts([
    P('20059152', { balance: { '2026-09-29': 2100 }, min: { '2026-09-29': 6000 } },
      { part_no: 'N1WB-E16A416 (BL) คว่ำครีบ' }),
    P('20059152', { balance: { '2026-09-29': 1500 }, min: { '2026-09-29': 4800 } },
      { part_no: 'N1WB-E16A417 (BL) หงายครีบ' }),
  ]);
  assert.equal(parts.length, 2, 'คนละเลขพาร์ท = คนละแถว');
  assert.equal(parts[0].cells.balance['2026-09-29'], 2100);
  assert.equal(parts[1].cells.balance['2026-09-29'], 1500, 'ยอดของพาร์ทที่ 2 ต้องไม่หาย');
  assert.deepEqual(warnings, [], 'ไม่ใช่แถวซ้ำ จึงไม่ต้องเตือน');
});

test('🔴 แถวซ้ำจริง (MAT + เลขพาร์ทเดียวกัน) รวมเป็นแถวเดียว · **ห้ามบวกยอด** · มีคำเตือน', () => {
  /* Argen 20065715/20065635: บล็อกที่ 2 เป็นสำเนา ค่าทุกช่องที่ทับกันเท่ากันเป๊ะ ⇒ บวก = 2 เท่า */
  const { parts, warnings } = mergeDuplicateParts([
    P('10100001', { order_req: { '2026-10-06': 100 }, balance: { '2026-10-05': 50 } },
      { part_no: 'PN-1', part_name: null }),
    P('10100002', { plan: { '2026-10-06': 10 } }, { part_no: 'PN-2' }),
    P('10100001', { order_req: { '2026-10-06': 100, '2026-10-07': 5 }, balance: { '2026-10-05': 50 } },
      { part_no: 'PN-1', part_name: 'X' }),
  ]);
  assert.equal(parts.length, 2);
  const a = parts.find(p => p.mat_no === '10100001');
  assert.equal(a.cells.order_req['2026-10-06'], 100, '🔴 สำเนาซ้ำ ห้ามกลายเป็น 200');
  assert.equal(a.cells.order_req['2026-10-07'], 5, 'วันที่มีแค่ในแถวหลัง ต้องถูกเติมเข้ามา');
  assert.deepEqual(a.cells.balance, { '2026-10-05': 50 });
  assert.equal(a.part_name, 'X', 'แอตทริบิวต์ว่างของแถวแรกเติมจากแถวหลัง');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /10100001 · PN-1 ×2/);
});

test('ค่าในช่องเดียวกันขัดกันต้องเตือน · ไม่ซ้ำ = ไม่เตือน · ไม่แก้ object เดิม', () => {
  const src = [P('A', { balance: { d: 1 } }, { part_no: 'p' }), P('A', { balance: { d: 2 } }, { part_no: 'p' })];
  const { parts, warnings } = mergeDuplicateParts(src);
  assert.equal(parts[0].cells.balance.d, 1, 'แถวแรกชนะ');
  assert.equal(warnings.length, 2, 'เตือนทั้ง "มีแถวซ้ำ" และ "ค่าขัดกัน"');
  assert.equal(src[0].cells.balance.d, 1, 'ห้ามแก้ของเดิม');
  assert.deepEqual(mergeDuplicateParts([P('A', {}), P('B', {})]).warnings, []);
});

test('ชีทที่ไม่มีเลขพาร์ท (แร็ค/วัตถุดิบ) ยังยุบด้วย MAT เหมือนเดิม', () => {
  const { parts, warnings } = mergeDuplicateParts([
    P('50027079', { in: { d: 4 } }), P('50027079', { in: { d: 4 } }),
  ]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].cells.in.d, 4);
  assert.equal(warnings.length, 1);
});
