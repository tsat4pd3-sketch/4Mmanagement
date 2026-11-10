import test from 'node:test';
import assert from 'node:assert/strict';
import { restampQPatch } from '../../utils/restampQ.js';

const Y = (o) => ({ id: 'y1', bin: 'yellow', qty: 1, is_active: true, ...o });
const S = { actual_qty: 399, oee_a: 90, oee_p: 80, oee_q: 100, oee: 72 };

test('ปิดกะตอน NG ยังรอพิจารณา (Q 100) → QA ทำลาย → Q 99.75 + oee คิดใหม่จาก A/P ที่ stamp', () => {
  const p = restampQPatch(S, [{ qty_ng: 1, quality_bin_records: [Y({ qa_decision: 'scrap' })] }]);
  assert.equal(p.oee_q, 99.75);
  assert.equal(p.oee, 71.82);
});
test('QA ซ่อมแล้วดี → Q ยัง 100 = ไม่เขียนอะไร', () => {
  assert.equal(restampQPatch(S, [{ qty_ng: 1, quality_bin_records: [Y({ qa_decision: 'repair' })] }]), null);
});
test('กะไม่มีผลผลิต = ไม่แตะ · ไม่มี A/P = oee null', () => {
  assert.equal(restampQPatch({ ...S, actual_qty: 0 }, [{ qty_ng: 1 }]), null);
  const p = restampQPatch({ actual_qty: 399, oee_q: 100 }, [{ qty_ng: 1, quality_bin_records: [] }]);
  assert.deepEqual(p, { oee_q: 99.75, oee: null });
});
