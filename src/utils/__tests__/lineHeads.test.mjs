/**
 * เทส src/utils/lineHeads.js — "หัวหน้างานของไลน์นี้มีใครบ้าง ของกะไหน" (2026-10-28)
 * กติกาที่ห้าม regress:
 *   1. ไลน์หนึ่งมีหัวหน้าได้หลายคน/หลายกะ — ห้ามคืนคนเดียว
 *   2. ไลน์ตัวเองชนะไลน์แม่ · ไม่มีของตัวเองจึงตกทอดจากแม่ · **ห้ามดึงจากไลน์ลูก**
 *   3. กะมาจากตารางกะจริง — ไม่ส่ง maps = null ห้ามเดาว่า A = กะเช้า
 *   4. ไม่มีหัวหน้าไลน์เลย ถึงถอยไปหัวหน้าแผนก และต้องบอกชั้นที่ใช้
 *   5. ชื่อที่พิมพ์ทับ (head_name) เทียบทะเบียนได้แค่ "รูปแบบ" — สะกดต่าง = คนละคน
 * positions.js import supabaseClient → bundle ด้วย rolldown + stub (วิธีเดียวกับ manpowerBoard.test.mjs)
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STUB = `export const supabase = { from() { throw new Error('no db in test'); } }; export const supabaseDR = supabase;`;
let M;
before(async () => {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({
    input: 'src/utils/lineHeads.js',
    plugins: [{
      name: 'stub-supabase',
      resolveId(id) { return /supabaseClient$/.test(id) ? '\0stub' : null; },
      load(id) { return id === '\0stub' ? STUB : null; },
    }],
  });
  const out = join(tmpdir(), `lineHeads-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });
  M = await import(pathToFileURL(out).href);
});

const LINES = [
  { id: 1, name: 'LINE APRON ASSY', parent_line_name: null },
  { id: 2, name: 'Line 60', parent_line_name: 'LINE APRON ASSY' },
  { id: 3, name: 'Line 61', parent_line_name: 'LINE APRON ASSY' },
  { id: 4, name: 'GOR', parent_line_name: null },
];
const E = (id, name, position, team, line_id) => ({ id, name, position, team, line_id });
const EMPS = [
  E('l1', 'ทินวัฒน์ พันแก่น',   'line_leader', 'A', 1),
  E('l2', 'อภิชาติ เจริญโพธิ์ทอง', 'line_leader', 'A', 1),
  E('l3', 'เกรียงศักดิ์ วามะขันธ์', 'line_leader', 'B', 1),
  E('l4', 'ศรัณยู รู้คุณ',       'line_leader', 'B', 1),
  E('o1', 'พนักงาน ก',          'operator',    'A', 1),
  E('d1', 'ชลทิตย์ วิฬุละหิต',   'dept_head',   'C', 4),   // GOR มีแต่หัวหน้าแผนก
  E('c1', 'หัวหน้า Line61',      'line_leader', 'A', 3),   // Line 61 มีของตัวเอง
];
// ตารางกะ: ทีม A = เช้า · ทีม B = ดึก (ของวันนี้)
const MAPS = { byLine: { 1: 'A', 3: 'A', 4: 'A' }, byDept: {} };

test('ไลน์เดียวมีหัวหน้าได้หลายคน/หลายกะ — ห้ามคืนคนเดียว', () => {
  const h = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: EMPS, maps: MAPS });
  assert.equal(h.rows.length, 4, 'LINE APRON ASSY มีหัวหน้าไลน์ 4 คน');
  assert.equal(h.level, 'leader');
  assert.equal(h.fromLineName, null, 'เป็นของไลน์ตัวเอง ไม่ได้ตกทอด');
  assert.deepEqual(h.byShift.day.map(r => r.name), ['ทินวัฒน์ พันแก่น', 'อภิชาติ เจริญโพธิ์ทอง']);
  assert.deepEqual(h.byShift.night.map(r => r.name), ['เกรียงศักดิ์ วามะขันธ์', 'ศรัณยู รู้คุณ']);
  assert.deepEqual(h.byShift.unknown, []);
  assert.ok(!h.rows.some(r => r.position === 'operator'), 'พนักงานทั่วไปห้ามติดมา');
});

test('ไลน์ลูกที่ไม่มีหัวหน้าของตัวเอง → ตกทอดจากไลน์แม่ + บอกว่ามาจากไลน์ไหน', () => {
  const h = M.lineHeadsOf({ lineId: 2, lines: LINES, employees: EMPS, maps: MAPS });
  assert.equal(h.rows.length, 4);
  assert.equal(h.fromLineName, 'LINE APRON ASSY');
});

test('ไลน์ตัวเองชนะไลน์แม่เสมอ', () => {
  const h = M.lineHeadsOf({ lineId: 3, lines: LINES, employees: EMPS, maps: MAPS });
  assert.deepEqual(h.rows.map(r => r.name), ['หัวหน้า Line61']);
  assert.equal(h.fromLineName, null);
});

test('🔴 ห้ามดึงหัวหน้าจากไลน์ลูกขึ้นมาเป็นของไลน์แม่', () => {
  const lines = [...LINES, { id: 5, name: 'PARENT ว่าง', parent_line_name: null },
    { id: 6, name: 'ลูกของว่าง', parent_line_name: 'PARENT ว่าง' }];
  const emps = [...EMPS, E('x1', 'หัวหน้าลูก', 'line_leader', 'A', 6)];
  const h = M.lineHeadsOf({ lineId: 5, lines, employees: emps, maps: MAPS });
  assert.deepEqual(h.rows, [], 'ไลน์แม่ยังไม่มีหัวหน้า = ว่าง (จอต้องเขียนว่าทะเบียนยังไม่มี)');
  assert.equal(h.level, null);
});

test('🔴 ไม่ส่งตารางกะ = ไม่รู้กะ (ห้ามเดาว่า A = กะเช้า)', () => {
  const h = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: EMPS });
  assert.equal(h.rows.length, 4);
  assert.ok(h.rows.every(r => r.shift === null));
  assert.equal(h.byShift.day.length, 0);
  assert.equal(h.byShift.night.length, 0);
  assert.equal(h.byShift.unknown.length, 4);
  assert.match(M.headsSummary(h), /ยังไม่รู้กะ/);
  assert.match(M.headsSummary(h), /ทีม A/);
});

test('ไม่มีหัวหน้าไลน์เลย → ถอยไปหัวหน้าแผนก และบอกชั้นที่ใช้', () => {
  const h = M.lineHeadsOf({ lineId: 4, lines: LINES, employees: EMPS, maps: MAPS });
  assert.deepEqual(h.rows.map(r => r.name), ['ชลทิตย์ วิฬุละหิต']);
  assert.equal(h.level, 'supervisor', 'จอจะได้เขียนว่า "นี่คือหัวหน้าแผนก ไม่ใช่หัวหน้าไลน์"');
});

test('ชื่อที่พิมพ์ทับ: ผ่อนคำนำหน้า/ช่องว่างได้ · สะกดต่าง = คนละคน', () => {
  assert.equal(M.sameName('คุณสุวิทย์ชัย  ดีทั่ว', 'สุวิทย์ชัย ดีทั่ว'), true);
  assert.equal(M.sameName('นายสมชาย ใจดี', 'สมชาย ใจดี'), true);
  assert.equal(M.sameName('สุวิทชัย ดีทั่ว', 'สุวิทย์ชัย ดีทั่ว'), false, 'สะกดต่าง = คนละคน ห้ามเดาให้ตรง');
  assert.equal(M.sameName('', 'ก'), false);

  const ok = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: EMPS, maps: MAPS, legacyName: 'คุณอภิชาติ เจริญโพธิ์ทอง' });
  assert.equal(ok.legacyInRegistry, true);
  const bad = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: EMPS, maps: MAPS, legacyName: 'คุณสุวิทชัย ดีทั่ว' });
  assert.equal(bad.legacyInRegistry, false);
});

test('🔴 ยังโหลดทะเบียนพนักงานไม่เสร็จ = ตัดสินไม่ได้ (null) ห้ามขึ้นเตือนว่าไม่มีในทะเบียน', () => {
  const h = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: [], legacyName: 'ใครสักคน' });
  assert.equal(h.legacyInRegistry, null);
  assert.deepEqual(h.rows, []);
  const none = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: EMPS, maps: MAPS });
  assert.equal(none.legacyInRegistry, null, 'ไม่มีชื่อพิมพ์ทับ = ไม่ต้องตัดสิน');
});

test('ไม่ส่ง lineId / ไลน์ไม่มีในทะเบียน = คืนโครงว่าง ไม่โยน error', () => {
  assert.deepEqual(M.lineHeadsOf({}).rows, []);
  assert.deepEqual(M.lineHeadsOf({ lineId: 999, lines: LINES, employees: EMPS, maps: MAPS }).rows, []);
  assert.equal(M.headsSummary(null), '');
});

/* ── 🔴 2 ทะเบียนตอบคนละคำถาม (28/10 รอบ 2 · feedback user "มันมีหัวหน้าหมดแล้วนะ
      นอกจากฐานข้อมูลกับ user ใช้งานจะมั่วไม่ตรงกัน") ──────────────────────────────
     ตำแหน่งงาน ← employees.position · ขอบเขตไลน์ ← widerLineId(profiles, employees)
     ที่ไม่ตรงกัน = conflicts (ห้ามเงียบ ห้ามเลือกข้างให้เอง)                        */

