// เทสกติกา "ขั้นไหนใครทำ" ของใบแจ้งซ่อม MO — src/utils/mtnStepPerm.js
// pure module (ไม่ import supabase) → import ตรงได้เลย ไม่ต้อง bundle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDoStep, canSignMtnApproval, lastStep, canSkipQa, isOrderReporter, orderReporterText, isQaSkipped, isWaitingQa, MTN_STEPS, stepDenyHint, stepLabel, stepMeta } from '../mtnStepPerm.js';

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

test('ขั้น 7 ไม่ให้ผู้เปิดใบอนุมัติเอง · คีย์ = close_cost (แยกจาก approve ของฝั่งช่าง 2026-10-04)', () => {
  const opener = { order: ORDER, fullName: 'สมชาย ใจดี', ...perms(['report'], SEEDED_ALL) };
  assert.equal(canDoStep(7, opener).ok, false, 'คนเปิดใบปิดใบเองไม่ได้');
  const sup = { order: ORDER, fullName: 'หัวหน้าส่วน', ...perms(['close_cost'], SEEDED_ALL) };
  assert.equal(canDoStep(7, sup).ok, true);
  /* 🔒 หลัง seed แล้ว คนที่ถือแค่ `approve` (ขั้นของฝั่งช่าง) ปิดใบฝั่งผู้แจ้งไม่ได้อีก
     — นี่คือรูที่ user เจอ: "ผจก ช่าง อนุมัติเลยก็มาอนุมัติแทน ผจก ผลิตได้" */
  const mtnMgr = { order: ORDER, fullName: 'ผจก.ช่าง', ...perms(['approve'], SEEDED_ALL) };
  assert.equal(canDoStep(7, mtnMgr).ok, false, 'ถือคีย์ฝั่งช่างอย่างเดียว ปิดใบแทนฝั่งผู้แจ้งไม่ได้');
  // ⚠️ deploy-safe: ยังไม่ seed close_cost → ถอยไป approve (ใบต้องไม่ค้างตอน deploy โค้ดก่อนรัน SQL)
  const beforeSeed = { order: ORDER, fullName: 'ผจก.', ...perms(['approve'], SEEDED_OLD) };
  assert.equal(canDoStep(7, beforeSeed).ok, true, 'ก่อน apply migration ต้องยังปิดใบได้');
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

/* ── ข้าม QA (ขั้น 5 → 6) เมื่องานไม่เกี่ยวกับคุณภาพ — 2026-09-03 ── */
const WAITING_QA = { ...ORDER, status: 'checked', quality_related: 'เกี่ยวกับคุณภาพ' };

test('isWaitingQa: ผ่านขั้น 4 = รอ QA เสมอ · ออกได้ทางเดียวคือ QA กด (qa_skipped_at) — 2026-09-14', () => {
  assert.equal(isWaitingQa(WAITING_QA), true);
  // 🔴 กฎใหม่: ค่า quality_related ที่ขั้น 4 ไม่มีผลต่อเส้นทางแล้ว (ผู้แจ้งข้ามเองไม่ได้)
  assert.equal(isWaitingQa({ ...WAITING_QA, quality_related: 'ไม่เกี่ยวกับคุณภาพ' }), true);
  assert.equal(isWaitingQa({ ...WAITING_QA, quality_related: null }), true);
  // ออกจากคิว QA ได้ทางเดียว = QA กดว่าไม่เกี่ยว (มีร่องรอย qa_skipped_at)
  assert.equal(isWaitingQa({ ...WAITING_QA, qa_skipped_at: '2026-09-14T02:00:00Z' }), false);
  assert.equal(isWaitingQa({ ...WAITING_QA, status: 'qa' }), false);       // QA ตรวจแล้ว
  assert.equal(isWaitingQa({ ...WAITING_QA, status: 'repaired' }), false); // ยังไม่ถึงขั้น 4
  assert.equal(isWaitingQa(null), false);
});

test('🔴 canSkipQa: ผู้เปิดใบ/ฝ่ายที่แจ้ง ข้าม QA เองไม่ได้แล้ว — 2026-09-14 (คำสั่ง user)', () => {
  // เดิมคืน step4:reporter ⇒ ฝ่ายที่ถูกตรวจเปิดด่านของตัวเองได้ · ตอนนี้เป็นสิทธิ์ QA ฝั่งเดียว
  const r = canSkipQa({ order: WAITING_QA, fullName: 'สมชาย ใจดี', ...perms([]) });
  assert.equal(r.ok, false); assert.equal(r.code, 'qa_only');
  // ถือสิทธิ์ขั้น 4 (accept_work) ก็ยังข้ามไม่ได้
  assert.equal(canSkipQa({ order: WAITING_QA, fullName: 'คนอื่น', ...perms(['accept_work']) }).ok, false);
});

test('canSkipQa: QA เองข้ามได้ (งานไม่ใช่ของ QA ไม่ต้องเซ็นรับรองสิ่งที่ไม่ได้ตรวจ)', () => {
  const r = canSkipQa({ order: WAITING_QA, fullName: 'คนอื่น', ...perms(['qa']) });
  assert.equal(r.ok, true); assert.equal(r.code, 'step5:perm');
});

test('canSkipQa: ช่างที่ซ่อม (service) ข้ามไม่ได้ — เหตุผลเดียวกับที่ช่างตรวจรับงานตัวเองไม่ได้', () => {
  assert.equal(canSkipQa({ order: WAITING_QA, fullName: 'ช่าง', inOrderTeam: true, ...perms(['service', 'service_own_team']) }).ok, false);
});

test('canSkipQa: ใบที่ไม่ได้ค้างรอ QA ข้ามไม่ได้ ต่อให้เป็น manage_master', () => {
  // QA ตัดสินไปแล้ว (มีร่องรอย) = ไม่ได้อยู่ในคิว QA อีก
  assert.equal(canSkipQa({ order: { ...WAITING_QA, qa_skipped_at: '2026-09-14T02:00:00Z' }, fullName: 'สมชาย ใจดี', ...perms(['manage_master']) }).code, 'not_waiting_qa');
  assert.equal(canSkipQa({ order: { ...WAITING_QA, status: 'qa' }, fullName: 'สมชาย ใจดี', ...perms(['manage_master']) }).code, 'not_waiting_qa');
});

test('isQaSkipped: ดูจาก qa_skipped_at อย่างเดียว (ใบเก่าที่ไม่มีคอลัมน์ = ไม่เคยข้าม)', () => {
  assert.equal(isQaSkipped({ qa_skipped_at: '2026-09-03T01:00:00Z' }), true);
  assert.equal(isQaSkipped({}), false);
  assert.equal(isQaSkipped(undefined), false);
});

/* ── 🔒 ขั้น 4/6/7 ผูกกับ "ฝ่ายที่แจ้ง" (scope) — 2026-09-07 ── */
import { orderInReporterScope } from '../mtnStepPerm.js';

const LINES = ['HYDROFORM', 'HDF1', 'HDF2', 'LASER-345', 'LINE APRON ASSY', 'Line 60', 'Line 61', 'GOR', 'Assy GOR'];
const PD3 = { scopeLineNames: ['HYDROFORM', 'HDF1', 'HDF2', 'LASER-345', 'LINE APRON ASSY', 'Line 60', 'Line 61'], knownLineNames: LINES, sections: ['PD3'] };

test('orderInReporterScope: ใบไลน์ในส่วนงานตัวเอง = true · ไลน์ส่วนงานอื่น = false', () => {
  assert.equal(orderInReporterScope({ line_name: 'Line 60' }, PD3), true);
  assert.equal(orderInReporterScope({ line_name: 'GOR' }, PD3), false);
  assert.equal(orderInReporterScope({ line_name: ' line 60 ' }, PD3), true, 'ต้องทนช่องว่าง/ตัวพิมพ์');
});

test('orderInReporterScope: ตัดสินไม่ได้ = null (ไม่จำกัด scope / ไม่ระบุไลน์ / ไลน์ไม่อยู่ในทะเบียนและไม่มี dept_section)', () => {
  assert.equal(orderInReporterScope({ line_name: 'GOR' }, { scopeLineNames: null, knownLineNames: LINES, sections: [] }), null, 'admin/ไม่มี sections = ทั้งโรงงาน');
  assert.equal(orderInReporterScope({ line_name: '' }, PD3), null, 'ใบไม่ระบุไลน์');
  assert.equal(orderInReporterScope({ line_name: 'LINE A ( 800 Ton )' }, PD3), null, 'ชื่อกลุ่มเครื่องปั๊มที่ไม่มีในทะเบียนไลน์ + ไม่มี dept_section');
});

test('orderInReporterScope: ไลน์ไม่รู้จักแต่ใบระบุ dept_section → เทียบ section ตรงๆ', () => {
  assert.equal(orderInReporterScope({ line_name: 'LINE A ( 800 Ton )', dept_section: 'PD1' }, PD3), false);
  assert.equal(orderInReporterScope({ line_name: 'LINE A ( 800 Ton )', dept_section: 'pd3' }, PD3), true);
  // ไลน์รู้จักต้องชนะ dept_section ที่พิมพ์มือ (ช่อง PD แก้ได้ในฟอร์ม)
  assert.equal(orderInReporterScope({ line_name: 'GOR', dept_section: 'PD3' }, PD3), false);
});

test('ขั้น 4/6/7: ถือคีย์แต่ใบเป็นของฝ่ายอื่น = out_of_scope · ใบในฝ่ายตัวเอง = perm', () => {
  for (const [step, key] of [[4, 'accept_work'], [6, 'handover'], [7, 'close_cost']]) {
    const other = { order: ORDER, fullName: 'หัวหน้า PD3', inReporterScope: false, ...perms([key], SEEDED_ALL) };
    assert.deepEqual(canDoStep(step, other), { ok: false, code: 'out_of_scope' }, `ขั้น ${step} ต้องล็อกใบฝ่ายอื่น`);
    const own = { ...other, inReporterScope: true };
    assert.deepEqual(canDoStep(step, own), { ok: true, code: 'perm' });
    const unknown = { ...other, inReporterScope: null };
    assert.deepEqual(canDoStep(step, unknown), { ok: true, code: 'perm' }, 'ตัดสินไม่ได้ = ผ่านตามเดิม (ไม่รู้ ≠ ไม่ใช่)');
  }
});

test('scope ไม่ล็อกผู้เปิดใบ / manage_master / ขั้นของทีมช่าง (2-3-5)', () => {
  const opener = { order: ORDER, fullName: 'สมชาย ใจดี', inReporterScope: false, ...perms([], SEEDED_ALL) };
  assert.deepEqual(canDoStep(4, opener), { ok: true, code: 'reporter' });
  assert.deepEqual(canDoStep(6, opener), { ok: true, code: 'reporter' });
  const boss = { order: ORDER, fullName: 'ผจก.', inReporterScope: false, ...perms(['manage_master'], SEEDED_ALL) };
  assert.deepEqual(canDoStep(7, boss), { ok: true, code: 'manage_master' });
  const tech = { order: ORDER, fullName: 'ช่าง', inReporterScope: false, ...perms(['assign', 'service', 'qa'], SEEDED_ALL) };
  for (const s of [2, 3, 5]) assert.equal(canDoStep(s, tech).ok, true, `ขั้น ${s} ไม่ใช่ขั้นของฝ่ายที่แจ้ง ไม่ติด scope`);
});

test('fallback ก่อน apply migration ก็ยังเคารพ scope (ไม่เปิดช่องผ่านคีย์เดิม)', () => {
  const old = { order: ORDER, fullName: 'หัวหน้า', inReporterScope: false, ...perms(['service', 'report'], SEEDED_OLD) };
  assert.deepEqual(canDoStep(4, old), { ok: false, code: 'out_of_scope' });
  assert.deepEqual(canDoStep(6, old), { ok: false, code: 'out_of_scope' });
});

test('stepDenyHint แบบ out_of_scope บอกว่าใบเป็นของไลน์/ส่วนงานไหน และไม่พาไปขอ role เพิ่ม', () => {
  const h = stepDenyHint(4, { reporterName: 'สมชาย ใจดี', outOfScope: true, orderLine: 'GOR', orderSection: 'PD4' });
  assert.ok(h.some(l => l.includes('GOR') && l.includes('PD4')));
  assert.ok(h.some(l => l.includes('/add-user')));
  assert.ok(!h.some(l => l.includes('mtn_repair:accept_work')), 'ไม่ใช่ปัญหา role ห้ามชี้ไป /permissions');
});

/* ── ↩️ ตีกลับใบ (Reject MO ขั้น 2) — 2026-09-08 feedback หน้างาน "Reject MO มันไม่ตีกลับ" ── */
import { canBounceBack } from '../mtnStepPerm.js';

test('canBounceBack: ใบที่ยังไม่เดินเลยขั้น 2 ตีกลับได้ (รวมใบที่รับงานไปแล้ว = เคสที่บั๊กเดิมไม่ตีกลับ)', () => {
  assert.equal(canBounceBack({ status: 'pending', current_step: 1 }), true);
  assert.equal(canBounceBack({ status: 'assigned', current_step: 2 }), true, 'รับงานแล้วแต่ยังไม่ซ่อม ต้องตีกลับได้');
  assert.equal(canBounceBack({ status: 'repairing', current_step: 2 }), true);
  assert.equal(canBounceBack({ status: 'returned', current_step: 1 }), true);
  assert.equal(canBounceBack({}), true, 'ใบที่ยังไม่มี current_step = ถือว่าอยู่ขั้น 1');
});

test('canBounceBack: ซ่อมไปแล้ว/ปิดแล้ว ตีกลับไม่ได้ — ผลงานขั้น 3+ ต้องไม่หายจากใบ', () => {
  assert.equal(canBounceBack({ status: 'repaired', current_step: 3 }), false);
  assert.equal(canBounceBack({ status: 'checked', current_step: 4 }), false);
  assert.equal(canBounceBack({ status: 'handover', current_step: 6 }), false);
  assert.equal(canBounceBack({ status: 'closed', current_step: 7 }), false);
  // ปิด/ยกเลิกแล้วห้ามตีกลับ แม้ current_step จะยังไม่เดิน (ใบถูกจบไปแล้ว)
  assert.equal(canBounceBack({ status: 'closed', current_step: 2 }), false);
  assert.equal(canBounceBack({ status: 'rejected', current_step: 1 }), false);
});

/* ── 🏷️ ป้ายสถานะ + สถานะขั้น 5 — 2026-09-09 (ใบค้างรอรับมอบ 140 ใบ เพราะป้ายเดียวใช้ 2 ความหมาย) ── */
import {
  MO_LABEL_WAIT_APPROVAL, MO_LABEL_WAIT_HANDOVER, MO_LABEL_WAIT_QA, MO_STATUS_LABEL, QA_NOT_RELATED, QA_RELATED,
  moQaState, moStatusLabel,
} from '../mtnStepPerm.js';

test('moStatusLabel: checked + QA กดว่าไม่เกี่ยวแล้ว = รอรับมอบ (ขั้น 6) — ห้ามเขียนว่ารอ QA', () => {
  const o = { status: 'checked', current_step: 4, qa_skipped_at: '2026-09-14T02:00:00Z' };
  assert.equal(moStatusLabel(o), MO_LABEL_WAIT_HANDOVER);
  assert.ok(moStatusLabel(o).includes('รับมอบ') && !moStatusLabel(o).includes('คุณภาพ'));
});

test('🔴 moStatusLabel: checked ที่ QA ยังไม่ตัดสิน = รอตรวจคุณภาพ (ขั้น 5) ไม่ว่า quality_related เป็นอะไร', () => {
  // 2026-09-14: ป้ายต้องไม่เชื่อค่าที่ผู้แจ้งเคยเลือกเองที่ขั้น 4 อีกต่อไป
  assert.equal(moStatusLabel({ status: 'checked', current_step: 4, qa_skipped_at: null, quality_related: QA_RELATED }), MO_LABEL_WAIT_QA);
  assert.equal(moStatusLabel({ status: 'checked', current_step: 4, qa_skipped_at: null, quality_related: QA_NOT_RELATED }), MO_LABEL_WAIT_QA);
  assert.equal(moStatusLabel({ status: 'checked', current_step: 4, qa_skipped_at: null, quality_related: null }), MO_LABEL_WAIT_QA);
});

test('moStatusLabel: qa = รอรับมอบ · สถานะอื่นใช้ป้ายเดิม · status ที่ไม่รู้จักโชว์ค่าดิบ (ไม่กลบเงียบ)', () => {
  assert.equal(moStatusLabel({ status: 'qa', current_step: 5 }), MO_STATUS_LABEL.qa);
  assert.ok(MO_STATUS_LABEL.qa.includes('รับมอบ'));
  assert.equal(moStatusLabel({ status: 'pending' }), MO_STATUS_LABEL.pending);
  assert.equal(moStatusLabel({ status: 'handover', current_step: 6 }), MO_STATUS_LABEL.handover);
  assert.equal(moStatusLabel({ status: 'weird_new_status' }), 'weird_new_status');
});

test('moStatusLabel: แถวที่ไม่ได้ select qa_skipped_at มา = ห้ามเดา ให้ใช้ป้ายรวมของ checked', () => {
  // เคสจริง: บอร์ด Andon / ผังแม่พิมพ์ query เฉพาะบางคอลัมน์ → qa_skipped_at เป็น undefined
  assert.equal(moStatusLabel({ status: 'checked', current_step: 4 }), MO_STATUS_LABEL.checked);
  assert.ok(MO_STATUS_LABEL.checked.includes('คุณภาพ') && MO_STATUS_LABEL.checked.includes('รับมอบ'));
});

test('moQaState: ใบที่ข้าม QA ต้องรายงานว่า "skipped" ไม่ใช่ "done" — แม้ current_step จะเลย 5 ไปแล้ว', () => {
  // กดปุ่ม ⏭ ข้าม QA (มี qa_skipped_at)
  assert.equal(moQaState({ status: 'checked', current_step: 4, quality_related: QA_NOT_RELATED, qa_skipped_at: '2026-09-09T02:00:00Z' }), 'skipped');
  /* 2026-09-14: ใบ `checked` ที่ยังไม่มีร่องรอยของ QA = **รอ QA** ไม่ใช่ skipped อีกต่อไป
     (ใบเก่าที่ตัดสินด้วยกฎเดิมถูก stamp qa_skipped_at ให้แล้วใน migration 20260914) */
  assert.equal(moQaState({ status: 'checked', current_step: 4, quality_related: QA_NOT_RELATED }), 'waiting');
  // 🔴 หัวใจของบั๊กเดิม: รับมอบ/ปิดใบไปแล้ว current_step = 6-7 แต่ QA ไม่เคยตรวจ → ต้องไม่ใช่ 'done'
  assert.equal(moQaState({ status: 'handover', current_step: 6, quality_related: QA_NOT_RELATED }), 'waiting');
  assert.equal(moQaState({ status: 'closed', current_step: 7, quality_related: QA_NOT_RELATED, qa_skipped_at: '2026-09-01T00:00:00Z' }), 'skipped');
});

test('moQaState: ตรวจจริง = done · ยังรอ QA = waiting · ยังไม่ถึงขั้น 4 = none', () => {
  assert.equal(moQaState({ status: 'qa', current_step: 5, quality_related: QA_RELATED, qa_at: '2026-09-08T05:00:00Z' }), 'done');
  assert.equal(moQaState({ status: 'closed', current_step: 7, quality_related: QA_RELATED, qa_result: 'ผ่านคุณภาพ' }), 'done', 'ใบเก่าที่ไม่มี qa_at แต่มีผลคุณภาพ = ตรวจแล้ว');
  assert.equal(moQaState({ status: 'checked', current_step: 4, quality_related: QA_RELATED }), 'waiting');
  assert.equal(moQaState({ status: 'repaired', current_step: 3 }), 'none');
  assert.equal(moQaState({ status: 'pending', current_step: 1 }), 'none');
});

/* ── ➡️ ส่งต่องานข้ามทีมช่าง — 2026-09-14 (คำสั่ง user: ช่างฝ่ายผลิตดูแล้วเกินมือ ส่งต่อได้ ไม่ต้องเปิดใบใหม่) ── */
import { canHandoff, isMoOpen, MO_DONE_STATUSES } from '../mtnStepPerm.js';

test('🔴 isMoOpen: `transferred` ต้องนับว่า "จบแล้ว" เท่ากับ closed/rejected — 2026-09-14', () => {
  /* ใบที่ส่งต่อไปทีมอื่นแล้วมี "ใบใหม่" รับช่วงต่อ ⇒ ถ้ายังนับว่าเปิดอยู่ 1 ปัญหาจะโผล่เป็น 2 ใบค้าง
     ทั้งใน /mtn-repair · dept dashboard · สรุปเช้า — เคยเขียนลิสต์ `['closed','rejected']` ซ้ำ 4 จุด */
  assert.equal(isMoOpen({ status: 'transferred' }), false);
  assert.equal(isMoOpen({ status: 'closed' }), false);
  assert.equal(isMoOpen({ status: 'rejected' }), false);
  assert.equal(isMoOpen({ status: 'repaired' }), true);
  assert.equal(isMoOpen({ status: 'returned' }), true);   // ตีกลับ = ยังไม่จบ รอผู้แจ้งส่งใหม่
  assert.ok(MO_DONE_STATUSES.includes('transferred'));
});

test('canHandoff: ส่งต่อได้ช่วงรับงานถึงซ่อมเสร็จ (ขั้น 2-3) เท่านั้น', () => {
  assert.equal(canHandoff({ status: 'assigned', current_step: 2 }), true);
  assert.equal(canHandoff({ status: 'repaired',  current_step: 3 }), true);
  // ขั้น 1 = ยังไม่มีทีมไหนรับ ให้ผู้แจ้งแก้แผนกเองพอ (ไม่ต้องมีประวัติส่งต่อ)
  assert.equal(canHandoff({ status: 'pending',   current_step: 1 }), false);
  // เลยขั้น 4 = ฝ่ายที่แจ้งตรวจรับงานรอบนั้นไปแล้ว ปัญหาใหม่ให้เปิดใบใหม่/ใช้ผลติดตามขั้น 6
  assert.equal(canHandoff({ status: 'checked',   current_step: 4 }), false);
  assert.equal(canHandoff({ status: 'qa',        current_step: 5 }), false);
});

test('canHandoff: ใบที่จบแล้ว/ถูกตีกลับ ส่งต่อไม่ได้ (ไม่มีทีมไหนถืออยู่)', () => {
  assert.equal(canHandoff({ status: 'closed',   current_step: 7 }), false);
  assert.equal(canHandoff({ status: 'rejected', current_step: 2 }), false);
  // ส่งต่อไปแล้ว = ใบนี้จบ งานอยู่ที่ใบใหม่ — กดส่งต่อซ้ำไม่ได้ (กันสร้างใบลูกซ้อน)
  assert.equal(canHandoff({ status: 'transferred', current_step: 3 }), false);
  // returned = ใบอยู่ที่ผู้แจ้งแล้ว ให้ใช้ "แก้แผนก & ส่งใหม่" (resubmit) ไม่ใช่ส่งต่อ
  assert.equal(canHandoff({ status: 'returned', current_step: 1 }), false);
  assert.equal(canHandoff({}), false);
});

/* ═══ ใบของทีม MTN เดินขั้นต่างจาก JIG/DIE (2026-09-15 · คำสั่ง user) ═══════════════ */

test('ด่านอนุมัติ: งานปรับปรุง/สร้างที่ยังไม่เซ็น ช่างกดรับงาน (ขั้น 2-3) ไม่ได้', () => {
  const head = { order: ORDER, fullName: 'หัวหน้าช่าง', ...perms(['assign', 'service']), approvalBlocked: true };
  assert.deepEqual(canDoStep(2, head), { ok: false, code: 'await_mgr_approval' });
  assert.deepEqual(canDoStep(3, head), { ok: false, code: 'await_mgr_approval' });
  // ขั้นอื่นไม่เกี่ยว — ด่านนี้กันแค่ "เริ่มงาน"
  assert.equal(canDoStep(4, { ...head, fullName: 'สมชาย ใจดี' }).ok, true);
});

test('ด่านอนุมัติ: งานซ่อม/บริการ (approvalBlocked=false) ต้องเริ่มงานได้ทันที — ไลน์ห้ามหยุดรออนุมัติ', () => {
  const head = { order: ORDER, fullName: 'หัวหน้าช่าง', ...perms(['assign', 'service']) };
  assert.deepEqual(canDoStep(2, head), { ok: true, code: 'perm' });
  assert.deepEqual(canDoStep(3, head), { ok: true, code: 'perm' });
});

/* 🔴 เปลี่ยนกฎ 2026-10-20 (QC audit §7.2 · คำสั่ง user "ปิดทั้ง 2 ทาง")
   เดิม manage_master ข้ามด่านอนุมัติได้ ⇒ ด่านนี้เป็นของปลอมสำหรับช่างทุกคน
   เพราะคีย์นั้นถูกแจกให้ role `mtn` ทั้งก้อน 16 บัญชี (ไม่ใช่แค่หัวหน้า)
   ⇒ ตอนนี้ด่านอนุมัติอยู่ **เหนือ** manage_master แล้ว — ทางออกคือให้ ผจก. เซ็น ไม่ใช่กดข้าม */
test('🔒 ด่านอนุมัติ: แม้ถือ manage_master ก็เริ่มงานปรับปรุง/สร้างก่อน ผจก.เซ็น ไม่ได้', () => {
  const boss = { order: ORDER, fullName: 'ผจก.', ...perms(['manage_master']), approvalBlocked: true };
  assert.deepEqual(canDoStep(2, boss), { ok: false, code: 'await_mgr_approval' });
  assert.deepEqual(canDoStep(3, boss), { ok: false, code: 'await_mgr_approval' });
  // เซ็นแล้ว (approvalBlocked=false) = เดินงานได้ตามปกติ
  assert.deepEqual(canDoStep(2, { ...boss, approvalBlocked: false }), { ok: true, code: 'manage_master' });
});

/* ═══ 🔴 ลำดับลายเซ็น 7 จุดของใบ MTN (คำสั่ง user 2026-09-22 — เคยสลับผิดมา 2 รอบ) ═══════
     1 ผู้แจ้ง → 2 ผจก.ผู้แจ้ง (รับทราบ) → 3 ช่างรับงาน → 4 ผจก.ช่าง (รับทราบ)
   → 5 หัวหน้าแผนกช่างตรวจงานหลังแก้ไข → 6 ผจก.ช่างอนุมัติ → 7 ผจก.ฝ่ายที่แจ้งอนุมัติ (ปิดใบ)
     ⇒ ขั้นในโปรแกรม 8 ขั้น (ลูปนี้ไม่มี QA) · ขั้น 6-7 ฝั่งช่าง · ขั้น 8 ฝั่งผู้แจ้ง = ปิดใบ */
test('🔴 ใบ MTN 8 ขั้น — ขั้น 6/7 ฝั่งช่าง (ไม่ติด scope ผู้แจ้ง) · ขั้น 8 ฝ่ายที่แจ้งปิดใบ (ติด scope)', () => {
  const mgr = { order: ORDER, fullName: 'ผจก.', ...perms(['approve', 'mtn_head', 'close_cost']), inReporterScope: false };
  // ขั้น 6-7 = ฝั่งช่าง มีเฉพาะฟอร์ม MTN — ผจก.ช่างที่ถูกตั้ง sections ต้องตรวจ/อนุมัติใบไลน์ไหนก็ได้
  assert.deepEqual(canDoStep(6, { ...mgr, mtnForm: true }), { ok: true, code: 'perm' });
  assert.deepEqual(canDoStep(7, { ...mgr, mtnForm: true }), { ok: true, code: 'perm' });
  // ขั้น 8 = ผจก.ฝ่ายที่แจ้ง ⇒ ติด scope ฝ่ายที่แจ้งเหมือนขั้นปิดใบของฟอร์มอื่น
  assert.deepEqual(canDoStep(8, { ...mgr, mtnForm: true }), { ok: false, code: 'out_of_scope' });
  assert.deepEqual(canDoStep(8, { ...mgr, mtnForm: true, inReporterScope: true }), { ok: true, code: 'perm' });
  assert.deepEqual(canDoStep(8, { ...mgr, mtnForm: false }), { ok: false, code: 'unknown_step' }, 'ฟอร์มอื่นไม่มีขั้น 8');
  // ฟอร์ม JIG/DIE: ขั้น 7 ยังเป็น "อนุมัติปิด" ของฝ่ายที่แจ้งเหมือนเดิม
  assert.deepEqual(canDoStep(7, { ...mgr, mtnForm: false }), { ok: false, code: 'out_of_scope' });
  // ขั้น 5 = รับมอบของใบ MTN (ไม่ใช่ QA) — ยังเป็นของฝ่ายที่แจ้ง
  assert.deepEqual(canDoStep(5, { ...mgr, ...perms(['handover']), mtnForm: true }), { ok: false, code: 'out_of_scope' });
});

test('ขั้น 6-7 (ฝั่งช่าง): คนที่ถูกตั้งเป็นช่างทีมอื่นทำไม่ได้ · ไม่ได้ตั้งทีมไว้ = ปล่อยผ่าน (ห้ามล็อกทั้งระบบ)', () => {
  const base = { order: ORDER, fullName: 'ผจก.', ...perms(['approve', 'mtn_head', 'close_cost']), mtnForm: true };
  for (const st of [6, 7]) {
    assert.deepEqual(canDoStep(st, { ...base, hasTeams: true, inOrderTeam: false }), { ok: false, code: 'other_team' }, `ขั้น ${st}`);
    assert.deepEqual(canDoStep(st, { ...base, hasTeams: true, inOrderTeam: true }), { ok: true, code: 'perm' }, `ขั้น ${st}`);
    assert.deepEqual(canDoStep(st, { ...base, hasTeams: false, inOrderTeam: false }), { ok: true, code: 'perm' }, 'ไม่ได้ตั้ง mtn_teams = ไม่รู้ ≠ ไม่ใช่');
  }
  // ขั้น 8 ไม่ใช่ขั้นฝั่งช่าง — teamSide ต้องไม่ไปรัดมัน
  assert.equal(canDoStep(8, { ...base, hasTeams: true, inOrderTeam: false, inReporterScope: true }).ok, true);
});

test('stepLabel/stepMeta/stageOf: ใบ MTN 8 ขั้น (ไม่มี QA) · ฟอร์มอื่นยัง 7 ขั้น (2026-09-22)', async () => {
  const { stageOf } = await import('../mtnStepPerm.js');
  assert.equal(stepMeta(5, { mtnForm: true }).whoShort, 'หัวหน้าแผนกผู้แจ้ง', 'ขั้น 5 ของใบ MTN = รับมอบ ไม่ใช่ QA');
  assert.equal(stepMeta(6, { mtnForm: true }).whoShort, 'หัวหน้าแผนกช่าง');
  assert.equal(stepMeta(7, { mtnForm: true }).whoShort, 'ผจก.ช่าง');
  assert.equal(stepMeta(8, { mtnForm: true }).whoShort, 'ผจก.ฝ่ายที่แจ้ง');
  assert.equal(stepMeta(8), null, 'ฟอร์ม JIG/DIE ไม่มีขั้น 8');
  assert.equal(stepMeta(9, { mtnForm: true }), null, 'ไม่มีขั้น 9 อีกแล้ว (เคยทำผิดไว้ 22/09)');
  assert.match(stepLabel(8, { mtnForm: true }), /ขั้น 8/);
  assert.equal(lastStep({ mtnForm: true }), 8);
  assert.equal(lastStep(), 7);
  for (const s of [2, 3, 4]) assert.equal(stepMeta(s, { mtnForm: true }), MTN_STEPS[s], `ขั้น ${s} ต้องเหมือนกันทั้ง 2 ฟอร์ม`);

  /* 🔴 หัวใจของบั๊กที่เคยเกิด 2 รอบ: เลขขั้นเดียวกันคนละความหมายระหว่าง 2 ฟอร์ม
     ⇒ ตัวบันทึก/ตัววาดฟอร์มต้องแตกสาขาด้วย stage เท่านั้น */
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(n => stageOf(n)),
    ['report', 'assign', 'service', 'accept_work', 'qa', 'handover', 'close']);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(n => stageOf(n, { mtnForm: true })),
    ['report', 'assign', 'service', 'accept_work', 'handover', 'mtn_head', 'mtn_approve', 'cost_mgr_close']);
  assert.equal(stageOf(9, { mtnForm: true }), null);
  assert.notEqual(stageOf(5), stageOf(5, { mtnForm: true }), 'ขั้น 5 ต้องคนละ stage — ห้ามผูกตัวบันทึกกับเลขขั้น');
  assert.notEqual(stageOf(7), stageOf(7, { mtnForm: true }), 'ขั้น 7 ต้องคนละ stage');
});

