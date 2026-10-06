/* เลขใบเบิกภายใน = "เลขสูงสุดของเดือน + 1" (QC 05/10)
   เดิมใช้ `rows.length` ของแถวบนจอ (ผูกตัวกรองเดือน/สถานะ) ⇒ ออกเลขซ้ำได้ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReqNo, maxReqSeq, reqNoPrefix } from '../materialRequest.js';

test('prefix ของเดือน · วันที่ผิดรูป = ว่าง', () => {
  assert.equal(reqNoPrefix('2026-10-05'), 'MR-2610-');
  assert.equal(reqNoPrefix(''), '');
  assert.equal(reqNoPrefix('2026'), '');
});

test('ใช้เลขสูงสุด ไม่ใช่จำนวนแถว — มีช่องโหว่ (ลบ/ยกเลิก) ก็ไม่ชนเลขเดิม', () => {
  const docs = ['MR-2610-001', 'MR-2610-007', 'MR-2610-003'];
  assert.equal(maxReqSeq(docs, '2026-10-20'), 7);
  assert.equal(nextReqNo('2026-10-20', maxReqSeq(docs, '2026-10-20')), 'MR-2610-008');
});

test('เลข SAP ที่สโตร์ใส่ทับ / เลขของเดือนอื่น ไม่ถูกนับ', () => {
  const docs = ['4900012345', 'MR-2609-099', 'MR-2610-002', null, 'MR-2610-0x'];
  assert.equal(maxReqSeq(docs, '2026-10-01'), 2);
});

test('เดือนแรก (ยังไม่มีใบ) = 001', () => {
  assert.equal(nextReqNo('2026-10-01', maxReqSeq([], '2026-10-01')), 'MR-2610-001');
  assert.equal(nextReqNo('bad', 5), '');
});
