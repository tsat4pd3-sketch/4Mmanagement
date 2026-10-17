/* ═══ ผจก.ฝ่ายผลิตที่อยู่ทีม AM ต้องเซ็น "อนุมัติปิดใบ" ของหน่วยตัวเองได้ + ใบต้องเข้าคิว "รอคุณ"
   (เคสจริง 2026-10-16 · user ถาม "ทำไมถึงไม่โชว์ว่ารอเราอนุมัติ ในเมื่อเป็น MO ที่ต้องให้เราอนุมัติปิด")

   ข้อมูลจริงที่ใช้ตั้งเทส:
     · คน  : ดุลยทรรศน์ — role `manager` · position `manager` (rank 60) · sections {PD3,PD4}
             · mtn_teams {production} (ทีม AM = ฝ่ายผลิตซ่อมเครื่องตัวเอง)
     · ใบ  : PRO-QC-011026-0560 · mtn_dept `production` · dept_section PD3 · ขั้น 6 เสร็จ รอขั้น 7
   บั๊ก 2 ชั้นที่เจอ:
     ① actorSideOf ตีคนที่มี mtn_teams = "ฝั่งช่าง" เสมอ ⇒ ขั้น 7 (ช่องของฝ่ายผู้แจ้ง) = wrong_side
        — ล็อกเต็ม ⇒ แม้แต่ manage_master ก็ข้ามไม่ได้ ⇒ **ไม่มีทางกดได้เลย**
     ② soleSignerFor ทิ้งคำตอบ code 'manage_master' ⇒ ผจก.ที่ถือคีย์หัวหน้าถูกตัดจากคิวตัวเอง
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actorSideOf, sideAllows, canDoStep } from '../mtnStepPerm.js';
import { soleSignerFor } from '../myQueue.js';

const isAm = (t) => t === 'production';                       // ตรงกับ mtn_teams.kind='am' ของจริง
const BOSS = { mtnTeams: ['production'], role: 'manager', sections: ['PD3', 'PD4'] };

test('① ทีม AM = ทั้งช่างและผู้แจ้ง → side "both" (ทีมช่างจริงยังเป็น mtn เหมือนเดิม)', () => {
  assert.equal(actorSideOf({ ...BOSS, isAm }), 'both');
  assert.equal(actorSideOf({ mtnTeams: ['maintenance'], role: 'supervisor', sections: ['PD3'], isAm }), 'mtn');
  assert.equal(actorSideOf({ mtnTeams: ['production', 'die_maintenance'], role: '', sections: [], isAm }), 'mtn');
  assert.equal(actorSideOf({ mtnTeams: [], role: '', sections: ['PD3'], isAm }), 'reporter');
  assert.equal(actorSideOf({ mtnTeams: [], role: '', sections: [], isAm }), 'unknown');
  // ช่างเต็มตัว (role mtn) ยังเป็นฝั่งช่าง แม้ทีมจะเป็น AM
  assert.equal(actorSideOf({ mtnTeams: ['production'], role: 'mtn', sections: ['PD3'], isAm }), 'mtn');
});

test('🔴 ไม่ส่ง isAm = พฤติกรรมเดิมเป๊ะ (fail-safe · ห้ามเปลี่ยนเป็นเดา production เอง)', () => {
  assert.equal(actorSideOf({ mtnTeams: ['production'], role: 'manager', sections: ['PD3'] }), 'mtn');
});

test('sideAllows — both ผ่านทั้งสองฝั่ง · unknown ไม่บล็อก · ผิดฝั่งยังบล็อก', () => {
  assert.equal(sideAllows('both', 'reporter'), true);
  assert.equal(sideAllows('both', 'mtn'), true);
  assert.equal(sideAllows('unknown', 'reporter'), true);
  assert.equal(sideAllows('mtn', 'reporter'), false);
  assert.equal(sideAllows('reporter', 'mtn'), false);
  assert.equal(sideAllows('reporter', null), true);
});

const ORDER = {
  mo_no: 'PRO-QC-011026-0560', mtn_dept: 'production', dept_section: 'PD3',
  current_step: 6, status: 'handover', reported_by_name: 'อาทิตย์ เทชะ',
};
const MGR_KEYS = ['report', 'approve', 'close_cost', 'handover', 'accept_work', 'mtn_head', 'manage_master'];
const meOpts = (extra = {}) => ({
  order: ORDER, fullName: 'ดุลยทรรศน์ ลาภธนสารสมบัติ',
  can: (a) => MGR_KEYS.includes(a), seeded: () => true,
  actorSide: actorSideOf({ ...BOSS, isAm }), posRank: 60, ...extra,
});

test('② ขั้น 7 (อนุมัติปิดใบ · ช่องของฝ่ายผู้แจ้ง) — ผจก.ทีม AM กดได้ ไม่ใช่ wrong_side', () => {
  const r = canDoStep(7, meOpts());
  assert.equal(r.ok, true, `ควรกดได้ แต่ได้ code=${r.code}`);
  // ปิดคีย์หัวหน้าแล้วต้องยังผ่าน "ด้วยสิทธิ์ของขั้นนั้นเอง" — ไม่ใช่ผ่านเพราะเป็นหัวหน้า
  const own = canDoStep(7, meOpts({ can: (a) => a !== 'manage_master' && MGR_KEYS.includes(a) }));
  assert.equal(own.ok, true);
  assert.equal(own.code, 'perm');
});

test('🔴 ฝั่งช่างจริงยังเซ็นช่องของฝ่ายผู้แจ้งไม่ได้ (ล็อก 04/10 ต้องไม่หลวมลง)', () => {
  const tech = canDoStep(7, meOpts({ actorSide: 'mtn' }));
  assert.equal(tech.ok, false);
  assert.equal(tech.code, 'wrong_side');
  // ตำแหน่งต่ำกว่าที่ช่องต้องการ (ขั้น 7 = minRank 50 หัวหน้าแผนก/ส่วน/ผจก.) ก็ยังกดไม่ได้เหมือนเดิม
  assert.equal(canDoStep(7, meOpts({ posRank: 40 })).code, 'rank_too_low');
});

/* ── คิว "รอคุณ" ───────────────────────────────────────────────────────── */
/* meta ชุดเดียวกับที่ `moWaitMeta()` คืนจริงสำหรับขั้น 7 ของฟอร์ม 7 ขั้น */
const WAIT7 = { step: 7, byName: null, meta: { side: 'reporter', minRank: 50 } };
const ME = {
  name: 'ดุลยทรรศน์ ลาภธนสารสมบัติ', sections: ['PD3', 'PD4'],
  actorSide: actorSideOf({ ...BOSS, isAm }), posRank: 60,
  can: (a) => MGR_KEYS.includes(a), seeded: () => true,
};