test('mtnCloseStage: แยก 3 ขั้นปิดใบที่ค้างอยู่ใน status handover ด้วยเวลาเซ็นจริง', async () => {
  const { mtnCloseStage, moStatusLabel, MO_LABEL_WAIT_COST_MGR, MO_LABEL_WAIT_MTN_HEAD, MO_LABEL_WAIT_MTN_APPROVE, MO_STATUS_LABEL: LBL }
    = await import('../mtnStepPerm.js');
  const base = { status: 'handover', current_step: 5, mtn_dept: 'maintenance' };
  assert.equal(mtnCloseStage({ mtn_head_at: null, approve_at: null }), 6);
  assert.equal(mtnCloseStage({ mtn_head_at: 'x',  approve_at: null }), 7);
  assert.equal(mtnCloseStage({ mtn_head_at: 'x',  approve_at: 'y'  }), 8);
  // แถวที่ไม่ได้ select เวลาเซ็นมา = ตัดสินไม่ได้ ห้ามเดา
  assert.equal(mtnCloseStage({ mtn_head_at: null }), null);
  assert.equal(mtnCloseStage({}), null);

  assert.equal(moStatusLabel({ ...base, mtn_head_at: null, approve_at: null }), MO_LABEL_WAIT_MTN_HEAD);
  assert.equal(moStatusLabel({ ...base, mtn_head_at: 'x',  approve_at: null }), MO_LABEL_WAIT_MTN_APPROVE);
  assert.equal(moStatusLabel({ ...base, mtn_head_at: 'x',  approve_at: 'y'  }), MO_LABEL_WAIT_COST_MGR);
  assert.equal(moStatusLabel(base), LBL.handover, 'ไม่รู้ = ป้ายรวมเดิม (พฤติกรรมเดิมของใบเก่า)');
  // ฟอร์ม JIG/DIE ที่ handover = รออนุมัติปิดขั้นเดียว — ห้ามไปขึ้นป้ายของสายช่าง MTN
  assert.equal(moStatusLabel({ status: 'handover', current_step: 6, mtn_dept: 'jig_maintenance', mtn_head_at: null, approve_at: null }), LBL.handover);
});

