/* ══ 📸 snapshot CT + เวลาพัก ตอนปิดกะ (oee.js §snapshot · 2026-11-11 · คำสั่ง user) ══════════
   โจทย์: ค่า %A/%P ที่ stamp ไว้ ต้อง **คำนวณซ้ำได้ค่าเดิม** แม้ทะเบียนจะถูกแก้ภายหลัง
   (เคสจริง 10/11: restamp 5 กะเก่า ไม่มีกะไหนได้ค่าเดิม เพราะ `break_policies` ถูกแก้ 20/10 + 05/11)
   🔴 และกะที่ **ไม่มี** snapshot ต้องได้พฤติกรรมเดิมเป๊ะ (ห้ามบล็อก ห้ามเดา) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSessionOee, makeBreakSnapshot, readBreakSnapshot, readCtSnapshot, BREAK_SNAPSHOT_V } from '../oee.js';

const WD = '2026-11-10';
const sess = (o = {}) => ({ work_date: WD, shift: 'day', line_name: 'L1', start_time: '08:00:00', end_time: '17:30:00', ...o });
const ord = (o = {}) => ({ id: 'o1', mat_no: 'M1', status: 'confirmed', qty: 300,
  opened_at: `${WD}T08:00:00`, confirmed_at: `${WD}T17:30:00`, ...o });
const P = [{ mat_no: 'M1', name: 'PART', p_no: 'PN1', cycle_time_sec: 60, pair_mat_no: null }];
// นโยบายพักชุด "ตอนปิดกะ" — พักเที่ยง 50 นาที
const POL_THEN = [{ id: 1, name: 'พักเที่ยง', shift: 'both', process_type: 'common', ot_scope: 'always',
  anchor: 'clock', start_time: '12:00', duration_min: 50 }];
// ทะเบียนวันนี้ถูกแก้เป็น 60 นาที (= สิ่งที่ทำให้กะเก่าคำนวณใหม่ไม่ตรง)
const POL_NOW = POL_THEN.map(p => ({ ...p, duration_min: 60 }));

test('📸 พัก — มี snapshot แล้วทะเบียนถูกแก้ ยังได้ policyBreakMin/%A เดิมเป๊ะ', () => {
  const base = { orders: [ord()], products: P, ngQty: 0, endTime: '17:30:00' };
  const then = computeSessionOee({ ...base, session: sess(), breakPolicies: POL_THEN, lineRules: { byLine: new Map() } });
  assert.equal(then.policyBreakMin, 50);
  const snap = then.breakSnapshot;
  assert.equal(snap.v, BREAK_SNAPSHOT_V);

  // ทะเบียนเปลี่ยน + ไม่มี snapshot = เลขเพี้ยน (นี่คืออาการที่ต้องแก้)
  const drift = computeSessionOee({ ...base, session: sess(), breakPolicies: POL_NOW, lineRules: { byLine: new Map() } });
  assert.equal(drift.policyBreakMin, 60);
  assert.notEqual(drift.netAvail, then.netAvail);   // ฐานเวลาขยับ ⇒ %P ขยับตาม
  assert.notEqual(drift.P, then.P);

  // มี snapshot = ตรึง
  const replay = computeSessionOee({ ...base, session: sess({ break_snapshot: snap }), breakPolicies: POL_NOW, lineRules: { byLine: new Map() } });
  assert.equal(replay.policyBreakMin, 50);
  assert.equal(replay.netAvail, then.netAvail);
  assert.equal(replay.A, then.A);
  assert.equal(replay.P, then.P);
  // คืน snapshot เดิมกลับมา ห้ามทับด้วยทะเบียนวันนี้
  assert.equal(replay.breakSnapshot, snap);
});

test('🔴 ไม่มี snapshot = พฤติกรรมเดิมเป๊ะ (อ่านทะเบียนสด)', () => {
  const base = { orders: [ord()], products: P, ngQty: 0, endTime: '17:30:00', breakPolicies: POL_NOW, lineRules: { byLine: new Map() } };
  const a = computeSessionOee({ ...base, session: sess() });
  const b = computeSessionOee({ ...base, session: sess({ break_snapshot: null }) });
  assert.equal(a.policyBreakMin, b.policyBreakMin);
  assert.equal(a.A, b.A);
});

test('🔴 snapshot เวอร์ชันที่ไม่รู้จัก / รูปผิด = ถอยไปทะเบียนสด ห้ามพัง', () => {
  assert.equal(readBreakSnapshot({ break_snapshot: { v: 99, policies: [] } }), null);
  assert.equal(readBreakSnapshot({ break_snapshot: [] }), null);
  assert.equal(readBreakSnapshot({ break_snapshot: { v: 1 } }), null);
  assert.equal(readBreakSnapshot(null), null);
});

test('⚠️ snapshot ที่ policies ว่าง ≠ ไม่มี snapshot — กะนั้นไม่มีพักจริงๆ ต้องเคารพ', () => {
  const base = { orders: [ord()], products: P, ngQty: 0, endTime: '17:30:00', breakPolicies: POL_NOW, lineRules: { byLine: new Map() } };
  const r = computeSessionOee({ ...base, session: sess({ break_snapshot: { v: 1, process_type: null, policies: [], line_rules: {} } }) });
  assert.equal(r.policyBreakMin, 0);
});

test('📸 กฎพักรายไลน์เก็บแบบ "ยังไม่ทับ" — isOt ต้องยังตัดสินจากค่ากลาง (ไม่ปลุก no_ot กลับมา)', () => {
  /* 5ส. 2 แถว: 17:10 (เฉพาะกะไม่ทำโอ) · 19:40 (เฉพาะกะทำโอ) — ไลน์นี้ตั้งพักโอเป็น 0 นาที
     = "ไลน์นี้ไม่พักรอบนั้น" ไม่ใช่ "ไลน์นี้ไม่ได้ทำโอ" ⇒ ห้ามหักพัก 17:10 กลับมา */
  const pol = [
    { id: 10, name: '5ส.', shift: 'both', process_type: 'common', ot_scope: 'no_ot', anchor: 'clock', start_time: '17:10', duration_min: 20 },
    { id: 11, name: '5ส.โอ', shift: 'both', process_type: 'common', ot_scope: 'ot',    anchor: 'clock', start_time: '19:40', duration_min: 20 },
  ];
  const lineRules = { byLine: new Map([['L1', new Map([['11', 0]])]]), orphanLines: [], ruleCount: 1 };
  const base = { orders: [ord({ confirmed_at: `${WD}T20:00:00` })], products: P, ngQty: 0, endTime: '20:00:00' };
  const live = computeSessionOee({ ...base, session: sess({ end_time: '20:00:00' }), breakPolicies: pol, lineRules });
  assert.equal(live.policyBreakMin, 0, 'กะทำโอ + ไลน์ตั้งพักโอ 0 ⇒ ไม่มีพักเลย');

  const snap = live.breakSnapshot;
  assert.deepEqual(snap.line_rules, { 11: 0 }, 'กฎรายไลน์ต้องเก็บแยก ไม่ทับลง duration_min');
  assert.equal(snap.policies.find(p => p.id === 11).duration_min, 20, 'ค่ากลางต้องคงอยู่ (isOt ใช้ตัวนี้)');
  const replay = computeSessionOee({ ...base, session: sess({ end_time: '20:00:00', break_snapshot: snap }), breakPolicies: [], lineRules: null });
  assert.equal(replay.policyBreakMin, 0, 'replay ต้องไม่ปลุกพัก 17:10 (no_ot) กลับมา');
});

