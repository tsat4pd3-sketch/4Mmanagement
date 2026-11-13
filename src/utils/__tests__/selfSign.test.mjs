import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSelfName, pickSignerPatch, signSlotState } from '../selfSign.js';

test('isSelfName: ยุบช่องว่าง/ตัวพิมพ์ · ว่าง = ไม่ใช่', () => {
  assert.equal(isSelfName('นาย ก  ข', 'นาย ก ข'), true);
  assert.equal(isSelfName('นาย ก', 'นาย ข'), false);
  assert.equal(isSelfName('นาย ก', ''), false);
  assert.equal(isSelfName('', 'นาย ก'), false);
});
test('pickSignerPatch: ลายเซ็นติดเฉพาะเจ้าตัว', () => {
  const me = { fullName: 'นาย ก', uid: 'u1', mySig: 'sig.png' };
  assert.deepEqual(pickSignerPatch('นาย ก', me), { name: 'นาย ก', uid: 'u1', sig: 'sig.png', self: true });
  assert.deepEqual(pickSignerPatch('นาย ข', me), { name: 'นาย ข', uid: null, sig: null, self: false });
  assert.deepEqual(pickSignerPatch('', me), { name: null, uid: null, sig: null, self: false });
  assert.equal(pickSignerPatch('นาย ก', { uid: 'u1', mySig: 's' }).sig, null);   // ไม่รู้ชื่อผู้ login = ไม่แปะ
});
test('signSlotState', () => {
  assert.equal(signSlotState({ name: 'ก', sig: 'x' }), 'signed');
  assert.equal(signSlotState({ name: 'ก', uid: 'u' }), 'signed');
  assert.equal(signSlotState({ name: 'ก' }), 'waiting');
  assert.equal(signSlotState({}), 'empty');
});