test('QA: งานปรับปรุง/สร้างไม่ต้องผ่าน QA · งานซ่อม/บริการและใบเก่ายังต้องผ่านเหมือนเดิม', () => {
  const checked = { status: 'checked', current_step: 4 };
  assert.equal(isWaitingQa({ ...checked, purpose: 'repair' }), true);
  assert.equal(isWaitingQa({ ...checked, purpose: 'service' }), true);
  assert.equal(isWaitingQa(checked), true, 'ใบเก่า/ทีมอื่นที่ไม่มี purpose = ต้องผ่าน QA ตามเดิม');
  assert.equal(isWaitingQa({ ...checked, purpose: 'improve' }), false);
  assert.equal(isWaitingQa({ ...checked, purpose: 'build' }), false);

  assert.equal(moQaState({ ...checked, purpose: 'improve' }), 'skipped', 'ต้องขึ้น ⏭ ไม่ใช่ ✅ (ไม่มีใครตรวจจริง)');
  assert.equal(moQaState({ status: 'repaired', current_step: 3, purpose: 'improve' }), 'none', 'ยังไม่ถึงขั้น 4');
  assert.equal(moQaState({ ...checked, purpose: 'improve', qa_at: '2026-09-15T02:00:00Z' }), 'done', 'QA ตรวจให้ก็ยังบันทึกว่าตรวจแล้ว');

  // ปุ่ม ⏭ ข้าม QA ต้องไม่โผล่ — ไม่มีอะไรให้ข้าม
  assert.deepEqual(canSkipQa({ order: { ...checked, purpose: 'build' }, fullName: 'QA', ...perms(['qa']) }),
    { ok: false, code: 'not_waiting_qa' });
});