test('ขอบเขต: บัญชีผูกไลน์แม่ · พนักงานสังกัดไลน์ลูก ⇒ เป็นหัวหน้าของ "ไลน์แม่" (กฎ widerLineId 27/10)', () => {
  const lines = [
    { id: 9, name: 'Assembly Line D', parent_line_name: null },
    { id: 91, name: 'Line D2', parent_line_name: 'Assembly Line D' },
    { id: 92, name: 'Line D3', parent_line_name: 'Assembly Line D' },
  ];
  const emps = [E('n1', 'ณัฐพล คำผาง', 'line_leader', 'A', 91), E('n2', 'โสภณ บุญมี', 'line_leader', 'B', 92)];
  const profs = [
    { full_name: 'ณัฐพล คำผาง', role: 'leader', line_id: 9, team: 'A' },
    { full_name: 'โสภณ บุญมี',  role: 'leader', line_id: 9, team: 'B' },
  ];
  const parent = M.lineHeadsOf({ lineId: 9, lines, employees: emps, profiles: profs });
  assert.deepEqual(parent.rows.map(r => r.name).sort(), ['ณัฐพล คำผาง', 'โสภณ บุญมี'],
    'ไลน์แม่ต้องเห็นหัวหน้า — อ่าน employees อย่างเดียวจะได้ว่าง ทั้งที่มีจริง');
  assert.deepEqual(parent.conflicts, [], 'ตรงกันทั้งคู่ = ไม่มีข้อขัดแย้ง');
  // ไลน์ลูกยังเห็นหัวหน้าผ่านการตกทอดจากไลน์แม่
  const child = M.lineHeadsOf({ lineId: 91, lines, employees: emps, profiles: profs });
  assert.equal(child.fromLineName, 'Assembly Line D');
  assert.equal(child.rows.length, 2);
});

