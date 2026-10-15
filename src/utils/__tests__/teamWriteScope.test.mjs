/* 🔐 ด่าน "ทีมนี้เป็นของเราไหม" ฝั่งช่าง (2026-10-15 · คำสั่ง user)
 * ฝั่งช่างใช้ **ทีม** เป็นแกน ไม่ใช่ส่วนงาน — ช่างซ่อมข้ามไลน์เป็นงานปกติ
 * 🔴 ไม่ผูกทีม = ไม่บล็อก (ไม่รู้ ≠ ปฏิเสธ) — หลักเดียวกับ canDoStep */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* mtnTeams → pmTeams → supabaseClient ⇒ bundle ด้วย rolldown + stub
   (วิธีเดียวกับ workingPosition.test.mjs / manpowerBoard.test.mjs) */
const STUB = `export const supabase = { from() { throw new Error('no db in test'); } }; export const supabaseDR = supabase;`;
let canWriteTeam, teamBlockText;
before(async () => {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({
    input: 'src/utils/mtnTeams.js',
    plugins: [{
      name: 'stub-supabase',
      resolveId(id) { return /supabaseClient$/.test(id) ? '\0stub' : null; },
      load(id) { return id === '\0stub' ? STUB : null; },
    }],
  });
  const out = join(tmpdir(), `mtnteams-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });
  ({ canWriteTeam, teamBlockText } = await import(pathToFileURL(out).href));
});

test('ช่างทีมหนึ่งแก้ของอีกทีมไม่ได้', () => {
  assert.equal(canWriteTeam(['jig_maintenance'], 'die_maintenance').ok, false);
  assert.equal(canWriteTeam(['jig_maintenance'], 'jig_maintenance').ok, true);
});

test('รับชื่อทีมแบบข้อความเก่า ("JIG MTN") ได้ — ข้อมูลเก่าเก็บเป็นชื่อ', () => {
  assert.equal(canWriteTeam(['JIG MTN'], 'jig_maintenance').ok, true);
});

test('🔴 ไม่ผูกทีม = ไม่บล็อก (ไม่รู้ ≠ ปฏิเสธ) · แถวไม่ระบุทีม = ของกลาง', () => {
  assert.equal(canWriteTeam([], 'die_maintenance').code, 'no_team_anchor');
  assert.equal(canWriteTeam(['jig_maintenance'], null).code, 'unknown_target');
});

test('คีย์ scope:all_units / admin ข้ามได้', () => {
  assert.equal(canWriteTeam(['jig_maintenance'], 'die_maintenance', { allUnits: true }).ok, true);
  assert.equal(canWriteTeam(['jig_maintenance'], 'die_maintenance', { role: 'admin' }).ok, true);
});

test('ข้อความต้องบอกทางแก้ ไม่ใช่แค่ "ไม่มีสิทธิ์"', () => {
  const r = canWriteTeam(['jig_maintenance'], 'die_maintenance');
  assert.match(teamBlockText(r), /ทีมช่างอื่น/);
  assert.match(teamBlockText(r), /แอดมิน|ช่างทีมนั้น/);
  assert.equal(teamBlockText({ ok: true }), '');
});