test('📸 นาทีพักวันหยุดถูก resolve ลง duration_min แล้ว (ปฏิทินแก้ย้อนหลังได้) + ทิ้ง duration_min_holiday', () => {
  const pol = [{ id: 1, name: 'พักเที่ยง', shift: 'both', process_type: 'common', ot_scope: 'always',
    anchor: 'clock', start_time: '12:00', duration_min: 50, duration_min_holiday: 60, holiday_min: 60, holiday_central_min: 50 }];
  const snap = makeBreakSnapshot({ breakPolicies: pol, session: sess(), processType: null, lineRules: { byLine: new Map() } });
  assert.equal(snap.policies[0].duration_min_holiday, undefined, 'ห้ามเก็บ duration_min_holiday (replay จะสลับซ้ำ)');
  assert.equal(snap.policies[0].duration_min, 50);
});

test('📸 process_type ของไลน์ต้องมาจาก snapshot — ทะเบียนเปลี่ยนชนิดกระบวนการแล้วพักต้องไม่หาย', () => {
  const pol = [{ id: 2, name: 'พักเชื่อม', shift: 'both', process_type: 'weld', ot_scope: 'always',
    anchor: 'clock', start_time: '12:00', duration_min: 30 }];
  const base = { orders: [ord()], products: P, ngQty: 0, endTime: '17:30:00', breakPolicies: pol, lineRules: { byLine: new Map() } };
  const then = computeSessionOee({ ...base, session: sess(), processType: 'weld' });
  assert.equal(then.policyBreakMin, 30);
  const replay = computeSessionOee({ ...base, session: sess({ break_snapshot: then.breakSnapshot }), processType: 'press' });
  assert.equal(replay.policyBreakMin, 30, 'snapshot ต้องชนะ process_type วันนี้');
});

test('📸 CT — snapshot ชนะทะเบียนสด (%P ต้องตรึง)', () => {
  const base = { orders: [ord()], ngQty: 0, endTime: '17:30:00' };
  const then = computeSessionOee({ ...base, session: sess(), products: P });
  const ctSnap = then.ctUsed;
  assert.equal(ctSnap.M1, 60);
  // CT ในทะเบียนถูกแก้เป็น 30 วินาที ⇒ %P ครึ่งเดียว
  const slower = [{ ...P[0], cycle_time_sec: 30 }];
  const drift = computeSessionOee({ ...base, session: sess(), products: slower });
  assert.ok(drift.P < then.P);
  const replay = computeSessionOee({ ...base, session: sess({ ct_snapshot: ctSnap }), products: slower });
  assert.equal(replay.P, then.P);
  assert.equal(replay.stdMin, then.stdMin);
});

test('🔴 CT ที่ snapshot ไม่รู้ (0 / ขาด) = ถอยไปทะเบียนสด ไม่ตรึงความไม่รู้ไว้', () => {
  assert.equal(readCtSnapshot({ ct_snapshot: { M1: 0 } }), null);
  assert.equal(readCtSnapshot({ ct_snapshot: {} }), null);
  const base = { orders: [ord()], products: P, ngQty: 0, endTime: '17:30:00' };
  const r = computeSessionOee({ ...base, session: sess({ ct_snapshot: { M9: 99 } }) });
  assert.equal(r.ctUsed.M1, 60, 'MAT ที่ไม่อยู่ใน snapshot ใช้ทะเบียนสด');
});

test('🔴 ทะเบียนพักยังไม่โหลด = snapshot null ห้ามเขียน {} ทับของเดิม', () => {
  assert.equal(makeBreakSnapshot({ breakPolicies: [], session: sess() }), null);
});
