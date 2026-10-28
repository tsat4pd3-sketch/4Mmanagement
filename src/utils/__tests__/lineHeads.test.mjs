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
