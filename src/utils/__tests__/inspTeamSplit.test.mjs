/* 🔀 "1 อุปกรณ์ ตรวจได้หลายทีม" — ใบตรวจต้องแยกด้วย checklist ไม่ใช่ `jig_id`  (2026-11-10)
 * คำสั่ง user: *"การตรวจ am/pm มาทับกัน ตอนนี้อ้างอิงแค่ id ของอุปกรณ์ มันปนกัน"*
 * วัดจริง DR: 6 เครื่องมี checklist ทั้ง AM และ PM (112 ใบ) — ดูเหตุผลเต็มใน src/utils/pmTeams.js
 * 🔴 ใบที่บอกทีมไม่ได้ = unknown ห้ามเดาเป็นทีมที่กำลังดู */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* pmTeams → supabaseClient ⇒ bundle ด้วย rolldown + stub (วิธีเดียวกับ teamWriteScope.test.mjs) */
const STUB = `export const supabase = { from() { throw new Error('no db in test'); } }; export const supabaseDR = supabase;`;
let splitInspByTeam, inspTeamLabel;
before(async () => {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({
    input: 'src/utils/pmTeams.js',
    plugins: [{
      name: 'stub-supabase',
      resolveId(id) { return /supabaseClient$/.test(id) ? '\0stub' : null; },
      load(id) { return id === '\0stub' ? STUB : null; },
    }],
  });
  const out = join(tmpdir(), `pmteams-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });
  ({ splitInspByTeam, inspTeamLabel } = await import(pathToFileURL(out).href));
});

/* เคสจริง PF-H101 (HDF1): AM 22 ใบ · DIE MTN 1 ใบ บนเครื่องเดียวกัน */
const CL = { am1: 'production', die1: 'die_maintenance', mtn1: 'maintenance' };
const ROWS = [
  { id: 'a1', checklist_id: 'am1' },
  { id: 'd1', checklist_id: 'die1' },
  { id: 'a2', checklist_id: 'am1' },
];

test('แยกใบของทีมที่กำลังดู ออกจากใบของทีมอื่น', () => {
  const r = splitInspByTeam(ROWS, { clDeptById: CL, team: 'production' });
  assert.deepEqual(r.mine.map(x => x.id), ['a1', 'a2']);
  assert.deepEqual(r.others.map(x => x.id), ['d1']);
  assert.deepEqual(r.otherTeams, ['die_maintenance']);
  assert.equal(r.unknown.length, 0);

  /* มองจากฝั่งช่าง = สลับข้างกันเป๊ะ (ไม่ใช่ "AM ชนะเสมอ") */
  const d = splitInspByTeam(ROWS, { clDeptById: CL, team: 'die_maintenance' });
  assert.deepEqual(d.mine.map(x => x.id), ['d1']);
  assert.deepEqual(d.others.map(x => x.id), ['a1', 'a2']);
});

test('🔴 ใบที่บอกทีมไม่ได้ = unknown ห้ามโยนเข้า mine', () => {
  const rows = [{ id: 'n1', checklist_id: null }, { id: 'x1', checklist_id: 'ไม่มีในแมป' }, { id: 'a1', checklist_id: 'am1' }];
  const r = splitInspByTeam(rows, { clDeptById: CL, team: 'production' });
  assert.deepEqual(r.mine.map(x => x.id), ['a1'], 'ใบที่ไม่รู้ทีมต้องไม่ถูกนับเป็นของทีมที่กำลังดู');
  assert.deepEqual(r.unknown.map(x => x.id), ['n1', 'x1']);
  assert.equal(r.others.length, 0, 'ไม่รู้ทีม ≠ ทีมอื่น — คนละความหมาย ห้ามปน');
});

test('ไม่ส่ง team = ไม่แยก (พฤติกรรมเดิมเป๊ะ)', () => {
  for (const team of [null, undefined, '']) {
    const r = splitInspByTeam(ROWS, { clDeptById: CL, team });
    assert.equal(r.mine.length, 3, `team=${String(team)} ต้องไม่แยก`);
    assert.equal(r.others.length, 0);
  }
});

test('ไม่มีแมปทีมเลย (อ่าน checklists ไม่ได้) = unknown ทั้งก้อน ไม่ใช่ mine ทั้งก้อน', () => {
  const r = splitInspByTeam(ROWS, { clDeptById: {}, team: 'production' });
  assert.equal(r.mine.length, 0);
  assert.equal(r.unknown.length, 3, 'อ่านทีมไม่ได้ = บอกไม่ได้ว่าใบไหนของใคร — จอต้องเขียนบอก');
});

test('ของเข้าแปลกๆ ไม่ทำให้ล้ม', () => {
  for (const bad of [null, undefined, 'x', 42, {}]) {
    const r = splitInspByTeam(bad, { clDeptById: CL, team: 'production' });
    assert.equal(r.mine.length + r.others.length + r.unknown.length, 0);
  }
  assert.deepEqual(splitInspByTeam(ROWS).otherTeams, [], 'ไม่ส่ง opt เลยก็ต้องไม่ล้ม');
});

test('ป้ายบอกที่มาของใบ บอกทั้งชื่อทีมและ AM/PM', () => {
  assert.match(inspTeamLabel('production'), /AM/);
  assert.match(inspTeamLabel('die_maintenance'), /PM/);
  assert.match(inspTeamLabel('die_maintenance'), /DIE/i);
  assert.equal(inspTeamLabel(null), 'ไม่รู้ทีม');
  assert.equal(inspTeamLabel(''), 'ไม่รู้ทีม');
});