/* 🔴 2026-10-20: ถอดทาง manage_master ออกจากช่องเซ็น ผจก. (ไม่มีการ "เซ็นแทน" · กฎ 04/10)
   เกิดจริง 1 ใบ: บัญชีกลาง `maintenance` (role mtn ไม่มี approve) เซ็นอนุมัติแทน ผจก. */
test('canSignMtnApproval: เฉพาะคนที่ใบระบุชื่อ / ผู้ถือ approve · manage_master เซ็นแทนไม่ได้ · เซ็นแล้วซ้ำไม่ได้', () => {
  const o = { purpose: 'improve', dept_manager_name: 'ผจก.สมศรี', plant_manager_name: 'ผจก.โรงงาน' };
  assert.deepEqual(canSignMtnApproval('dept', { order: o, fullName: 'ผจก.สมศรี', ...perms([]) }), { ok: true, code: 'named' });
  assert.deepEqual(canSignMtnApproval('dept', { order: o, fullName: 'คนอื่น', ...perms(['approve']) }), { ok: true, code: 'approve' });
  assert.deepEqual(canSignMtnApproval('dept', { order: o, fullName: 'คนอื่น', ...perms(['manage_master']) }), { ok: false, code: 'denied' });
  assert.deepEqual(canSignMtnApproval('dept', { order: o, fullName: 'ช่างเอก', ...perms(['service']) }), { ok: false, code: 'denied' });
  assert.deepEqual(canSignMtnApproval('dept', { order: { ...o, dept_manager_at: 'x' }, fullName: 'ผจก.สมศรี', ...perms(['approve']) }),
    { ok: false, code: 'already_signed' });
  assert.deepEqual(canSignMtnApproval('plant', { order: o, fullName: 'ผจก.โรงงาน', ...perms([]) }), { ok: true, code: 'named' });
  assert.equal(canSignMtnApproval('อื่นๆ', { order: o, ...perms(['manage_master']) }).ok, false);
});

