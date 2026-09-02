// เทสกติกา "ขั้นไหนใครทำ" ของใบแจ้งซ่อม MO — src/utils/mtnStepPerm.js
// pure module (ไม่ import supabase) → import ตรงได้เลย ไม่ต้อง bundle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDoStep, isOrderReporter, MTN_STEPS, stepDenyHint } from '../mtnStepPerm.js';

// ผูก role เป็นชุดสิทธิ์ง่ายๆ: keys = คีย์ที่ role นั้นถือ
const perms = (keys, seededKeys = null) => ({
  can: (a) => keys.includes(a),
  seeded: (a) => (seededKeys ? seededKeys.includes(a) : true),
});
const SEEDED_ALL = null;                  // apply migration แล้ว
const SEEDED_OLD = ['report', 'service', 'qa', 'approve', 'manage_master', 'service_own_team'];

const ORDER = { reported_by_name: 'สมชาย ใจดี', reporter_prod: 'สมชาย ใจดี' };

test('ขั้น 4 ตรวจรับงาน: ช่างที่ซ่อม (service) ทำไม่ได้แล้ว — ต้องเป็นผู้เปิดใบหรือถือ accept_work', () => {
  const tech = { order: ORDER, fullName: 'ช่างเอก', ...perms(['service'], SEEDED_ALL) };
  assert.equal(canDoStep(4, tech).ok, false, 'ช่างต้องตรวจงานตัวเองไม่ได้');

  const opener = { order: ORDER, fullName: 'สมชาย ใจดี', ...perms([], SEEDED_ALL) };
  assert.deepEqual(canDoStep(4, opener), { ok: true, code: 'reporter' });

  const head = { order: ORDER, fullName: 'หัวหน้าบี', ...perms(['accept_work'], SEEDED_ALL) };
  assert.deepEqual(canDoStep(4, head), { ok: true, code: 'perm' });
});

test('ขั้น 4/6 ก่อน apply migration: ถอยไปคีย์เดิม (deploy โค้ดก่อนรัน SQL แล้วใบต้องไม่ค้าง)', () => {
  const tech = { order: ORDER, fullName: 'ช่างเอก', ...perms(['service'], SEEDED_OLD) };
  assert.deepEqual(canDoStep(4, tech), { ok: true, code: 'fallback' });

  const anyone = { order: ORDER, fullName: 'ใครก็ได้', ...perms(['report'], SEEDED_OLD) };
  assert.deepEqual(canDoStep(6, anyone), { ok: true, code: 'fallback' });
});

test('ขั้น 6 หลัง apply: ผู้ถือ report เฉยๆ (ทุก role) กดไม่ได้แล้ว', () => {
  const anyone = { order: ORDER, fullName: 'พนักงานขาย', ...perms(['report'], SEEDED_ALL) };
  assert.equal(canDoStep(6, anyone).ok, false);

  const head = { order: ORDER, fullName: 'หัวหน้าแผนก', ...perms(['report', 'handover'], SEEDED_ALL) };
  assert.equal(canDoStep(6, head).ok, true);
});

test('ขั้น 2 จ่ายงาน: แยกจากขั้น 3 — ช่างที่ถือแค่ service กดจ่ายงานไม่ได้', () => {
  const tech = { order: ORDER, fullName: 'ช่างเอก', ...perms(['service'], SEEDED_ALL) };
  assert.equal(canDoStep(2, tech).ok, false, 'ช่างจ่ายงานให้ตัวเองไม่ได้');
  assert.equal(canDoStep(3, tech).ok, true, 'แต่ลงมือซ่อมได้');

  const lead = { order: ORDER, fullName: 'หัวหน้าช่าง', ...perms(['assign'], SEEDED_ALL) };
  assert.equal(canDoStep(2, lead).ok, true);
});

test('ขั้น 2 ก่อน apply: คนถือ service เดิมยังจ่ายงานได้ (ไม่มีใครทำงานไม่ได้ตอน deploy)', () => {
  const mtn = { order: ORDER, fullName: 'ช่างเอก', ...perms(['service'], SEEDED_OLD) };
  assert.deepEqual(canDoStep(2, mtn), { ok: true, code: 'fallback' });
});

