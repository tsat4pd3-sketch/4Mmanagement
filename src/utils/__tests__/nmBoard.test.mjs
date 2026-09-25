import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rollupEva, evaCounts, countsLabel, daysSince, freshness, freshLabel,
  projectEva, customerEva, gradeByTarget, panelsNeedingAttention, overdueActions, tvGrid,
  bucketOf, flattenPop, mainEva, bucketCounts, leavesInBucket, redWithoutNote,
  suggestEva, evaMismatch,
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

test('tvGrid — ทุกแผงต้องลงจอเดียว ไม่มีช่องหาย', () => {
  for (const n of [1, 5, 12, 21, 27, 40]) {
    const { cols, rows } = tvGrid(n);
    assert.ok(cols * rows >= n, `n=${n} ได้ ${cols}x${rows} ไม่พอ`);
    assert.ok(cols >= 1 && rows >= 1);
    assert.ok((cols - 1) * rows < n, `n=${n} มีคอลัมน์เกินจำเป็น`);
  }
});

test('tvGrid — บอร์ดจริง 21 และ 27 แผงได้ผังที่อ่านได้บนจอ 16:9', () => {
  const a = tvGrid(21), b = tvGrid(27);
  assert.ok(a.cols >= 5 && a.cols <= 8, `21 แผงได้ ${a.cols} คอลัมน์`);
  assert.ok(b.cols >= 5 && b.cols <= 9, `27 แผงได้ ${b.cols} คอลัมน์`);
});

test('tvGrid — ค่าพังไม่ทำให้หารศูนย์', () => {
  assert.deepEqual(tvGrid(0), { cols: 1, rows: 1 });
  assert.deepEqual(tvGrid(null), { cols: 1, rows: 1 });
});


/* ── work flow ที่ IEC ส่งมา (Obeya_E_Board-V2.pptx · 2026-09-24) ─────────────────── */

const POP = [
  { no: '1', key: 'kickoff', label: 'Kick off', eva: 'G' },
  { no: '3', key: 'tooling', label: 'Tooling', subs: [
    { no: '3.1', key: 'die', label: 'Stamping die', eva: 'G' },
    { no: '3.2', key: 'jig', label: 'Assembly jig', eva: 'R' },       // 1 ตัวแดง
    { no: '3.3', key: 'cf',  label: 'Checking fixture', eva: 'none' },
  ] },
  { no: '8', key: 'pq', label: 'Part Quality', eva: 'R', note: 'Shuken ตก' },
];

test('mainEva — หัวข้อใหญ่แดงทันทีเมื่อมี sub KPI แดง 1 ตัว (กฎที่ IEC เขียนกำกับ)', () => {
  assert.equal(mainEva(POP[1]), 'R');
  assert.equal(mainEva(POP[0]), 'G');            // ไม่มีลูก = ใช้ค่าตัวเอง
  assert.equal(mainEva({ subs: [{ eva: 'none' }, { eva: 'none' }] }), 'none');  // ห้ามเดาเขียว
});

test('flattenPop — นับเฉพาะ "ใบ" หัวข้อที่มีลูกไม่นับซ้ำ', () => {
  const leaves = flattenPop(POP);
  assert.equal(leaves.length, 5);                 // 1 + 3 ลูก + 8
  assert.ok(!leaves.some(l => l.path === 'tooling'));
  assert.equal(leaves.find(l => l.path === 'tooling.jig').mainLabel, 'Tooling');
});

test('bucketOf — none ไม่เข้าถังไหน (ยังไม่ถึงด่าน ≠ ไม่ผ่าน)', () => {
  assert.equal(bucketOf('R'), 'delay');
  assert.equal(bucketOf('Y'), 'onplan');
  assert.equal(bucketOf('G'), 'done');
  assert.equal(bucketOf('none'), null);
  assert.equal(bucketOf(undefined), null);
});

test('bucketCounts + leavesInBucket — ทางลัด "กดถังแดงแล้วไปที่ปัญหาเลย"', () => {
  const leaves = flattenPop(POP);
  assert.deepEqual(bucketCounts(leaves), { delay: 2, onplan: 0, done: 2, none: 1, total: 5 });
  assert.deepEqual(leavesInBucket(leaves, 'delay').map(l => l.no), ['3.2', '8']);
  assert.deepEqual(leavesInBucket(leaves, 'onplan'), []);
});

test('redWithoutNote — แดงต้องมีคำอธิบาย ไม่งั้นจอต้องฟ้อง', () => {
  const bad = redWithoutNote(flattenPop(POP));
  assert.equal(bad.length, 1);
  assert.equal(bad[0].no, '3.2');                 // 8 มี note แล้ว
});

test('suggestEva — เกณฑ์วันไม่เท่ากันทุกแผง (ห้ามใช้ชุดเดียวทั้งจอ)', () => {
  assert.equal(suggestEva('pop', 0), 'G');
  assert.equal(suggestEva('pop', 11), 'R');       // POP แดงที่ > 10 วัน
  assert.equal(suggestEva('quality', 15), 'R');   // คุณภาพแดงที่ > 14 วัน (คนละเกณฑ์กับ POP)
  assert.equal(suggestEva('quality', 5), 'Y');    // ยังไม่เกิน 7 วัน = เหลือง
  assert.equal(suggestEva('quality', 11, { hasImprovePlan: true }), 'Y');
  // 🟠 ช่องโหว่ในเกณฑ์ IEC: เกิน 7 วันแต่ไม่มีแผน improve ไม่เข้าทั้งเหลืองและแดง
  //    เราเลือกให้เป็นแดง (ช้าแล้วไม่มีแผน อันตรายกว่า) — รอ IEC ยืนยัน ถ้าเปลี่ยนให้แก้จุดเดียว
  assert.equal(suggestEva('quality', 11), 'R');
  assert.equal(suggestEva('doc', 8), 'R');
  assert.equal(suggestEva('doc', 8, { hasImprovePlan: true }), 'Y');
  assert.equal(suggestEva('pop', null), 'none');  // ไม่รู้จำนวนวัน = ห้ามเดา
  assert.equal(suggestEva('ไม่มีกฎนี้', 5), 'none');
});

test('evaMismatch — เตือนเมื่อสีที่คนตั้งไม่ตรงเกณฑ์ (เตือนเท่านั้น ห้ามบล็อก)', () => {
  assert.equal(evaMismatch('pop', 'R', 11), null);              // ตรงเกณฑ์
  assert.equal(evaMismatch('pop', 'G', 11).suggested, 'R');     // ตั้งเขียวทั้งที่ช้า 11 วัน
  assert.equal(evaMismatch('pop', 'G', null), null);            // ประเมินไม่ได้ = ไม่เตือน
  assert.equal(evaMismatch('pop', 'none', 11), null);
});
