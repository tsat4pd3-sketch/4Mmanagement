/* 🛠️ TPM — เกรดเครื่อง · สถานะ F-Tag · ด่าน Why-Why (src/utils/tpm.js) · 2026-11-27 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { critThresholds, critGrade, gradeForMachineNo, ftagState, ftagActions, ftagAgeDays,
  whyWhyMissing, closeGate, WHY_MIN } from '../tpm.js';

const F = [
  { key: 'safety', weight: 1, force_a: true },
  { key: 'quality', weight: 1 },
  { key: 'delivery', weight: 1 },
  { key: 'cost', weight: 1 },
  { key: 'frequency', weight: 1 },
  { key: 'old', weight: 5, is_active: false },   // เลิกใช้ ต้องไม่นับ
];
const TH = critThresholds([{ key: 'crit_a_min_pct', value: 70 }, { key: 'crit_b_min_pct', value: '45' }]);

test('critThresholds — ครบ/ไม่ครบ/กลับด้าน', () => {
  assert.deepEqual(TH, { aMinPct: 70, bMinPct: 45 });
  assert.equal(critThresholds([{ key: 'crit_a_min_pct', value: 70 }]), null);
  assert.equal(critThresholds([{ key: 'crit_a_min_pct', value: 40 }, { key: 'crit_b_min_pct', value: 60 }]), null);
});

test('critGrade — ตัดเกรดตาม % ของคะแนนเต็ม (ข้อที่เลิกใช้ไม่นับ)', () => {
  const all = (v) => Object.fromEntries(F.filter(f => f.is_active !== false).map(f => [f.key, v]));
  assert.equal(critGrade({ ...all(3), safety: 2 }, F, TH).grade, 'A');          // 14/15 = 93%
  const b = critGrade({ safety: 1, quality: 3, delivery: 2, cost: 2, frequency: 1 }, F, TH);   // 9/15 = 60%
  assert.equal(b.grade, 'B'); assert.equal(b.pct, 60);
  assert.equal(critGrade(all(1), F, TH).grade, 'C');                            // 33%
});

test('critGrade — ความปลอดภัย 3 = A ทันที แม้คะแนนรวมต่ำ', () => {
  const r = critGrade({ safety: 3, quality: 1, delivery: 1, cost: 1, frequency: 1 }, F, TH);
  assert.equal(r.grade, 'A'); assert.equal(r.reason, 'forced'); assert.equal(r.forcedBy, 'safety');
});

test('critGrade — ข้อมูลไม่ครบ = ไม่มีเกรด ห้ามเดา', () => {
  assert.equal(critGrade({ safety: 2 }, F, TH).grade, null);
  assert.equal(critGrade({ safety: 2 }, F, TH).reason, 'incomplete');
  assert.equal(critGrade({ safety: 2, quality: 9, delivery: 1, cost: 1, frequency: 1 }, F, TH).reason, 'incomplete');
  assert.equal(critGrade(null, F, TH).reason, 'not_assessed');
  assert.equal(critGrade({ safety: 1 }, [], TH).reason, 'no_factors');
  const noTh = critGrade({ safety: 1, quality: 1, delivery: 1, cost: 1, frequency: 1 }, F, null);
  assert.equal(noTh.grade, null); assert.equal(noTh.reason, 'no_thresholds');
});

test('gradeForMachineNo — จับคู่ด้วย resolveEquip (SW-10 = SW10)', () => {
  const machines = [{ id: 'm1', machine_no: 'SW10' }];
  const critRows = [{ machine_id: 'm1', scores: { safety: 3, quality: 1, delivery: 1, cost: 1, frequency: 1 } }];
  assert.equal(gradeForMachineNo('sw-10', { machines, critRows, factors: F, th: TH }).res.grade, 'A');
  assert.equal(gradeForMachineNo('XX', { machines, critRows, factors: F, th: TH }).res, null);
});

test('ftagState — สถานะแท็กแดงอ่านจากใบ MO', () => {
  assert.equal(ftagState({ status: 'open' }), 'open');
  assert.equal(ftagState({ status: 'mo' }, undefined), 'mo_unknown');
  assert.equal(ftagState({ status: 'mo' }, { status: 'assigned' }), 'in_repair');
  assert.equal(ftagState({ status: 'mo' }, { status: 'closed' }), 'closed_by_mo');
  assert.equal(ftagState({ status: 'mo' }, { status: 'cancelled' }), 'mo_dropped');
  assert.equal(ftagState({ status: 'closed' }), 'closed');
  assert.equal(ftagState({ status: 'cancelled' }), 'cancelled');
});

test('ftagActions — แดงปิดเองไม่ได้ · ขาวเปิด MO ไม่ได้', () => {
  assert.deepEqual(ftagActions({ color: 'red' }, 'open'), { toMo: true, close: false, cancel: true, recolor: true });
  assert.deepEqual(ftagActions({ color: 'white' }, 'open'), { toMo: false, close: true, cancel: true, recolor: true });
  assert.equal(ftagActions({ color: 'red' }, 'in_repair').close, false);
  assert.equal(ftagActions({ color: 'red' }, 'mo_dropped').toMo, true);
  assert.equal(ftagActions({ color: 'red' }, 'closed_by_mo').cancel, false);
});

test('ftagAgeDays — นับถึงวันปิด หรือ nowMs ที่ส่งเข้ามา', () => {
  const now = Date.parse('2026-11-27T10:00:00+07:00');
  assert.equal(ftagAgeDays({ found_at: '2026-11-20T09:00:00+07:00' }, now), 7);
  assert.equal(ftagAgeDays({ found_at: '2026-11-20T09:00:00+07:00', closed_at: '2026-11-22T09:00:00+07:00' }, now), 2);
  assert.equal(ftagAgeDays({ found_at: null }, now), null);
});

test('whyWhyMissing / closeGate — บังคับเฉพาะเกรด A · ไม่รู้เกรด = ไม่บังคับแต่บอกเหตุผล', () => {
  const full = { failure_mode: 'ลูกปืนสึก', why_why: ['สั่น', 'ลูกปืนหลวม', 'จาระบีไม่พอ'], prevent_action: 'pm_plan', prevent_note: 'เพิ่มจุดอัดจาระบีทุกสัปดาห์' };
  assert.deepEqual(whyWhyMissing(full), []);
  assert.equal(whyWhyMissing({ ...full, why_why: ['สั่น', '', ' '] }).length, 1);
  assert.ok(whyWhyMissing({ ...full, prevent_action: 'none', prevent_note: 'ok' })[0].includes('เหตุผล'));
  assert.equal(WHY_MIN, 3);
  assert.equal(closeGate({ gradeRes: { grade: 'A' }, mo: {} }).ok, false);
  assert.equal(closeGate({ gradeRes: { grade: 'A' }, mo: full }).ok, true);
  assert.equal(closeGate({ gradeRes: { grade: 'B' }, mo: {} }).required, false);
  assert.equal(closeGate({ gradeRes: null, mo: {} }).required, false);
  assert.equal(closeGate({ critLoadFailed: true }).required, false);
  assert.ok(closeGate({ gradeRes: null }).why.length > 0);
});
