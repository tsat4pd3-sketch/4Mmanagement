import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelMetric, metricSuffix, metricWarn } from '../nmPanelMetric.js';

const NOW = new Date('2026-09-20T10:00:00');   // ตรึงเวลา — กันเทสระเบิดเวลา (CLAUDE.md)

test('activity — นับขั้นที่ผ่าน จาก eva รายแถว', () => {
  const m = panelMetric({ kind: 'activity', rows: [
    { eva: 'G' }, { eva: 'G' }, { eva: 'R' }, { eva: 'Y' },
  ] }, NOW);
  assert.equal(m.kind, 'progress');
  assert.equal(m.value, 2);
  assert.equal(m.total, 4);
  assert.equal(m.pct, 50);
  assert.equal(m.eva, 'R');             // มีแถวแดง = แย่ที่สุดชนะ
});

test('🔴 activity — แถวที่ยังไม่ประเมิน ห้ามนับเป็น "ผ่าน" และต้องบอกว่าเหลือกี่แถว', () => {
  const m = panelMetric({ kind: 'activity', rows: [{ eva: 'G' }, { eva: 'none' }, {}] }, NOW);
  assert.equal(m.value, 1);
  assert.equal(m.total, 1, 'ตัวหารต้องเป็น "แถวที่ประเมินแล้ว" ไม่ใช่แถวทั้งหมด');
  assert.equal(m.unrated, 2);
  assert.match(metricWarn(m), /ยังไม่ประเมินอีก 2/);
});

test('🔴 activity — ไม่มีแถวไหนถูกประเมินเลย = null ห้ามคืน 0%', () => {
  assert.equal(panelMetric({ kind: 'activity', rows: [{}, { eva: 'none' }] }, NOW), null);
  assert.equal(panelMetric({ kind: 'activity', rows: [] }, NOW), null);
});

test('matrix — นับเฉพาะช่องที่ถึงด่านแล้ว (eva none = ยังไม่ถึง)', () => {
  const m = panelMetric({
    kind: 'matrix', milestones: ['CV', '1A'],
    rows: [
      { cells: { CV: { eva: 'G' }, '1A': { eva: 'none' } } },
      { cells: { CV: { eva: 'G' }, '1A': { eva: 'none' } } },
    ],
  }, NOW);
  assert.equal(m.value, 2);
  assert.equal(m.total, 2);
  assert.equal(m.pct, 100);
  assert.equal(m.unrated, 2);
  assert.equal(m.source, '2 พาร์ท × 2 ด่าน');
});

test('matrix — ยังไม่ถึงด่านเลยสักช่อง = null (ไม่ใช่ 0%)', () => {
  assert.equal(panelMetric({ kind: 'matrix', rows: [{ cells: { CV: { eva: 'none' } } }] }, NOW), null);
});

test('issues — นับเรื่องเปิด + เลยกำหนด เทียบกับเวลาที่ส่งเข้ามา', () => {
  const m = panelMetric({ kind: 'issues', rows: [
    { status: 'doing', due: '2026-09-03' },      // เลยแล้ว
    { status: 'open', due: '2026-09-30' },       // ยังไม่เลย
    { status: 'done', due: '2026-01-01' },       // ปิดแล้ว ไม่นับ
  ] }, NOW);
  assert.equal(m.value, 2);
  assert.equal(m.total, 3);
  assert.equal(m.overdue, 1);
  assert.equal(m.eva, 'R');
  assert.match(metricWarn(m), /เลยกำหนดแล้ว 1/);
});

test('issues — ไม่มีกำหนดส่ง ห้ามนับเป็นเลยกำหนด', () => {
  const m = panelMetric({ kind: 'issues', rows: [{ status: 'open' }, { status: 'open', due: '' }] }, NOW);
  assert.equal(m.overdue, 0);
  assert.equal(m.eva, 'Y');
  assert.equal(metricWarn(m), null);
});

test('issues — ปิดครบทุกเรื่อง = เขียว', () => {
  const m = panelMetric({ kind: 'issues', rows: [{ status: 'done' }, { status: 'closed' }] }, NOW);
  assert.equal(m.value, 0);
  assert.equal(m.eva, 'G');
});

test('⏱️ issues — เลื่อนนาฬิกาไป 400 วัน เรื่องเดิมต้องกลายเป็นเลยกำหนด (เทสไม่ตรึง = ระเบิด)', () => {
  const panel = { kind: 'issues', rows: [{ status: 'open', due: '2026-09-30' }] };
  assert.equal(panelMetric(panel, NOW).overdue, 0);
  assert.equal(panelMetric(panel, new Date('2027-10-25T10:00:00')).overdue, 1);
});

test('🔴 สีต้องเป็นคีย์ EVA ไม่ใช่ hex (กันเหลือง 2 เฉดในจอเดียว · ด่าน status-palette-single-source)', () => {
  const m = panelMetric({ kind: 'activity', rows: [{ eva: 'G' }] }, NOW);
  assert.ok(['R', 'Y', 'G', 'none'].includes(m.eva), `ได้ ${m.eva}`);
});

test('🔴 doc — ใบเอกสารเป็น "จำนวนรายการ" ห้ามแปลงเป็น %', () => {
  const m = panelMetric({ kind: 'doc', fields: [1, 2, 3, 4, 5, 6, 7] }, NOW);
  assert.equal(m.kind, 'count');
  assert.equal(m.value, 7);
  assert.equal(m.pct, null);
  assert.equal(m.total, null);
  assert.equal(metricSuffix(m), '');
});

test('doc — ผังพาร์ท/ผังโหนด ใช้ป้ายของตัวเอง', () => {
  assert.equal(panelMetric({ kind: 'doc', tree: [1, 2, 3] }, NOW).label, 'บรรทัดในผังพาร์ท');
  assert.equal(panelMetric({ kind: 'network', tiers: [1, 2] }, NOW).label, 'ชั้นผู้ส่งมอบ');
});

test('🔴 ใบที่ไม่มีข้อมูลเลย = null (จอต้องไม่วาดช่องตัวเลข ห้ามวาด 0)', () => {
  assert.equal(panelMetric({ kind: 'doc' }, NOW), null);
  assert.equal(panelMetric({ kind: 'doc', fields: [] }, NOW), null);
  assert.equal(panelMetric(null, NOW), null);
  assert.equal(panelMetric(undefined, NOW), null);
});

test('metricSuffix / metricWarn — ไม่มีตัวเลข ต้องไม่ระเบิด', () => {
  assert.equal(metricSuffix(null), '');
  assert.equal(metricWarn(null), null);
});

test('บอร์ดจริง 737D MLM — ต้องมีตัวเลขโชว์ได้ทุกแผง (21/21)', async () => {
  const { PROJECTS } = await import('../../data/nmBoard737D.js');
  const p = PROJECTS.find(x => x.id === '737d-mlm');
  const got = p.panels.filter(pn => panelMetric(pn, NOW));
  assert.equal(got.length, p.panels.length, `มีแผงที่ยังไม่มีตัวเลข ${p.panels.length - got.length} ใบ`);
});
