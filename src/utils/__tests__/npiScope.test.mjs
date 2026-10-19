import test from 'node:test';
import assert from 'node:assert/strict';
import { npiLineOfPart, npiBlock, npiBlockForPart, npiProjectDeleteBlock } from '../npiScope.js';

const PARTS = [
  { id: 'p1', part_no: 'A', line_name: 'Assy2' },
  { id: 'p2', part_no: 'B', line_name: 'Store Semi' },
  { id: 'p3', part_no: 'C', line_name: null },      // ยังไม่ระบุไลน์
];
// ของเรา = Assy2 เท่านั้น
const writeOf = (ln) => (!ln ? { ok: true, code: 'unknown_target' }
  : ln === 'Assy2' ? { ok: true, code: 'own' } : { ok: false, code: 'other_unit' });

test('npiLineOfPart — รับ id หรือแถวที่อ้าง part_id · หาไม่เจอ = null', () => {
  assert.equal(npiLineOfPart(PARTS, 'p1'), 'Assy2');
  assert.equal(npiLineOfPart(PARTS, { part_id: 'p2' }), 'Store Semi');
  assert.equal(npiLineOfPart(PARTS, { id: 'p3' }), null);
  assert.equal(npiLineOfPart(PARTS, 'ไม่มี'), null);
  assert.equal(npiLineOfPart(PARTS, ''), null);
  assert.equal(npiLineOfPart(null, 'p1'), null);
});

test('npiBlock — ของเราผ่าน · ของไลน์อื่นบล็อกพร้อมเหตุผล · ไม่ส่งตัวตัดสิน = ไม่บล็อก', () => {
  assert.equal(npiBlock(writeOf, 'Assy2'), null);
  const msg = npiBlock(writeOf, 'Store Semi');
  assert.ok(msg && /แก้ไม่ได้/.test(msg), msg);
  assert.equal(npiBlock(writeOf, null), null, 'ไม่รู้ไลน์ = ไม่บล็อก (คงพฤติกรรมเดิม)');
  assert.equal(npiBlock(undefined, 'Store Semi'), null, 'หน้าแม่ไม่ส่ง = ไม่บล็อก');
});

test('npiBlockForPart — ไล่จาก part_id ของแถวลูก (เอกสาร/แบบ/tooling/งาน)', () => {
  assert.equal(npiBlockForPart(writeOf, PARTS, { part_id: 'p1' }), null);
  assert.ok(npiBlockForPart(writeOf, PARTS, { part_id: 'p2' }));
  assert.equal(npiBlockForPart(writeOf, PARTS, { part_id: null }), null, 'แถวระดับโปรเจค = ไม่บล็อก');
});

test('🔴 ลบโปรเจค — ต้องแก้ได้ทุกพาร์ท · นับพาร์ทไม่ได้ = ห้ามลบ (fail-closed)', () => {
  assert.equal(npiProjectDeleteBlock(writeOf, [PARTS[0], PARTS[2]]), null);
  const msg = npiProjectDeleteBlock(writeOf, PARTS);
  assert.ok(msg && /พาร์ท 1 รายการ/.test(msg) && /Store Semi/.test(msg), msg);
  assert.equal(npiProjectDeleteBlock(writeOf, []), null, 'โปรเจคเปล่า = ลบได้');
  const blocked = npiProjectDeleteBlock(writeOf, null, { countable: false });
  assert.ok(blocked && /ยังลบโปรเจคไม่ได้/.test(blocked));
  // แม้ไม่มีตัวตัดสิน ถ้านับไม่ได้ก็ต้องห้ามลบ
  assert.ok(npiProjectDeleteBlock(undefined, null, { countable: false }));
});
