/* เทส dieRegistryExport — ทะเบียนแม่พิมพ์ "1 ตัว = 1 OP" + common die + Excel ให้ทีม DIE ไล่ข้อมูล (05/11)
   โจทย์:
   1. 🔴 ช่องที่ยังไม่รู้ = เซลล์ว่าง ห้ามเป็น 0 (ไฟล์คือ worklist — 0 = "รู้แล้วว่าเป็น 0")
   2. common die: แม่พิมพ์ที่ชุด BA ยืมจากชุด AA ต้องโผล่ในทั้ง 2 ชุด (ชุดยืมระบุ OP ของชุดนั้น)
   3. ยืมเข้าชุดบ้านของตัวเอง = ไม่นับซ้ำ (DB กันแล้ว แต่จอกันซ้ำ)
   4. แถวแรกของทุกชีต = หัวตาราง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membersBySet, dieRegistryAoa, DIE_SHEET_HEADERS, SET_SHEET_HEADERS } from '../dieRegistryExport.js';

const AA = { id: 'aa', set_code: 'DS-AA', part_name: 'FLR 70/71AA', line_name: 'LINE B' };
const BA = { id: 'ba', set_code: 'DS-BA', part_name: 'FLR 70/71BA', line_name: 'LINE B' };
const die = (id, no, set, op, extra = {}) => ({ id, machine_no: `NAME ${id}`, line_name: 'LINE B', is_active: true,
  ext: { die_no: no, die_set_id: set, op_seq: op, ...extra } });
const dies = [
  die('a10', 'D-0001', 'aa', 10), die('a20', 'D-0002', 'aa', 20),
  die('a30', 'D-0003', 'aa', 30), die('a40', 'D-0004', 'aa', 40),
  die('b30', 'D-0005', 'ba', 30),
];
// ชุด BA ยืม OP10/20/40 ของ AA (ตัวอย่างจริงของ user 05/11)
const shared = [
  { die_set_id: 'ba', machine_id: 'a10', op_seq: 10 },
  { die_set_id: 'ba', machine_id: 'a20', op_seq: 20 },
  { die_set_id: 'ba', machine_id: 'a40', op_seq: 40 },
];

test('common die — ชุด BA มีครบ 4 OP (3 ยืม + 1 ของตัวเอง) เรียงตาม OP', () => {
  const m = membersBySet(dies, shared);
  assert.deepEqual(m.ba.map(x => [x.opSeq, x.die.ext.die_no, x.shared]),
    [[10, 'D-0001', true], [20, 'D-0002', true], [30, 'D-0005', false], [40, 'D-0004', true]]);
  assert.equal(m.aa.length, 4);                   // ชุดบ้านไม่เสียอะไร
  assert.ok(m.aa.every(x => !x.shared));
});

test('ยืมเข้าชุดบ้านตัวเอง = ไม่นับซ้ำ · แม่พิมพ์ที่ไม่อยู่ในลิสต์ = ไม่วาด', () => {
  const m = membersBySet(dies, [{ die_set_id: 'aa', machine_id: 'a10', op_seq: 10 }, { die_set_id: 'aa', machine_id: 'zz', op_seq: 50 }]);
  assert.equal(m.aa.length, 4);
});

test('Excel — หัวตารางอยู่แถวแรก · ช่องที่ไม่รู้เป็นเซลล์ว่าง ไม่ใช่ 0', () => {
  const x = dieRegistryAoa({ dies: [die('n', 'D-0009', null, null)], sets: [] });
  assert.deepEqual(x.dies[0], DIE_SHEET_HEADERS);
  assert.deepEqual(x.sets[0], SET_SHEET_HEADERS);
  const row = x.dies[1];
  const col = (h) => row[DIE_SHEET_HEADERS.indexOf(h)];
  assert.equal(col('เลขแม่พิมพ์'), 'D-0009');
  for (const h of ['OP', 'ชิ้นเข้า/shot', 'ชิ้นออก/shot', 'ความสูงตอนปิดพิมพ์ (มม.)', 'ตัน', 'น้ำหนัก (กก.)', 'ชุดบ้าน (set code)']) {
    assert.equal(col(h), '', `${h} ต้องว่าง`);
  }
  assert.equal(row.length, DIE_SHEET_HEADERS.length);
});

test('Excel — ชีตแม่พิมพ์บอก "ใช้ร่วมกับชุดอื่น" · ชีตชุดบอกเลขแม่พิมพ์ตาม OP', () => {
  const x = dieRegistryAoa({ dies, sets: [AA, BA], shared });
  const a10 = x.dies.find(r => r[0] === 'D-0001');
  assert.equal(a10[DIE_SHEET_HEADERS.indexOf('ใช้ร่วมกับชุดอื่น')], 'DS-BA (OP10)');
  const ba = x.sets.find(r => r[0] === 'DS-BA');
  assert.equal(ba[SET_SHEET_HEADERS.indexOf('แม่พิมพ์ในชุด (ตัว)')], 4);
  assert.equal(ba[SET_SHEET_HEADERS.indexOf('เลขแม่พิมพ์ตาม OP')],
    'OP10=D-0001(ร่วม) · OP20=D-0002(ร่วม) · OP30=D-0005 · OP40=D-0004(ร่วม)');
});

test('Excel — ค่า 0 ที่กรอกจริงยังเป็น 0 (ไม่ถูกกลืนเป็นว่าง)', () => {
  const x = dieRegistryAoa({ dies: [die('z', 'D-0010', null, null, { shot_total: 0, regrind_count: 0 })] });
  const r = x.dies[1];
  assert.equal(r[DIE_SHEET_HEADERS.indexOf('shot สะสม')], 0);
  assert.equal(r[DIE_SHEET_HEADERS.indexOf('เจียรแล้ว')], 0);
});
