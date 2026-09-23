import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rollupEva, evaCounts, countsLabel, daysSince, freshness, freshLabel,
  projectEva, customerEva, gradeByTarget, panelsNeedingAttention, overdueActions,
} from '../nmBoard.js';

const NOW = new Date('2026-09-20T10:00:00');   // ตรึงเวลา — กันเทสระเบิดเวลา (CLAUDE.md)

test('rollupEva — แย่สุดชนะ', () => {
  assert.equal(rollupEva(['G', 'Y', 'R']), 'R');
  assert.equal(rollupEva(['G', 'Y']), 'Y');
  assert.equal(rollupEva(['G', 'G']), 'G');
});

test('rollupEva — ไม่มีใครถูกประเมินเลย ต้องเป็น none ห้ามเดาว่าเขียว', () => {
  assert.equal(rollupEva([]), 'none');
  assert.equal(rollupEva(['none', 'none']), 'none');
  assert.equal(rollupEva(null), 'none');
});

test('rollupEva — "ยังไม่ถึงด่าน" ปนกับของที่ผ่านแล้ว ต้องไม่ลากให้แย่ลง', () => {
  // บล็อก 1A ว่างทั้งบล็อกบนบอร์ดจริง = ยังไม่ถึง ไม่ใช่ NG
  assert.equal(rollupEva(['G', 'none', 'none']), 'G');
});

test('rollupEva — รับ object ที่มี .eva ได้', () => {
  assert.equal(rollupEva([{ eva: 'G' }, { eva: 'R' }]), 'R');
});

test('evaCounts / countsLabel', () => {
  const c = evaCounts([{ eva: 'R' }, { eva: 'R' }, { eva: 'G' }, { eva: 'none' }]);
  assert.deepEqual(c, { G: 1, Y: 0, R: 2, none: 1, total: 4 });
  assert.equal(countsLabel(c), '🔴 2 · 🟢 1 · ⚪ 1');
});

test('daysSince / freshness — ตรึงเวลาไว้', () => {
  assert.equal(daysSince('2026-09-20', NOW), 0);
  assert.equal(daysSince('2026-09-13', NOW), 7);
  assert.equal(daysSince(null, NOW), null);
  assert.equal(freshness('2026-09-19', NOW), 'fresh');
  assert.equal(freshness('2026-09-01', NOW), 'warn');   // 19 วัน
  assert.equal(freshness('2026-08-01', NOW), 'bad');    // 50 วัน
  assert.equal(freshness(null, NOW), 'unknown');
  assert.equal(freshLabel('2026-09-20', NOW), 'อัปเดตวันนี้');
  assert.equal(freshLabel(null, NOW), 'ไม่เคยอัปเดต');
});

test('projectEva / customerEva — ลูกค้าที่ไม่มีโปรเจค ต้องเป็น none', () => {
  const p = { eva: { result: 'R', process: 'Y', milestone: 'Y' } };
  assert.equal(projectEva(p), 'R');
  assert.equal(customerEva([]), 'none');
  assert.equal(customerEva([p]), 'R');
});

test('gradeByTarget — ตัดเกรดจากค่าจริงเทียบเกณฑ์', () => {
  assert.equal(gradeByTarget(95, 90), 'G');
  assert.equal(gradeByTarget(88, 90), 'Y');          // 97.8% ของเป้า = เฉียด
  assert.equal(gradeByTarget(70, 90), 'R');
  assert.equal(gradeByTarget(null, 90), 'none');
  assert.equal(gradeByTarget(8, 10, { higherIsBetter: false }), 'G');   // ยิ่งน้อยยิ่งดี
});

test('panelsNeedingAttention — แดง หรือ ข้อมูลค้างจนเชื่อไม่ได้', () => {
  const panels = [
    { key: 'a', eva: 'G', updated_at: '2026-09-19' },
    { key: 'b', eva: 'R', updated_at: '2026-09-19' },
    { key: 'c', eva: 'G', updated_at: '2026-07-01' },   // ค้าง 81 วัน
  ];
  const out = panelsNeedingAttention(panels, NOW).map(p => p.key);
  assert.deepEqual(out.sort(), ['b', 'c']);
});

test('overdueActions — ดึงเฉพาะงานที่เลยกำหนดและยังไม่ปิด', () => {
  const projects = [{
    id: 'x', panels: [{ key: 'kadai', kind: 'issues', rows: [
      { no: 1, issue: 'ช้า', due: '2026-09-10', status: 'doing' },
      { no: 2, issue: 'ปิดแล้ว', due: '2026-09-01', status: 'done' },
      { no: 3, issue: 'ยังไม่ถึง', due: '2026-10-01', status: 'open' },
    ] }],
  }];
  const out = overdueActions(projects, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].no, 1);
  assert.equal(out[0].late, 10);
});