test('service_own_team ครอบขั้น 2-3 เท่านั้น ไม่ครอบขั้น 4 อีกต่อไป', () => {
  const own = { order: ORDER, fullName: 'ช่างผลิต', inOrderTeam: true, ...perms(['service_own_team'], SEEDED_ALL) };
  assert.deepEqual(canDoStep(2, own), { ok: true, code: 'own_team' });
  assert.deepEqual(canDoStep(3, own), { ok: true, code: 'own_team' });
  assert.equal(canDoStep(4, own).ok, false, 'ขั้น 4 ไม่ใช่งานของทีมช่างแล้ว');
});

test('service_own_team: ถือคีย์แต่ไม่ได้ตั้งทีม (inOrderTeam=false) = ยังทำไม่ได้', () => {
  const noTeam = { order: ORDER, fullName: 'หัวหน้ากลุ่ม', inOrderTeam: false, ...perms(['service_own_team'], SEEDED_ALL) };
  assert.equal(canDoStep(2, noTeam).ok, false);
});

test('manage_master แก้ย้อนหลังได้ทุกขั้น (พฤติกรรมเดิม ห้ามถอด)', () => {
  const boss = { order: ORDER, fullName: 'ผจก.', ...perms(['manage_master'], SEEDED_ALL) };
  for (const s of [2, 3, 4, 5, 6, 7]) assert.deepEqual(canDoStep(s, boss), { ok: true, code: 'manage_master' });
});

test('ขั้น 7 ไม่มี fallback และไม่ให้ผู้เปิดใบอนุมัติเอง', () => {
  const opener = { order: ORDER, fullName: 'สมชาย ใจดี', ...perms(['report'], SEEDED_ALL) };
  assert.equal(canDoStep(7, opener).ok, false, 'คนเปิดใบปิดใบเองไม่ได้');
  const sup = { order: ORDER, fullName: 'หัวหน้าส่วน', ...perms(['approve'], SEEDED_ALL) };
  assert.equal(canDoStep(7, sup).ok, true);
});

test('isOrderReporter: ยึด reported_by_name ก่อน — reporter_prod ที่พิมพ์แก้ได้ห้ามสวมสิทธิ์', () => {
  const o = { reported_by_name: 'สมชาย ใจดี', reporter_prod: 'คนอื่น' };
  assert.equal(isOrderReporter(o, 'สมชาย ใจดี'), true);
  assert.equal(isOrderReporter(o, 'คนอื่น'), false, 'พิมพ์ชื่อตัวเองลงช่องผู้แจ้งแล้วสวมสิทธิ์ไม่ได้');
  // ใบเก่าที่ยังไม่มี stamp → ถอยไปใช้ reporter_prod
  assert.equal(isOrderReporter({ reporter_prod: 'สมหญิง' }, 'สมหญิง'), true);
  // ช่องว่าง/ตัวพิมพ์ต่างกันต้องยังจับคู่ได้
  assert.equal(isOrderReporter({ reported_by_name: '  Somchai  Jaidee ' }, 'somchai jaidee'), true);
  // ไม่มีชื่อผู้ใช้ = ไม่ใช่เจ้าของใบ (ห้ามผ่านเพราะทั้งคู่เป็นค่าว่าง)
  assert.equal(isOrderReporter({ reported_by_name: '' }, ''), false);
});

test('ขั้น 1 คุมด้วย report ตรงๆ (ไม่อยู่ใน MTN_STEPS)', () => {
  assert.equal(MTN_STEPS[1], undefined);
  assert.equal(canDoStep(1, { ...perms(['report']) }).ok, true);
  assert.equal(canDoStep(1, { ...perms([]) }).ok, false);
});

test('stepDenyHint บอกชื่อคนเปิดใบ/ทีม ให้ไปทำอะไรต่อได้จริง', () => {
  const h4 = stepDenyHint(4, { reporterName: 'สมชาย ใจดี' });
  assert.ok(h4.some(l => l.includes('สมชาย ใจดี')));
  assert.ok(h4.some(l => l.includes('mtn_repair:accept_work')));
  const h2 = stepDenyHint(2, { teamName: 'MTN' });
  assert.ok(h2.some(l => l.includes('service_own_team')));
  assert.ok(h2.some(l => l.includes('/add-user')));
});

test('ทุกขั้นใน MTN_STEPS มี title/who ครบ — จอเอาไปแสดงได้เสมอ', () => {
  for (const [s, m] of Object.entries(MTN_STEPS)) {
    assert.ok(m.title && m.who, `step ${s} ขาด title/who`);
    assert.ok(m.key, `step ${s} ขาด key`);
  }
});
