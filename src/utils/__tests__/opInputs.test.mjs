import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opInputsOf, parentKidsAfterOps, isFirstOpInChain } from '../opInputs.js';

const STEEL = { mat_no: '50031625', qty_per_unit: 1 };
const NUT = { mat_no: '30043726', qty_per_unit: 6 };

test('ขั้น OP ผูก BOM เอง = ใช้ BOM ของขั้น', () => {
  assert.deepEqual(opInputsOf({ ownKids: [STEEL], parentKids: [STEEL, NUT] }), { kids: [STEEL], via: 'op_bom' });
});
test('ยังไม่ผูก + แม่มีลูกตัวเดียว = กินลูกตัวนั้น (user เคาะ)', () => {
  assert.equal(opInputsOf({ ownKids: [], parentKids: [STEEL] }).via, 'auto_single');
});
test('ยังไม่ผูก + แม่มีลูกหลายตัว = unset ห้ามเดา', () => {
  assert.deepEqual(opInputsOf({ ownKids: [], parentKids: [STEEL, NUT] }), { kids: [], via: 'unset' });
});
test('ใบแม่หักของที่ขั้น OP กินไปแล้ว · ขั้นที่ unset ไม่หักอะไร', () => {
  assert.deepEqual(parentKidsAfterOps([STEEL, NUT], [[STEEL]]).map(x => x.mat_no), ['30043726']);
  assert.deepEqual(parentKidsAfterOps([STEEL, NUT], [[]]).map(x => x.mat_no), ['50031625', '30043726']);
});

test('🔗 โซ่ขั้น (HYDROFORM 10 → LASER-345 20): ลูกตัวเดียวอัตโนมัติใช้กับขั้นแรกเท่านั้น · ขั้นถัดไป = from_prev', () => {
  const sib = [{ op_seq: 10 }, { op_seq: 20 }];
  assert.equal(isFirstOpInChain(sib[0], sib), true);
  assert.equal(isFirstOpInChain(sib[1], sib), false);
  assert.equal(opInputsOf({ parentKids: [STEEL], firstInChain: false }).via, 'from_prev');
  assert.equal(opInputsOf({ parentKids: [STEEL], firstInChain: true }).via, 'auto_single');
  // หลายขั้นแต่ลำดับไม่ครบ = ไม่รู้ว่าตัวไหนแรก = ไม่ใช่ (ห้ามเดา)
  assert.equal(isFirstOpInChain({ op_seq: null }, [{ op_seq: null }, { op_seq: 20 }]), false);
  assert.equal(isFirstOpInChain({ op_seq: null }, [{ op_seq: null }]), true);
});
