/**
 * เทส src/utils/qaSequential.js — ตัวเดินกฎตรวจทีละชิ้น (sequential acceptance)
 * ครอบทุกเส้นทางในตารางที่ user รับกฎ 2026-09-07:
 *   รอบ 1: ผ่าน=ยอมรับ · ตก→ผ่าน→ผ่าน=ยอมรับ · ตก→ตก=alarm · ตก→ผ่าน→ตก=alarm
 *   รอบ ≥2: ตกชิ้นเดียว=alarm ซ้ำ · ผ่านติดกัน 2=ยอมรับ
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { evalSequence, pieceResult, seqLabel, SEQ_RULE } from '../qaSequential.js';

const P = (piece_no, result, round_no = 1) => ({ piece_no, result, round_no });
const seqOf = (results, actions = []) => evalSequence(results.map((r, i) => P(i + 1, r.res, r.round ?? 1)), actions);
const R1 = (...rs) => rs.map(res => ({ res }));

test('pieceResult: ทุกจุดต้องมีคำตอบ · ng ชิ้นเดียว = ตก · na นับเป็นผ่าน', () => {
  assert.equal(pieceResult(['ok', 'ok', 'na']), 'pass');
  assert.equal(pieceResult(['ok', 'ng']), 'fail');
  assert.equal(pieceResult(['ok', null]), null);
  assert.equal(pieceResult(['ok', undefined]), null);
  assert.equal(pieceResult([]), null);
});

test('ใบเปล่า = กำลังตรวจ ชิ้นถัดไป = 1 รอบ 1', () => {
  const s = evalSequence([], []);
  assert.equal(s.state, 'inspecting');
  assert.equal(s.nextPiece, 1);
  assert.equal(s.round, 1);
  assert.equal(s.code, 'start');
  assert.match(seqLabel(s), /ชิ้นที่ 1/);
});

test('รอบ 1: ชิ้นแรกผ่าน = ยอมรับทันที ไม่ต้องหยิบชิ้นที่ 2', () => {
  const s = seqOf(R1('pass'));
  assert.equal(s.state, 'accepted');
  assert.equal(s.acceptedBy, 'first_pass');
});

test('รอบ 1: ตก → ต้องตรวจชิ้นถัดไป (ยังไม่ alarm)', () => {
  const s = seqOf(R1('fail'));
  assert.equal(s.state, 'inspecting');
  assert.equal(s.nextPiece, 2);
  assert.equal(s.failsInRound, 1);
  assert.equal(s.code, 'fail_need_next');
  assert.match(seqLabel(s), /ชิ้นที่ 2/);
});

test('รอบ 1: ตก → ผ่าน → ต้องผ่านอีก 1 · ตก → ผ่าน → ผ่าน = ยอมรับ (ติดกัน 2)', () => {
  const mid = seqOf(R1('fail', 'pass'));
  assert.equal(mid.state, 'inspecting');
  assert.equal(mid.passStreak, 1);
  assert.equal(mid.code, 'pass_need_one_more');
  const ok = seqOf(R1('fail', 'pass', 'pass'));
  assert.equal(ok.state, 'accepted');
  assert.equal(ok.acceptedBy, 'two_passes');
});

test('รอบ 1: ตก → ตก = alarm รอ action', () => {
  const s = seqOf(R1('fail', 'fail'));
  assert.equal(s.state, 'await_action');
  assert.equal(s.alarmRound, 1);
  assert.equal(s.alarmCount, 1);
  assert.equal(s.code, 'alarm_two_fails');
});

test('รอบ 1: ตก → ผ่าน → ตก = alarm (ตกสะสม 2 ไม่ต้องติดกัน)', () => {
  const s = seqOf(R1('fail', 'pass', 'fail'));
  assert.equal(s.state, 'await_action');
  assert.equal(s.alarmCount, 1);
  assert.equal(s.failsInRound, 2);
});

test('ยอมรับแล้ว = คงที่ ต่อให้มีแถวเกินมา (ห้ามกลับไปตรวจต่อ)', () => {
  const s = seqOf(R1('pass', 'fail'));
  assert.equal(s.state, 'accepted');
});

test('หลัง action: เข้ารอบ 2 ต้องผ่านติดกัน 2 ชิ้น · ผ่าน 1 ยังไม่พอ', () => {
  const pieces = [P(1, 'fail'), P(2, 'fail')];
  const afterAction = evalSequence(pieces, [{ round_no: 1 }]);
  assert.equal(afterAction.state, 'inspecting');
  assert.equal(afterAction.round, 2);
  assert.equal(afterAction.nextPiece, 3);
  assert.equal(afterAction.code, 'after_action_start');
  assert.match(seqLabel(afterAction), /รอบที่ 2/);

  const one = evalSequence([...pieces, P(3, 'pass', 2)], [{ round_no: 1 }]);
  assert.equal(one.state, 'inspecting');
  assert.equal(one.code, 'after_action_pass_need_one_more');

  const two = evalSequence([...pieces, P(3, 'pass', 2), P(4, 'pass', 2)], [{ round_no: 1 }]);
  assert.equal(two.state, 'accepted');
  assert.equal(two.acceptedBy, 'two_passes');
  assert.equal(two.round, 2);
});

test('หลัง action: ตกแม้ชิ้นเดียว = alarm ซ้ำทันที นับครั้งที่ 2', () => {
  const s = evalSequence([P(1, 'fail'), P(2, 'fail'), P(3, 'fail', 2)], [{ round_no: 1 }]);
  assert.equal(s.state, 'await_action');
  assert.equal(s.alarmRound, 2);
  assert.equal(s.alarmCount, 2);
  assert.equal(s.code, 'alarm_after_action');
  assert.match(seqLabel(s), /ครั้งที่ 2/);
  // ผ่านแล้วค่อยตก ก็ alarm เหมือนกัน
  const s2 = evalSequence([P(1, 'fail'), P(2, 'fail'), P(3, 'pass', 2), P(4, 'fail', 2)], [{ round_no: 1 }]);
  assert.equal(s2.state, 'await_action');
  assert.equal(s2.alarmCount, 2);
});

test('action 2 รอบซ้อน → รอบ 3 · ยอมรับได้ในรอบ 3', () => {
  const pieces = [P(1, 'fail'), P(2, 'fail'), P(3, 'fail', 2), P(4, 'pass', 3), P(5, 'pass', 3)];
  const s = evalSequence(pieces, [{ round_no: 1 }, { round_no: 2 }]);
  assert.equal(s.state, 'accepted');
  assert.equal(s.round, 3);
  assert.equal(s.alarmCount, 2);
});

test('มี action แต่ยังไม่มีชิ้นในรอบใหม่ → กำลังตรวจรอบใหม่ ชิ้นถัดไปนับต่อเนื่อง', () => {
  const s = evalSequence([P(1, 'fail'), P(2, 'pass'), P(3, 'fail')], [{ round_no: 1 }]);
  assert.equal(s.state, 'inspecting');
  assert.equal(s.round, 2);
  assert.equal(s.nextPiece, 4);
  assert.equal(s.failsInRound, 0);
});

test('ข้อมูลไม่สอดคล้อง: ชิ้นของรอบ 2 โผล่โดยไม่มี action ปิดรอบ 1 → หยุดที่รอ action + code บอกชัด', () => {
  const s = evalSequence([P(1, 'fail'), P(2, 'fail'), P(3, 'pass', 2)], []);
  assert.equal(s.state, 'await_action');
  assert.equal(s.code, 'inconsistent_round');
});

test('ลำดับชิ้นไม่เรียงใน input ก็เดินตาม piece_no · แถวผลไม่ถูกต้องถูกทิ้ง', () => {
  const s = evalSequence([P(2, 'pass'), P(1, 'fail'), { piece_no: 9, result: 'weird', round_no: 1 }], []);
  assert.equal(s.state, 'inspecting');
  assert.equal(s.passStreak, 1);
  assert.equal(s.nextPiece, 3);
});

test('ค่าคงที่ของกฎถูกล็อกไว้ (เปลี่ยน = ต้องเปลี่ยนเอกสาร + เทสนี้)', () => {
  assert.deepEqual({ ...SEQ_RULE }, { FAILS_TO_ALARM: 2, PASSES_TO_ACCEPT: 2 });
});