test('🔴 profiles.role = ชุดสิทธิ์ ไม่ใช่ตำแหน่งงาน — ช่างที่ถือ role supervisor ห้ามกลายเป็นหัวหน้า', () => {
  const emps = [...EMPS, E('t1', 'ภัทรกร อาภรณ์', 'technician', 'B', 1)];
  const profs = [{ full_name: 'ภัทรกร อาภรณ์', role: 'supervisor', line_id: 1, team: 'B' }];
  const h = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: emps, profiles: profs, maps: MAPS });
  assert.ok(!h.rows.some(r => r.name === 'ภัทรกร อาภรณ์'), 'ช่างต้องไม่ขึ้นเป็นหัวหน้างาน');
  assert.equal(h.rows.length, 4, 'หัวหน้าไลน์ 4 คนเดิมยังอยู่ครบ');
  assert.deepEqual(h.conflicts, [{ kind: 'role_only', name: 'ภัทรกร อาภรณ์', role: 'supervisor', team: 'B', position: 'technician' }],
    'ต้องฟ้องว่า 2 ทะเบียนไม่ตรงกัน ไม่ใช่เงียบ');
});

test('🔴 มีบัญชีผูกไลน์ แต่ไม่มีตัวตนในทะเบียนพนักงาน = conflicts (ห้ามเงียบ)', () => {
  const profs = [{ full_name: 'ศิวพงษ์ เศวตมุจลินท์', role: 'supervisor', line_id: 4, team: null }];
  const h = M.lineHeadsOf({ lineId: 4, lines: LINES, employees: EMPS, profiles: profs, maps: MAPS });
  assert.deepEqual(h.rows.map(r => r.name), ['ชลทิตย์ วิฬุละหิต'], 'หัวหน้าแผนกจากทะเบียนพนักงานยังขึ้นปกติ');
  assert.deepEqual(h.conflicts, [{ kind: 'no_employee', name: 'ศิวพงษ์ เศวตมุจลินท์', role: 'supervisor', team: null }]);
});

test('ไม่ส่ง profiles = พฤติกรรมเดิมเป๊ะ (ไม่มี conflicts · ขอบเขตใช้ employees.line_id)', () => {
  const a = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: EMPS, maps: MAPS });
  const b = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: EMPS, profiles: [], maps: MAPS });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.conflicts, []);
});

test('ชื่อที่พิมพ์ทับ: นับว่า "มีในทะเบียน" ถ้าเจอฝั่งบัญชีผู้ใช้ด้วย', () => {
  const profs = [{ full_name: 'นพดล พงษ์ก๋าแก้ว', role: 'supervisor', line_id: null, team: null }];
  const h = M.lineHeadsOf({ lineId: 1, lines: LINES, employees: EMPS, profiles: profs, maps: MAPS, legacyName: 'คุณนพดล พงษ์ก๋าแก้ว' });
  assert.equal(h.legacyInRegistry, true, 'มีบัญชีผู้ใช้อยู่จริง = จับคู่ได้ ไม่ใช่ชื่อลอย');
  assert.deepEqual(h.conflicts, [], 'บัญชีไม่ได้ผูกไลน์นี้ = ไม่ใช่ข้อขัดแย้งของไลน์นี้');
});