test('stepDenyHint: ติดด่านอนุมัติ ต้องบอกว่ารอใครเซ็น ไม่ใช่บอกให้ไปขอ role', () => {
  const lines = stepDenyHint(2, { mtnForm: true, awaitApproval: { missing: ['dept', 'plant'], deptName: 'ผจก.สมศรี', plantName: 'ผจก.โรงงาน' } });
  assert.ok(lines.some(t => t.includes('ผจก.สมศรี')), 'ต้องบอกชื่อผู้จัดการต้นสังกัด');
  assert.ok(lines.some(t => t.includes('ผจก.โรงงาน')));
  assert.ok(!lines.some(t => t.includes('/permissions')), 'ห้ามชี้ไปที่เรื่องสิทธิ์ — เหตุคนละเรื่อง');
});

test('ป้ายสถานะ: ใบรออนุมัติต้องไม่ขึ้น "รอรับงาน" · แถวที่ไม่ได้ select คอลัมน์ลายเซ็นห้ามเดา', () => {
  /* 🔴 13/10: เกณฑ์ย้ายไป `isApprovalBlocked()` (mtnMoForm.js) ที่เดียว แล้ว**เพิ่มเงื่อนไข `isMtnFormRow`**
     — ด่านที่บล็อกช่างจริงอยู่ที่ `approvalBlocked` ใน MtnRepair ซึ่งคิดเฉพาะใบฟอร์ม MTN
     (`appr = mtnForm ? mtnApprovalState(o) : null`) ⇒ ใบทีมอื่นที่บังเอิญมี purpose ช่าง**กดรับได้**
     ป้าย "รอผู้จัดการอนุมัติ" บนใบนั้นจึงเป็นคำโกหก · วัดจริง 13/10: ใบที่มี purpose ทั้ง 14 ใบ
     เป็น mtn_dept='maintenance' ทั้งหมด ⇒ ไม่มีใบไหนเปลี่ยนป้ายจากการรัดเกณฑ์นี้ */
  const base = { status: 'pending', purpose: 'improve', mtn_dept: 'maintenance' };
  assert.equal(moStatusLabel({ ...base, dept_manager_at: null }), MO_LABEL_WAIT_APPROVAL);
  assert.equal(moStatusLabel({ ...base, dept_manager_at: '2026-09-15T02:00:00Z' }), MO_STATUS_LABEL.pending);
  assert.equal(moStatusLabel(base), MO_STATUS_LABEL.pending, 'ไม่ได้ select dept_manager_at = ใช้ป้ายเดิม');
  assert.equal(moStatusLabel({ ...base, purpose: 'repair', dept_manager_at: null }), MO_STATUS_LABEL.pending, 'งานซ่อมไม่เคยติดด่าน');
  assert.equal(moStatusLabel({ status: 'pending' }), MO_STATUS_LABEL.pending, 'ใบทีมอื่น/ใบเก่าเหมือนเดิม');
  assert.equal(moStatusLabel({ status: 'pending', purpose: 'improve', mtn_dept: 'jig', dept_manager_at: null }),
    MO_STATUS_LABEL.pending, 'ไม่ใช่ฟอร์ม MTN = ช่างกดรับได้จริง ⇒ ห้ามติดป้ายว่ารออนุมัติ');
});

