/**
 * ล็อกกฎ "ใบ A3 ห้ามพูดเกินจริง" + การแปลงกรอบ PDCA ↔ DMAIC
 *
 * ทำไมต้องมีเทส: บั๊กที่เคยเกิดจริงบนการ์ด (2026-08-26) คือระบบสรุปผล **ของงานที่ยังไม่ได้ลงมือ**
 * แล้วดันเข้า Cost Saving ระดับบริษัท — พอย้ายเรื่องเดียวกันลงกระดาษที่เอาเข้าห้องประชุม
 * ความเสียหายมากกว่าเดิม (ใบพิมพ์ไม่มี tooltip ให้อธิบายทีหลัง)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_AFTER_DAYS, resultMode, resultPct, moneyHeadline, modeNote,
  a3Sections, milestonePhaseLabel, normFramework, a3Data, planProgress, overdueMilestones,
} from '../improvementA3.js';

const R = (o = {}) => ({ unit: 'นาที', beforeDays: 20, afterDays: 20, beforeTotal: 400, afterTotal: 100, beforePerDay: 20, afterPerDay: 5, ...o });

test('ยังไม่ยืนยันเริ่มลงมือแก้ = ใบมีได้แค่ baseline (ห้ามสรุปผล)', () => {
  assert.equal(resultMode(R(), false), 'baseline');
  // ต่อให้ข้อมูลหลังแก้เยอะแค่ไหน ถ้ายังไม่ยืนยันลงมือ ก็ยังเป็น baseline
  assert.equal(resultMode(R({ afterDays: 90 }), false), 'baseline');
});

test('ลงมือแล้วแต่หลังแก้ยังไม่ถึงเกณฑ์วันผลิต = waiting (ยังสรุป % / เงินไม่ได้)', () => {
  assert.equal(resultMode(R({ afterDays: MIN_AFTER_DAYS - 1 }), true), 'waiting');
  assert.equal(resultMode(R({ afterDays: MIN_AFTER_DAYS }), true), 'confirmed');
  // เคสที่เคยหลอกตา: หลังแก้ 1 วัน 0 นาที = ▼100% ต้องไม่ถูกนับว่า confirmed
  assert.equal(resultMode(R({ afterDays: 1, afterPerDay: 0, afterTotal: 0 }), true), 'waiting');
});

test('ไม่มีข้อมูลในช่วงเทียบ = nodata ทุกกรณี (ห้ามตีเป็น 0)', () => {
  assert.equal(resultMode(undefined, true), 'nodata');
  assert.equal(resultMode({ noData: true }, true), 'nodata');
  assert.match(modeNote('nodata'), /ไม่มีข้อมูล|ยังไม่มีกะ/);
});

test('ทุกโหมดที่ยังสรุปไม่ได้ ต้องมีข้อความกำกับเสมอ (ห้ามเงียบ)', () => {
  for (const m of ['nodata', 'baseline', 'waiting']) {
    assert.ok(modeNote(m, R({ afterDays: 2 })).length > 10, `mode ${m} ต้องมีข้อความอธิบาย`);
  }
  assert.equal(modeNote('confirmed', R()), '');
});

test('บล็อกเงิน: ยังไม่ confirmed = "มูลค่าปัญหาก่อนแก้" เท่านั้น ห้ามมีคำว่าประหยัด', () => {
  for (const m of ['nodata', 'baseline', 'waiting']) {
    const h = moneyHeadline(m, 1234);
    assert.equal(h.potential, true, `mode ${m} ต้องเป็นโหมดเพดาน (potential)`);
    assert.doesNotMatch(h.label, /ประหยัดได้/);
  }
  assert.equal(moneyHeadline('confirmed', 1234).label, 'ประหยัดได้');
  assert.equal(moneyHeadline('confirmed', -50).label, 'ต้นทุนเพิ่มขึ้น');
  assert.equal(moneyHeadline('confirmed', 0).tone, 'muted');
  assert.equal(moneyHeadline('confirmed', null).potential, false);
});

test('% คำนวณได้เฉพาะเมื่อมีฐานเทียบ — ไม่มี = null ไม่ใช่ 0', () => {
  assert.equal(resultPct(R()), 75);
  assert.equal(resultPct(R({ beforePerDay: 0 })), null);
  assert.equal(resultPct({ noData: true }), null);
  assert.equal(resultPct(undefined), null);
  assert.equal(resultPct(R({ afterPerDay: 30 })), -50);   // แย่ลง = ติดลบ
});

test('ใบ 2 กรอบ = ช่องเดียวกัน 8 ช่อง เปลี่ยนแค่ป้ายขั้น', () => {
  const p = a3Sections('pdca'), d = a3Sections('dmaic');
  assert.equal(p.length, 8);
  assert.deepEqual(p.map(s => s.key), d.map(s => s.key));
  assert.deepEqual(p.map(s => s.no), d.map(s => s.no));
  assert.deepEqual(p.map(s => s.phase), ['plan', 'plan', 'plan', 'plan', 'do', 'do', 'check', 'act']);
  assert.deepEqual(d.map(s => s.phase), ['define', 'measure', 'define', 'analyze', 'improve', 'improve', 'control', 'control']);
  p.forEach(s => assert.ok(s.meta?.s && s.meta?.color, `ช่อง ${s.key} ต้องมีป้ายขั้น`));
});

test('กรอบที่ไม่รู้จัก/ว่าง = pdca (กรอบเดียวกับที่แผนงานเก็บจริง)', () => {
  assert.equal(normFramework(undefined), 'pdca');
  assert.equal(normFramework('six-sigma'), 'pdca');
  assert.equal(normFramework('dmaic'), 'dmaic');
});

test('milestone เก็บ phase เป็น PDCA — โหมด DMAIC แสดงเทียบ และห้ามเดาขั้นที่ไม่ได้ระบุ', () => {
  assert.equal(milestonePhaseLabel('plan', 'pdca').s, 'P');
  assert.equal(milestonePhaseLabel('plan', 'dmaic').s, 'DMA');     // Plan ครอบ D-M-A ยุบเป็นตัวเดียวไม่ได้
  assert.equal(milestonePhaseLabel('do', 'dmaic').label, 'Improve');
  assert.match(milestonePhaseLabel('check', 'dmaic').label, /Control/);
  assert.match(milestonePhaseLabel('act', 'dmaic').label, /Control/);
  for (const fw of ['pdca', 'dmaic']) assert.equal(milestonePhaseLabel(null, fw).s, '–');
});

test('a3Data ทนกับแถวที่ยังไม่มีคอลัมน์ a3 (ยังไม่ apply migration)', () => {
  const d = a3Data({ title: 'x' });
  assert.equal(d.framework, 'pdca');
  assert.equal(d.background, '');
  assert.equal(a3Data({ a3: { framework: 'dmaic', root_cause: 'ทำไม…' } }).root_cause, 'ทำไม…');
  assert.equal(a3Data({ a3: null }).framework, 'pdca');
  assert.equal(a3Data(null).framework, 'pdca');
});

test('สรุปแผนงาน: ไม่มีขั้นเลย = null ไม่ใช่ 0% · เลยแผนตัดด้วยวันที่ที่ฉีดเข้ามา', () => {
  assert.deepEqual(planProgress([]), { total: 0, done: 0, pct: null });
  const ms = [{ status: 'done' }, { status: 'doing' }, { status: 'todo' }, { status: 'done' }];
  assert.deepEqual(planProgress(ms), { total: 4, done: 2, pct: 50 });
  const late = overdueMilestones(
    [{ status: 'todo', planned_end: '2026-01-01' }, { status: 'done', planned_end: '2026-01-01' }, { status: 'todo', planned_end: '2099-01-01' }],
    '2026-06-01');
  assert.equal(late.length, 1);
});
