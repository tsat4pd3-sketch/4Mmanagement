/* ลูกค้าส่งยอด 0 ทั้งสัปดาห์ = ไม่ต้องส่ง ⇒ ใบ pending เดิมของชุดนั้นต้องถูกแทนที่ (เคสจริง AAT 05/10)
   เดิมแถว 0 ถูกทิ้งตอนอ่านไฟล์ ⇒ ship-to ไม่อยู่ในไฟล์ ⇒ ใบเก่าค้างทั้งบอร์ด */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopedReplaceIds } from '../ediMerge.js';

const old = [
  { id: 'a', shipTo: 'GRBNA', part: 'RB3B 16E060 BA', dock: 'B5', date: '2026-10-05' },
  { id: 'b', shipTo: 'GRBNA', part: 'RB3B 16E060 BA', dock: 'B5', date: '2026-10-06' },
  { id: 'c', shipTo: 'GBL9A', part: 'MB3B 8A297 CB', dock: 'T6', date: '2026-10-05' },
];

test('🔴 แถวยอด 0 เป็นขอบเขตแทนที่ — ใบ pending เก่าของวันนั้นถูกล้าง', () => {
  const zeros = [
    { shipTo: 'GRBNA', part: 'RB3B 16E060 BA', dock: 'B5', date: '2026-10-05' },
    { shipTo: 'GRBNA', part: 'RB3B 16E060 BA', dock: 'B5', date: '2026-10-09' },
  ];
  const { ids } = scopedReplaceIds(old, zeros, { useDock: true });
  assert.deepEqual(ids.sort(), ['a', 'b']);
});

test('ไม่ส่งแถว 0 มาเลย = ไม่แตะ (พฤติกรรมเดิม: ชุดที่ไม่อยู่ในไฟล์ = ไม่มีอัพเดท)', () => {
  assert.deepEqual(scopedReplaceIds(old, [], { useDock: true }).ids, []);
});