test('ป้ายสถานะ: `handover` ของฟอร์มอื่นห้ามไปขึ้นป้ายขั้นปิดใบของสาย MTN', () => {
  // ไม่ได้ select เวลาเซ็นมา / ไม่ใช่ใบ MTN = ป้ายรวมเดิมเสมอ (ห้ามเดา)
  assert.equal(moStatusLabel({ status: 'handover', current_step: 6 }), MO_STATUS_LABEL.handover);
  assert.equal(moStatusLabel({ status: 'handover', current_step: 7 }), MO_STATUS_LABEL.handover);
  assert.equal(moStatusLabel({ status: 'closed', current_step: 7 }), MO_STATUS_LABEL.closed);
});

/* ── 🛡️ ตาราง "สี/ขั้น" ของสถานะ MO ต้องไม่หลุดจากลิสต์ป้าย — 2026-09-16 ──
   บั๊กที่เคยเกิด: `transferred` ถูกเพิ่มใน MO_STATUS_LABEL/MO_DONE_STATUSES (14/09) แต่ตารางสี
   (ตอนนั้นชื่อ STATUS_META อยู่ใน MtnRepair.jsx) ไม่ได้เพิ่มตาม ⇒
     · dropdown ฟิลเตอร์สถานะสร้างจากตารางสี → **ไม่มีตัวเลือก "ส่งต่อทีมอื่น"** หาใบไม่เจอ
       (user 2026-09-16: "เคสนี้ ไม่มีตัวกรองหาหรอ" — ต้องพิมพ์เลข MO ในช่องค้นหาถึงจะเจอ)
     · การ์ดใบที่ส่งต่อแล้วขึ้น **สีแดง ขั้น 1** เพราะ fallback เป็น pending
   ตอนนี้ MO_STATUS_META ปั้นจาก MO_STATUS_LABEL (คีย์ตรงกันอัตโนมัติ) — เทสนี้กันอีกชั้น
   ว่าคีย์ใหม่ต้อง "ตั้งสีจริง" ไม่ใช่ตกไปใช้ค่าถอย (เทาขั้น 0) โดยไม่มีใครรู้ */
import { MO_STATUS_META, moStatusMeta } from '../mtnStepPerm.js';

test('🔴 MO_STATUS_META: ทุกสถานะใน MO_STATUS_LABEL ต้องมีสี/ขั้นของตัวเอง', () => {
  const FALLBACK = '#8b8b96';
  for (const [k, label] of Object.entries(MO_STATUS_LABEL)) {
    const m = MO_STATUS_META[k];
    assert.ok(m, `สถานะ "${k}" ไม่มีใน MO_STATUS_META — เพิ่มใน MO_STATUS_STYLE (mtnStepPerm.js) ด้วย`);
    assert.equal(m.label, label, `ป้ายของ "${k}" ต้องมาจาก MO_STATUS_LABEL ที่เดียว`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(m.color), `สี "${k}" ต้องเป็น hex 6 หลัก (ได้ ${m.color})`);
    assert.ok(/^rgba\(\d+,\d+,\d+,0\.14\)$/.test(m.bg), `พื้นชิป "${k}" เพี้ยน (ได้ ${m.bg})`);
    assert.equal(typeof m.step, 'number');
    /* สถานะ "โมฆะ" ใช้เทากลางตัวเดียวกันโดยเจตนา — จบแล้วและไม่ใช่ผลงานซ่อม
       🔴 เพิ่มชื่อเข้าลิสต์นี้ได้เฉพาะเมื่อ "ตั้งใจให้เทา" จริงๆ ห้ามใส่เพื่อให้เทสผ่าน
          (ของที่ลืมตั้งสีจะได้เทาเหมือนกัน — ลิสต์นี้คือสิ่งเดียวที่แยก 2 กรณีออกจากกัน) */
    const VOID_GREY = ['rejected', 'cancelled'];
    if (!VOID_GREY.includes(k)) {
      assert.notEqual(m.color, FALLBACK,
        `สถานะ "${k}" ยังใช้สีถอย = ลืมตั้งใน MO_STATUS_STYLE ⇒ dropdown/การ์ดจะสื่อผิด`);
    }
  }
  // ไม่มีคีย์เกินมาจากไหน (ตารางสีตั้งเองไม่ได้ ต้องมาจากลิสต์ป้าย)
  assert.deepEqual(Object.keys(MO_STATUS_META), Object.keys(MO_STATUS_LABEL));
});

test('🔴 transferred ต้องอยู่ในตัวกรองสถานะ + ไม่ใช่สีของ pending', () => {
  assert.ok(MO_STATUS_META.transferred, 'ไม่มี transferred = dropdown ฟิลเตอร์ไม่มีตัวเลือกนี้');
  assert.notEqual(MO_STATUS_META.transferred.color, MO_STATUS_META.pending.color);
  assert.notEqual(MO_STATUS_META.transferred.color, MO_STATUS_META.closed.color);  // ไม่ใช่ผลงานซ่อม
  assert.equal(moStatusMeta({ status: 'transferred' }).label, MO_STATUS_LABEL.transferred);
  assert.equal(moStatusMeta({ status: 'transferred' }).color, MO_STATUS_META.transferred.color);
});