test('③ ใบนี้ต้องเข้าชั้น "รอคุณ" ของ ผจก.ฝ่ายผู้แจ้ง', () => {
  assert.equal(soleSignerFor(ORDER, WAIT7, ME), true);
});

test('🔴 เจตนาเดิมต้องอยู่ครบ — คนที่ถือ "แค่ manage_master" (admin) ยังไม่เข้าคิว', () => {
  const admin = { ...ME, can: (a) => a === 'manage_master' };
  assert.equal(soleSignerFor(ORDER, WAIT7, admin), false);
});

test('🔴 ไม่รู้ฝั่ง / ไม่รู้ตำแหน่ง / ผิดฝั่ง = ไม่เข้าคิว (ไม่รู้ ≠ ใช่)', () => {
  assert.equal(soleSignerFor(ORDER, WAIT7, { ...ME, actorSide: 'unknown' }), false);
  assert.equal(soleSignerFor(ORDER, WAIT7, { ...ME, actorSide: 'mtn' }), false);
  assert.equal(soleSignerFor(ORDER, WAIT7, { ...ME, posRank: null }), false);
  assert.equal(soleSignerFor(ORDER, WAIT7, { ...ME, posRank: 40 }), false);
  // ช่องที่ระบุชื่อคนเซ็นไว้แล้ว = ไปทางนั้น ไม่ใช่ทางนี้
  assert.equal(soleSignerFor(ORDER, { ...WAIT7, byName: 'คนอื่น' }, ME), false);
});
