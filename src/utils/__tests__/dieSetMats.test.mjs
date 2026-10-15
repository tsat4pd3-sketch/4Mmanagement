// เทส "ชุดแม่พิมพ์ทำพาร์ทอะไรบ้าง" — src/utils/dieSetMats.js (pure)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dieSetMats, dieMakesMat, dieSetPairState, suggestPps, pairHint } from '../dieSetMats.js';

test('dieSetMats — รวม 2 ช่อง · ตัดว่าง/ซ้ำ · normalize ตัวพิมพ์-ช่องว่าง', () => {
  assert.deepEqual(dieSetMats({ mat_no: 'A', mat_no_2: 'B' }), ['A', 'B']);
  assert.deepEqual(dieSetMats({ mat_no: ' a ', mat_no_2: 'b' }), ['A', 'B'], 'trim + upper');
  assert.deepEqual(dieSetMats({ mat_no: 'A', mat_no_2: 'a' }), ['A'], 'ตัวเดียวกัน = ไม่นับซ้ำ');
  assert.deepEqual(dieSetMats({ mat_no: 'A', mat_no_2: '' }), ['A'], 'ช่อง 2 ว่าง = ทำพาร์ทเดียว');
  assert.deepEqual(dieSetMats({ mat_no: null, mat_no_2: 'B' }), ['B'], 'ลงเฉพาะช่อง 2 ก็ยังอ่านออก');
  assert.deepEqual(dieSetMats({}), [], 'ไม่ผูก MAT เลย = ลิสต์ว่าง');
  assert.deepEqual(dieSetMats(null), [], 'ไม่มีแถว = ไม่พัง');
});

test('dieMakesMat — แทน `d.mat_no === mat` ได้ทุกกรณีเดิม', () => {
  const d = { mat_no: 'A', mat_no_2: 'B' };
  assert.equal(dieMakesMat(d, 'A'), true);
  assert.equal(dieMakesMat(d, 'B'), true, '🔴 ฝั่งที่ลงช่อง 2 ต้องหาเจอ (เดิมหาไม่เจอ)');
  assert.equal(dieMakesMat(d, 'C'), false);
  assert.equal(dieMakesMat(d, ''), true, 'ไม่ระบุ mat = ไม่กรอง (พฤติกรรมเดิมของ dieOptsForMat)');
  assert.equal(dieMakesMat(d, null), true);
  // แถวเดิมที่ยังไม่มี mat_no_2 = ต้องเท่า `=== mat` เป๊ะ (blast radius 0)
  const old = { mat_no: 'A' };
  for (const m of ['A', 'B', 'x', '']) assert.equal(dieMakesMat(old, m), !m || m === 'A');
});

test('dieSetPairState — เทียบกับคู่ที่ Product Master ตั้งไว้ (จอชี้ ไม่แก้ให้)', () => {
  const two = { mat_no: 'A', mat_no_2: 'B' };
  assert.equal(dieSetPairState({ mat_no: 'A' }, () => 'B').state, 'single', 'ตัวเดียว = ไม่มีอะไรให้ตรวจ');
  assert.equal(dieSetPairState(two, m => (m === 'A' ? 'B' : 'A')).state, 'ok');
  assert.equal(dieSetPairState(two, () => null).state, 'unset', 'ยังไม่ตั้งคู่ = ต้องเตือน (OEE นับซ้ำอยู่)');
  const bad = dieSetPairState(two, m => (m === 'A' ? 'Z' : null));
  assert.equal(bad.state, 'mismatch');
  assert.equal(bad.says, 'Z', 'ต้องบอกด้วยว่าทะเบียนว่าคู่คือตัวไหน');
  assert.equal(dieSetPairState(two, m => (m === 'A' ? 'b' : null)).state, 'ok', 'เทียบแบบไม่สนตัวพิมพ์');
  assert.equal(dieSetPairState(two, null).state, 'unset', 'ไม่ส่ง pairOf = ถือว่ายังไม่รู้ ไม่ใช่ mismatch');
});

test('suggestPps — เสนอเท่านั้น · ตัวเดียว/ไม่มี = ไม่เสนอ', () => {
  assert.equal(suggestPps({ mat_no: 'A', mat_no_2: 'B' }), 2);
  assert.equal(suggestPps({ mat_no: 'A' }), null, '🔴 ชุดพาร์ทเดียว ห้ามเสนอ 1 (ไม่รู้ ≠ 1)');
  assert.equal(suggestPps({}), null);
});

test('pairHint — ชี้เป้าเท่านั้น · ไม่มีหลักฐาน = null', () => {
  assert.equal(pairHint({ part_no: 'BHS08555/BHS07706' })?.why, 'เลขพาร์ทมี 2 ตัวคั่น /');
  assert.equal(pairHint({ part_name: 'BRKT RH/LH' })?.why, 'ชื่อเอ่ยทั้ง RH และ LH');
  assert.match(pairHint({ part_no: 'A/B', part_name: 'PANEL RH/LH' }).why, /\+/, 'เจอ 2 อย่างต้องบอกทั้งคู่');
  assert.equal(pairHint({ part_no: 'DA6T-60-A31', part_name: 'BRKT' }), null, 'ไม่มีหลักฐาน = null');
  assert.equal(pairHint({ part_name: 'BRKT RH' }), null, '🔴 ข้างเดียว = ไม่ใช่หลักฐานงานคู่');
  assert.equal(pairHint({ part_no: 'N1WB17E850-R-PIA07/PIA08' })?.why, 'เลขพาร์ทมี 2 ตัวคั่น /', 'ขีดกลางในเลขพาร์ทต้องไม่กวน');
  assert.equal(pairHint({}), null);
  assert.equal(pairHint(null), null, 'ไม่มีแถว = ไม่พัง');
});