test('moStatusMeta: สถานะแปลกปลอม/ว่าง ถอยไป pending ได้ไม่พัง', () => {
  assert.equal(moStatusMeta({ status: 'ไม่รู้จัก' }).color, MO_STATUS_META.pending.color);
  assert.equal(moStatusMeta(null).color, MO_STATUS_META.pending.color);
  // ป้ายยังมาจาก moStatusLabel() เสมอ (ใบที่ติดด่านอนุมัติต้องไม่ขึ้น "รอรับงาน")
  const blocked = { status: 'pending', purpose: 'improve', mtn_dept: 'maintenance', dept_manager_at: null, current_step: 1 };
  assert.equal(moStatusMeta(blocked).label, MO_LABEL_WAIT_APPROVAL);
});

/* ── 🧑 ชื่อผู้แจ้งบนจอ — "ต่างกันต้องโชว์ทั้งคู่" (2026-10-13 · คำสั่ง user) ───────── */

test('orderReporterText: ตรงกัน = โชว์ชื่อเดียว · ต่างกัน = โชว์ทั้งคู่', () => {
  assert.deepEqual(orderReporterText({ reporter_prod: 'สมชาย ใจดี', reported_by_name: 'สมชาย ใจดี' }),
    { main: 'สมชาย ใจดี', extra: null });
  // ใบที่เปิดด้วยบัญชีกลาง — ชื่อในฟอร์มขึ้นก่อน ส่วนบัญชีที่เปิดใบต่อท้าย
  assert.deepEqual(orderReporterText({ reporter_prod: 'ธวัช พิมพ์วงศ์', reported_by_name: 'toolingmaintenance' }),
    { main: 'ธวัช พิมพ์วงศ์', extra: 'toolingmaintenance' });
});

test('orderReporterText: ช่องว่างซ้ำ/ตัวพิมพ์ ไม่ทำให้ชื่อเดียวกันถูกเขียน 2 ครั้ง', () => {
  // เจอจริงในฐาน: ชื่อพิมพ์เว้นวรรค 2 เคาะ
  assert.deepEqual(orderReporterText({ reporter_prod: 'ยุทธภูมิ  การัมย์', reported_by_name: 'ยุทธภูมิ การัมย์' }),
    { main: 'ยุทธภูมิ  การัมย์', extra: null });
  assert.deepEqual(orderReporterText({ reporter_prod: ' Somchai ', reported_by_name: 'somchai' }),
    { main: 'Somchai', extra: null });
});

test('orderReporterText: มีฟิลด์เดียว/ไม่มีเลย — ห้ามพ่น undefined ออกจอ', () => {
  assert.deepEqual(orderReporterText({ reported_by_name: 'สมชาย ใจดี' }), { main: 'สมชาย ใจดี', extra: null });
  assert.deepEqual(orderReporterText({ reporter_prod: 'สมหญิง' }), { main: 'สมหญิง', extra: null });
  assert.deepEqual(orderReporterText({ reporter_prod: '   ', reported_by_name: null }), { main: null, extra: null });
  assert.deepEqual(orderReporterText(null), { main: null, extra: null });
});

/* ── 🗑️→🚫 moRemoveMode — ลบได้เฉพาะใบที่ยังไม่มีเลข (2026-10-14 · คำสั่ง user) ────── */
import { moRemoveMode, OPEN_MO_STATUSES } from '../mtnStepPerm.js';
test('🔴 moRemoveMode: ใบที่ออกเลขแล้ว ลบไม่ได้ — ยกเลิกเท่านั้น', () => {
  // เคสจริงที่ทำให้ต้องมีกฎนี้: ใบสถานะ repaired ถูก delete ไป ⇒ ค่าแรง/อะไหล่หายถาวร
  const r = moRemoveMode({ status: 'repaired', mo_no: 'MTN.2026/10-5' });
  assert.equal(r.mode, 'cancel');
  assert.ok(r.why.includes('ยกเลิก'), 'ต้องมีเหตุผลให้จอเขียนบอก');
  for (const st of ['pending', 'assigned', 'repairing', 'checked', 'qa', 'handover', 'returned', 'waiting_vendor']) {
    assert.equal(moRemoveMode({ status: st, mo_no: 'JIG-BM-141026-0014-M8' }).mode, 'cancel', st);
  }
});

test('ใบที่ยังไม่ออกเลข = ลบทิ้งได้ (ไม่มีเลข/ประวัติให้เสีย)', () => {
  for (const mo of [null, undefined, '', '   ']) {
    assert.equal(moRemoveMode({ status: 'pending', mo_no: mo }).mode, 'delete');
  }
});

test('🔴 ใบที่ปิด/จบไปแล้ว ห้ามทั้งลบและยกเลิก — ใบที่ปิดแล้วคือบันทึก', () => {
  assert.equal(moRemoveMode({ status: 'closed', mo_no: 'PRO-BM-141026-0712-M169' }).mode, 'blocked');
  // ปิดแล้วต้องบล็อกแม้จะยังไม่มีเลข (ไม่งั้นใบปิดที่ออกเลขไม่ติดจะถูกลบทิ้งได้)
  assert.equal(moRemoveMode({ status: 'closed', mo_no: null }).mode, 'blocked');
  for (const st of ['rejected', 'transferred', 'cancelled']) {
    const r = moRemoveMode({ status: st, mo_no: 'X-1' });
    assert.equal(r.mode, 'blocked', st);
    assert.ok(r.why, 'ต้องบอกเหตุผล ห้ามเงียบ');
  }
});

test('cancelled เป็นสถานะจบ — ต้องหลุดจากคิวงานค้างเอง', () => {
  assert.ok(MO_DONE_STATUSES.includes('cancelled'));
  assert.equal(isMoOpen({ status: 'cancelled' }), false);
  assert.ok(!OPEN_MO_STATUSES.includes('cancelled'), 'ห้ามอยู่ใน allowlist ของคิวงาน');
});

import { qaRelatedView, nextStepOf, stageOf } from '../mtnStepPerm.js';

/* ═══ qaRelatedView — "ต้องให้ QA ตรวจ?" ห้ามอ่าน quality_related ดิบ ═══  2026-10-21
   เคสจริง O-MTN.2026/10-17: ใบทีม MTN (ไม่มี QA ในลูป) รอรับมอบอยู่ แต่ขั้น 4 เขียน "ต้องผ่าน QA" */
test('🔴 qaRelatedView: ใบทีม MTN = n_a เสมอ ไม่ว่าคอลัมน์จะ stamp อะไรไว้', () => {
  const mtn = { mtn_dept: 'maintenance', status: 'checked' };
  assert.equal(qaRelatedView({ ...mtn, quality_related: QA_RELATED }), 'n_a');
  assert.equal(qaRelatedView({ ...mtn, quality_related: QA_NOT_RELATED }), 'n_a');
  assert.equal(qaRelatedView({ ...mtn, quality_related: null }), 'n_a');
  assert.equal(qaRelatedView({ ...mtn, mtn_dept: 'mtn', quality_related: QA_RELATED }), 'n_a');
  // งานสร้าง/ปรับปรุงของฟอร์มอื่นก็ไม่มี QA ในลูปเหมือนกัน
  assert.equal(qaRelatedView({ mtn_dept: 'jig_maintenance', purpose: 'improve', quality_related: QA_RELATED }), 'n_a');
});

test('🔴 qaRelatedView: "ไม่เกี่ยวกับคุณภาพ" ต้องไม่ถูกนับเป็น "ใช่" (บั๊ก Excel 411/1050 ใบ)', () => {
  const jig = { mtn_dept: 'jig_maintenance', status: 'checked' };
  assert.equal(qaRelatedView({ ...jig, quality_related: QA_NOT_RELATED }), 'no');
  assert.equal(qaRelatedView({ ...jig, quality_related: QA_RELATED, qa_skipped_at: '2026-10-01' }), 'no');
  assert.equal(qaRelatedView({ ...jig, quality_related: QA_RELATED }), 'yes');
  // ยังไม่ถึงขั้น 4 = ไม่รู้ ห้ามเดาไปทางใดทางหนึ่ง
  assert.equal(qaRelatedView({ ...jig, status: 'repairing', quality_related: null }), 'unknown');
});

