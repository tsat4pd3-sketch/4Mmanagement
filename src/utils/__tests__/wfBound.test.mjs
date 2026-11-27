import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { wfPeriodRange, roundKey, validateBinding, roundState, BOUND_SUBJECTS, signoffRows } from '../wfBound.js';
import { lpaPeriodRange } from '../lpaPlanStatus.js';

test('wfPeriodRange — ตรงกับ wf_period_range() ฝั่ง DB (ผลจำลองบนฐานจริง 25/11)', () => {
  assert.deepEqual(wfPeriodRange('week', '2026-11-25'), ['2026-11-22', '2026-11-30']);
  assert.deepEqual(wfPeriodRange('week', '2026-02-23'), ['2026-02-22', '2026-02-28']);
  assert.deepEqual(wfPeriodRange('week', '2026-11-20'), ['2026-11-15', '2026-11-21']);
  assert.deepEqual(wfPeriodRange('day', '2026-11-24'), ['2026-11-24', '2026-11-24']);
  assert.deepEqual(wfPeriodRange('quarter', '2026-11-24'), ['2026-10-01', '2026-12-31']);
  assert.equal(wfPeriodRange('x', '2026-11-24'), null);
});

test('บล็อกสัปดาห์ตรงกับ LPA (ใบโรงงานชุดเดียวกัน)', () => {
  for (const d of ['2026-11-01', '2026-11-08', '2026-11-21', '2026-11-30', '2026-02-28'])
    assert.deepEqual(wfPeriodRange('week', d), lpaPeriodRange('supervisor', d));
});

test('roundKey = รูปแบบเดียวกับ subject_key ฝั่ง DB', () => {
  assert.equal(roundKey(' Line 60 ', '2026-11-24', 'day'), 'Line 60|2026-11-24|day');
  assert.equal(roundKey('Line 60', '2026-11-22', null), 'Line 60|2026-11-22|');
});

test('validateBinding — ใบรอบห้ามกฎผู้เปิดใบ · ต้องเลือกเอกสาร+ความถี่', () => {
  assert.deepEqual(validateBinding(null), []);
  assert.equal(validateBinding({ subject: 'pokayoke', period: 'week' }, [{ assignee: { rule: 'perm_in_line' } }]).length, 0);
  assert.equal(validateBinding({ subject: 'x', period: 'y' }).length, 2);
  assert.equal(validateBinding({ subject: 'pokayoke', period: 'day' }, [{ assignee: { rule: 'creator_head' } }]).length, 1);
});

test('roundState — ไม่มีใบ ≠ ยังไม่เซ็น', () => {
  assert.equal(roundState({ instance: { status: 'approved' } }), 'signed');
  assert.equal(roundState({ instance: { status: 'in_progress' } }), 'waiting');
  assert.equal(roundState({ instance: { status: 'in_progress', blocked_reason: 'x' } }), 'blocked');
  assert.equal(roundState({ ensureStatus: 'period_open' }), 'period_open');
  assert.equal(roundState({ hasData: false }), 'no_data');
  assert.equal(roundState({}), 'unknown');
});

test('BOUND_SUBJECTS ตรงกับ wf_bound_subjects() ตัวล่าสุดใน migration', () => {
  const dir = join(process.cwd(), 'supabase/migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .filter(f => readFileSync(join(dir, f), 'utf8').includes('create or replace function public.wf_bound_subjects()'));
  const sql = readFileSync(join(dir, files[files.length - 1]), 'utf8');
  const body = sql.slice(sql.indexOf('create or replace function public.wf_bound_subjects()'));
  for (const s of BOUND_SUBJECTS) {
    const rx = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const q = (v) => (v == null ? 'null' : `"${rx(v)}"`);
    const re = new RegExp(`"${s.subject}":\\s*\\{"label": ${q(s.label)}, "record_perm": ${q(s.recordPerm)}, "link": ${q(s.link)}, "doc_key": ${q(s.docKey)}\\}`);
    assert.ok(re.test(body), `migration ${files[files.length - 1]} ต้องลงทะเบียน ${s.subject} ให้ตรงกับจอ`);
  }
});

test('signoffRows — ช่องเซ็นตามขั้น · ยังไม่เซ็น = ว่าง · เอาลายเซ็นล่าสุดของขั้น', () => {
  const flow = { steps: [{ label: 'ผู้ตรวจ', sig_label: 'ออกโดย' }, { label: 'Supervisor ตรวจสอบ' }, { label: 'Manager', sig_label: 'อนุมัติโดย' }] };
  const rows = signoffRows(flow, [
    { action: 'submit', step_index: null, actor_name: 'ระบบ' },
    { action: 'approve', step_index: 0, actor_name: 'A', acted_at: '2026-11-01T01:00:00Z', actor_id: 'u1' },
    { action: 'approve', step_index: 1, actor_name: 'B', acted_at: '2026-11-02T01:00:00Z' },
    { action: 'reject', step_index: 2, actor_name: 'C', acted_at: '2026-11-03T01:00:00Z' },
  ]);
  assert.deepEqual(rows.map(r => r.label), ['ออกโดย', 'Supervisor ตรวจสอบ', 'อนุมัติโดย']);
  assert.deepEqual(rows.map(r => r.name), ['A', 'B', null]);
  assert.equal(rows[0].actorId, 'u1');
  assert.deepEqual(signoffRows(null), []);
});