test('🔴 ใบทีม MTN ที่ status=checked ขั้นถัดไปคือ 5 (รับมอบ) ไม่ใช่ QA', () => {
  const o = { mtn_dept: 'maintenance', status: 'checked', quality_related: QA_RELATED };
  assert.equal(isWaitingQa(o), false);
  assert.equal(nextStepOf(o), 5);
  assert.equal(stageOf(nextStepOf(o), { mtnForm: true }), 'handover');
  assert.equal(stepMeta(5, { mtnForm: true }).title, 'รับมอบ / ติดตามผล');
});

/* ═══ 🔧 ขั้น 4 ของใบทีมเครื่องมือ (JIG/DIE) = หัวหน้าแผนกช่าง ไม่ใช่ผู้แจ้ง ═══  2026-10-27
   คำสั่ง user: *"สำหรับ MO ของ jig กับ DIE งานซ่อมนอกไลน์ step 4 ต้องเป็นหัวหน้าแผนกช่าง
   ก่อน QA ไม่ใช่ผู้แจ้ง"* · ระดับที่เซ็นได้ = หัวหน้าแผนก + วิศวกร (rank ≥ 30)
   🔴 ทีม PRODUCTION ต้องไม่เปลี่ยน — ซ่อมในไลน์ ผู้แจ้งเห็นเครื่องกลับมาเดิน จึงตรวจรับเองถูกแล้ว */
import { moWaitMeta as waitMetaTool } from '../mtnStepPerm.js';
import { isToolTeamRow } from '../mtnMoForm.js';

const TOOL_BASE = { can: () => false, seeded: () => true, hasTeams: true };
const jigOrder  = { mtn_dept: 'jig_maintenance', status: 'repaired', reported_by_name: 'สมชาย' };
const dieOrder  = { mtn_dept: 'die_maintenance', status: 'repaired', reported_by_name: 'สมชาย' };
const prodOrder = { mtn_dept: 'production', status: 'repaired', reported_by_name: 'สมชาย' };

test('🔧 isToolTeamRow — JIG/DIE ใช่ · PRODUCTION/MTN ไม่ใช่ · ไม่รู้ = ไม่ใช่ (ถอยไปพฤติกรรมเดิม)', () => {
  assert.equal(isToolTeamRow(jigOrder), true);
  assert.equal(isToolTeamRow(dieOrder), true);
  assert.equal(isToolTeamRow(prodOrder), false);
  assert.equal(isToolTeamRow({ mtn_dept: 'maintenance' }), false);
  assert.equal(isToolTeamRow({}), false, 'ไม่รู้ทีม = ไม่ย้ายช่องเซ็นเงียบๆ');
  assert.equal(isToolTeamRow({ item_type: 'JIG เชื่อม' }), true, 'ไม่ระบุทีม → เดาจากชนิดอุปกรณ์');
});

test('🔧 ขั้น 4 ใบ JIG/DIE = ฝั่งช่าง · ล็อกทีม · rank ≥ 30 — ใบ PRODUCTION คงเดิม', () => {
  const tool = stepMeta(4, { toolTeam: true });
  assert.equal(tool.side, 'mtn');
  assert.equal(tool.byReporter, false, 'ผู้แจ้งไม่ใช่เจ้าของช่องนี้แล้ว');
  assert.equal(tool.teamSide, true, 'ต้องล็อกทีมใครทีมมันเหมือนขั้น 2/3');
  assert.equal(tool.minRank, 30, 'หัวหน้าแผนก(50) + วิศวกร(30) — ทีม Die ยังไม่มี dept_head');
  assert.equal(tool.stage, 'accept_work', 'stage ห้ามเปลี่ยน (ตัวกรอง ?wait= / คิวงาน อ้างค่านี้)');
  assert.equal(tool.key, 'accept_work', 'คีย์สิทธิ์เดิม — ไม่ต้อง seed ใหม่');

  const prod = stepMeta(4, {});
  assert.equal(prod.side, 'reporter');
  assert.equal(prod.byReporter, true);
  assert.equal(prod.minRank, undefined);
});

test('🔧 ฟอร์ม MTN ชนะ toolTeam เสมอ (ทีม MTN ไม่ใช่ทีมเครื่องมือ)', () => {
  assert.equal(stepMeta(4, { mtnForm: true, toolTeam: true }).stage,
    stepMeta(4, { mtnForm: true }).stage);
});

test('🔧 ผู้แจ้งเซ็นขั้น 4 ของใบ JIG ไม่ได้แล้ว · ใบ PRODUCTION ยังได้', () => {
  const asReporter = (order) => canDoStep(4, { ...TOOL_BASE, order, fullName: 'สมชาย', actorSide: 'reporter', posRank: 40 });
  assert.equal(asReporter(jigOrder).ok, false);
  assert.equal(asReporter(jigOrder).code, 'wrong_side');
  assert.equal(asReporter(dieOrder).ok, false);
  assert.equal(asReporter(prodOrder).ok, true, '🔴 ทีมผลิตห้ามเปลี่ยน — ผู้แจ้งยังตรวจรับเอง');
});

test('🔧 ใบ JIG: ช่าง(20) ไม่ผ่าน · วิศวกร(30) ในทีมผ่าน · วิศวกรทีมอื่นไม่ผ่าน', () => {
  const inTeam = (posRank) => canDoStep(4, { ...TOOL_BASE, order: jigOrder, fullName: 'ช่าง',
    actorSide: 'mtn', posRank, inOrderTeam: true, can: k => k === 'service_own_team' });
  assert.equal(inTeam(20).code, 'rank_too_low');
  assert.equal(inTeam(30).ok, true);
  assert.equal(inTeam(50).ok, true);
  const otherTeam = canDoStep(4, { ...TOOL_BASE, order: jigOrder, fullName: 'ช่าง',
    actorSide: 'mtn', posRank: 50, inOrderTeam: false, can: k => k === 'service_own_team' });
  assert.equal(otherTeam.code, 'other_team', 'ล็อกทีมใครทีมมันต้องยังกัด');
});

test('🔧 ไม่รู้ตำแหน่ง (posRank null) = ไม่บล็อก แต่จอต้องเขียนว่าไม่ได้ตรวจ', () => {
  const r = canDoStep(4, { ...TOOL_BASE, order: jigOrder, fullName: 'บัญชีกลาง',
    actorSide: 'mtn', posRank: null, inOrderTeam: true, can: k => k === 'service_own_team' });
  assert.equal(r.ok, true, 'ไม่รู้ ≠ ปฏิเสธ (บัญชีกลางทีมช่างยังเซ็นได้)');
});

test('🔧 คิวงาน: ใบ JIG ที่ซ่อมเสร็จ รอ "หัวหน้าแผนกช่าง" ไม่ใช่ผู้เปิดใบ', () => {
  const w = waitMetaTool(jigOrder);
  assert.equal(w.step, 4);
  assert.equal(w.stage, 'accept_work');
  assert.match(w.meta.who, /หัวหน้าแผนกช่าง/);
  assert.equal(w.meta.side, 'mtn');
  assert.match(waitMetaTool(prodOrder).meta.who, /ผู้เปิดใบ/);
});

test('🔧 ป้ายปุ่ม/เหตุผลตอนกดไม่ได้ ต้องพูดถึงฝั่งช่าง', () => {
  assert.match(stepLabel(4, { toolTeam: true }), /หัวหน้าแผนกช่าง/);
  assert.match(stepLabel(4, {}), /ผู้เปิดใบ/);
  const hint = stepDenyHint(4, { toolTeam: true, wrongSide: true }).join(' ');
  assert.match(hint, /หัวหน้าแผนกช่าง/);
  assert.match(hint, /ฝั่งซ่อมบำรุง/, 'ต้องบอกว่าเป็นช่องของฝั่งช่าง ไม่ใช่ของฝ่ายที่แจ้ง');
});
