/**
 * เทส src/utils/manpowerBoard.js — Manpower Control Board (2026-10-06)
 * กติกาที่ห้าม regress:
 *   1. คนจัดแถวตาม "ตำแหน่ง" (ผจก./หัวหน้าส่วน → หัวผัง · หัวหน้าแผนก · หัวหน้ากลุ่ม · ช่าง · พนักงาน)
 *   2. ตำแหน่งที่ระบบไม่รู้จัก ต้องไม่หายจากบอร์ด (ลงแถวพนักงาน + ธง)
 *   3. กะของทีมมาจากตารางกะ (A/B หมุน · C เช้าตลอด) · ตารางกะยังไม่ตั้ง = ไม่คำนวณช่องว่าง (null)
 *   4. ช่องว่าง = std ของกะ − คนในทะเบียนกะนั้น · std ไม่ได้ตั้ง = null (ไม่ใช่ 0)
 *   5. 4M: ใบ rejected ไม่นับ · ใบไลน์ลูกนับให้แผนกของไลน์แม่
 * positions.js import supabaseClient → bundle ด้วย rolldown + stub (วิธีเดียวกับ permissions.test.mjs)
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
    input: 'src/utils/manpowerBoard.js',
    plugins: [{
      name: 'stub-supabase',
      resolveId(id) { return /supabaseClient$/.test(id) ? '\0stub' : null; },
      load(id) { return id === '\0stub' ? STUB : null; },
    }],
  });
  const out = join(tmpdir(), `manpowerBoard-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });
  M = await import(pathToFileURL(out).href);
});

const NODES = [
  { id: 's', kind: 'section', name: 'PD3', code: 'PD3', parent_id: null, sort_order: 1 },
  { id: 'd1', kind: 'department', name: 'HYDROFORM', parent_id: 's', sort_order: 1 },
  { id: 'd2', kind: 'department', name: 'APRON', parent_id: 's', sort_order: 2 },
  { id: 'd3', kind: 'department', name: 'EMPTY', parent_id: 's', sort_order: 3 },
  { id: 'l1', kind: 'line', name: 'HDF1', parent_id: 'd1', ref_line_id: 11 },
  { id: 'x', kind: 'section', name: 'PD4', code: 'PD4', parent_id: null },
];
const LINES = [
  { id: 10, name: 'HYDROFORM', parent_line_name: null, std_day_shift: 4, std_night_shift: 3 },
  { id: 11, name: 'HDF1', parent_line_name: 'HYDROFORM', std_day_shift: 4, std_night_shift: 3 },
  { id: 20, name: 'APRON', parent_line_name: null, std_day_shift: 0, std_night_shift: 0 },
];
const E = (id, position, team, node, extra = {}) => ({ id, name: id, position, team, org_node_id: node, line_id: node === 'd1' ? 10 : node === 'd2' ? 20 : null, ...extra });
const EMPS = [
  E('mgr', 'manager', 'C', 's'),
  E('sh', 'section_head', 'C', 'd1'),                 // หัวหน้าส่วนแต่ผูกแผนก → ยังขึ้นหัวผัง
  E('eng', 'engineer', 'C', 's'),
  E('dh', 'dept_head', 'A', 'd1'),
  E('llA', 'line_leader', 'A', 'd1'), E('llB', 'line_leader', 'B', 'd1'),
  E('tech', 'technician', 'B', 'd1'),
  E('a1', 'operator', 'A', 'l1'), E('a2', 'operator', 'A', 'd1'),
  E('b1', 'operator', 'B', 'd1'),
  E('c1', 'operator', 'C', 'd1'),
  E('weird', 'นักบินอวกาศ', 'A', 'd1'),                // ตำแหน่งไม่รู้จัก
  E('p1', 'operator', 'A', 'd2'),
  E('other', 'operator', 'A', 'x'),                   // ส่วนงานอื่น ห้ามโผล่
];

test('จัดแถวตามตำแหน่ง + ตัดส่วนงานอื่น + แผนกเปล่าไม่วาดแต่บอกชื่อ', () => {
  const b = M.buildManpowerBoard({ section: NODES[0], nodes: NODES, employees: EMPS, lines: LINES, maps: { byLine: { 10: 'A' }, byDept: {} } });
  assert.deepEqual(b.top.map(p => p.id).sort(), ['mgr', 'sh']);
  assert.deepEqual(b.support.map(p => p.id), ['eng']);
  const h = b.depts.find(d => d.name === 'HYDROFORM');
  assert.deepEqual(h.heads.map(p => p.id), ['dh']);
  assert.deepEqual(h.techs.map(p => p.id), ['tech']);
  assert.deepEqual(h.cols.map(c => c.team), ['A', 'B', 'C']);
  const A = h.cols[0];
  assert.deepEqual(A.leaders.map(p => p.id), ['llA']);
  assert.ok(A.ops.some(p => p.id === 'weird' && p.unknownPos), 'ตำแหน่งไม่รู้จักต้องอยู่บนบอร์ด');
  assert.equal(b.emptyDepts.includes('EMPTY'), true);
  assert.equal(b.depts.some(d => d.cols.some(c => c.ops.some(p => p.id === 'other'))), false);
});

test('กะ + ช่องว่าง: A เช้า B ดึก C เช้าตลอด · std เช้า 4 ดึก 3', () => {
  const b = M.buildManpowerBoard({ section: NODES[0], nodes: NODES, employees: EMPS, lines: LINES, maps: { byLine: { 10: 'A' }, byDept: {} } });
  const h = b.depts.find(d => d.name === 'HYDROFORM');
  const [A, B, C] = h.cols;
  assert.equal(A.shift, 'day'); assert.equal(B.shift, 'night'); assert.equal(C.shift, 'day');
  assert.deepEqual(h.plan, { day: 4, night: 3 });   // แม่ตั้ง 4 แล้ว ลูกไม่บวกซ้ำ
  // กะเช้า: A 3 คน (a1,a2,weird) + C 1 คน = 4 → ว่าง 0 · ลงที่ A (ทีมหมุน)
  assert.equal(A.slots, 0); assert.equal(C.slots, null);
  // กะดึก: B 1 คน → ว่าง 2
  assert.equal(B.slots, 2);
});

test('ตารางกะยังไม่ตั้ง → ไม่รู้ว่าทีมไหนเข้ากะไหน = ไม่คำนวณช่องว่าง + บอกทีม', () => {
  const b = M.buildManpowerBoard({ section: NODES[0], nodes: NODES, employees: EMPS, lines: LINES, maps: { byLine: {}, byDept: {} } });
  const h = b.depts.find(d => d.name === 'HYDROFORM');
  assert.equal(h.cols.find(c => c.team === 'A').slots, null);
  assert.deepEqual(h.unknownShiftTeams, ['A', 'B', 'C']);
  // ทีม C: ตาม shiftFromTeam กลาง — ไม่มี dayTeam = null (ห้ามเดาเองในหน้านี้)
  assert.equal(h.cols.find(c => c.team === 'C').shift, null);
});

test('std ไม่ได้ตั้ง = แผน null ไม่ใช่ 0', () => {
  const b = M.buildManpowerBoard({ section: NODES[0], nodes: NODES, employees: EMPS, lines: LINES, maps: { byLine: { 20: 'A' }, byDept: {} } });
  const ap = b.depts.find(d => d.name === 'APRON');
  assert.equal(ap.plan.day, null); assert.equal(ap.planTotal, null);
  assert.equal(ap.cols[0].slots, null);
});

test('สถานะเช็คชื่อ', () => {
  assert.equal(M.attendanceState(undefined), 'unchecked');
  assert.equal(M.attendanceState({ is_present: true }), 'present');
  assert.equal(M.attendanceState({ is_present: false, leave_type: 'sick' }), 'leave');
  assert.equal(M.attendanceState({ is_present: false }), 'absent');
});

test('4M: rejected ไม่นับ · ใบไลน์ลูกนับให้ครอบครัว · ไม่มีใบ = ปกติ', () => {
  const fam = M.lineFamilyOf(LINES, [10]);
  const r = M.fourMStatus(fam, [
    { line_name: 'HDF1', category: 'Man', status: 'pending' },
    { line_id: 10, category: 'Machine', status: 'rejected' },
    { line_name: 'APRON', category: 'Method', status: 'approved' },
  ]);
  assert.equal(r.man.abnormal, true); assert.equal(r.man.pending, 1);
  assert.equal(r.machine.abnormal, false);
  assert.equal(r.method.abnormal, false);
  assert.equal(r.material.abnormal, false);
});

test('ผัง LAYOUT: คนประจำจุด + ย้ายมาชั่วคราววันนี้ + เรียงเช้าก่อนดึก', () => {
  const emp = { a: { id: 'a', name: 'a' }, b: { id: 'b', name: 'b' }, c: { id: 'c', name: 'c' } };
  const res = M.layoutPeople({
    stations: [{ id: 1 }, { id: 2 }],
    homeByEmp: { a: 1, b: 1, c: 2 },
    attendance: { c: { is_present: true, assigned_line: '1' } },
    empById: emp,
    shiftOfEmp: (e) => (e.id === 'b' ? 'day' : 'night'),
  });
  assert.deepEqual(res[0].people.map(p => p.emp.id), ['b', 'a', 'c']);
  assert.equal(res[0].people.find(p => p.emp.id === 'c').temp, true);
  assert.deepEqual(res[1].people.map(p => p.emp.id), ['c']);
  assert.equal(res[1].people[0].away, true, 'จุดประจำต้องบอกว่าวันนี้ไปยืนที่อื่น');
});

test('📺 จอ TV: แผนกที่การ์ดล้น ตัดหลายหน้า · ทุกคอลัมน์ตัดช่วงเดียวกัน · ช่องว่างนับเป็นการ์ด', () => {
  const P = (n, t) => Array.from({ length: n }, (_, i) => ({ id: `${t}${i}` }));
  const depts = [
    { key: 'd1', cols: [{ team: 'A', ops: P(5, 'a'), slots: 2 }, { team: 'B', ops: P(3, 'b'), slots: null }] },
    { key: 'd2', cols: [{ team: 'A', ops: P(2, 'x'), slots: 0 }] },
  ];
  const pages = M.paginateTv(depts, () => 4);
  assert.equal(pages.length, 3);                       // d1: A มี 7 ใบ (5+ว่าง 2) ⇒ 2 หน้า · d2: 1 หน้า
  assert.deepEqual(pages.map(p => [p.dept.key, p.part, p.parts]), [['d1', 0, 2], ['d1', 1, 2], ['d2', 0, 1]]);
  assert.equal(pages[0].cols[0].items.length, 4); assert.equal(pages[0].cols[0].more, 3);
  assert.deepEqual(pages[1].cols[0].items.map(i => i.kind), ['op', 'slot', 'slot']);
  assert.equal(pages[1].cols[1].items.length, 0, 'ทีม B หมดแล้วหน้า 2 ยังมีคอลัมน์ (หัวทีม) แต่ไม่มีการ์ด');
  assert.deepEqual(M.paginateTv([], () => 4), []);
});

test('📺 จอ TV: ความจุการ์ดต่อคอลัมน์ · ที่ไม่พอ = 1 (ไม่หารศูนย์)', () => {
  // คอลัมน์กว้าง (1000-8)/2-16 = 480 ⇒ (480+6)/(130+6) = 3 ใบ/แถว · สูง (300+6)/(120+6) = 2 แถว
  assert.equal(M.tvCardCapacity({ areaW: 1000, areaH: 300, nCols: 2, cardW: 130, cardH: 120 }), 6);
  assert.equal(M.tvCardCapacity({ areaW: 50, areaH: 10, nCols: 3, cardW: 130, cardH: 120 }), 1);
});

test('ช่องที่ตั้งเอง (manpower_slot_plans) ชนะ std · ทีมที่ตั้งช่องแต่ยังไม่มีคน = คอลัมน์ช่องว่างล้วน', () => {
  const b = M.buildManpowerBoard({ section: NODES[0], nodes: NODES, employees: EMPS, lines: LINES,
    maps: { byLine: { 10: 'A' }, byDept: {} },
    slotPlans: [{ org_node_id: 'd1', team: 'B', slots: 5 }, { org_node_id: 'd1', team: 'D', slots: 2 }, { org_node_id: 'd3', team: 'A', slots: 3 }] });
  const h = b.depts.find(d => d.name === 'HYDROFORM');
  const B = h.cols.find(c => c.team === 'B');
  assert.equal(B.slots, 4); assert.equal(B.slotSource, 'plan');      // ตั้ง 5 · มีคน 1
  const D = h.cols.find(c => c.team === 'D');
  assert.equal(D.ops.length, 0); assert.equal(D.slots, 2);
  assert.equal(h.cols.find(c => c.team === 'A').slotSource, 'std', 'กะเช้ายังใช้ std เหมือนเดิม');
  const e = b.depts.find(d => d.name === 'EMPTY');
  assert.ok(e, 'แผนกเปล่าที่ตั้งช่องไว้ต้องโผล่ (ให้เห็นว่าว่างทั้งแผนก)');
  assert.equal(e.cols[0].slots, 3);
  assert.equal(b.emptyDepts.includes('EMPTY'), false);
});

test('ช่างประจำไลน์ข้ามแผนก (line_technicians) ขึ้นแถวช่าง ติดธง external · ไม่นับเป็นกำลังคนแผนก', () => {
  const mtn = { id: 'mtn1', name: 'ช่าง MTN', position: 'technician', team: '', org_node_id: 'x', line_id: null };
  const b = M.buildManpowerBoard({ section: NODES[0], nodes: NODES, employees: [...EMPS, mtn], lines: LINES,
    maps: { byLine: { 10: 'A' }, byDept: {} },
    lineTechs: [{ employee_id: 'mtn1', line_id: 11 }, { employee_id: 'tech', line_id: 10 }, { employee_id: 'ghost', line_id: 10 }] });
  const h = b.depts.find(d => d.name === 'HYDROFORM');
  assert.deepEqual(h.techs.map(t => t.id), ['tech', 'mtn1'], 'คนในสังกัดก่อน · คนนอกต่อท้าย · คนที่ไม่อยู่ในทะเบียน active ไม่วาด');
  assert.equal(h.techs[1].external, true); assert.deepEqual(h.techs[1].linkedLines, ['HDF1']);
  assert.deepEqual(h.techs[0].linkedLines, ['HYDROFORM']);
  assert.equal(h.opsTotal, 5);
});

test('🤝 คนยืมตัว: ยืมมาช่วย = แถว borrowed (ไม่นับทะเบียน) · คนในสังกัดที่ไปช่วยที่อื่น = lentTo', () => {
  const helpers = [
    { id: 'zz', name: 'คนยืม', position: 'operator', team: 'A', _helperFrom: 'GOR', _helperTo: 'HDF1', _helperShift: 'day' },
    { id: 'b1', name: 'b1', position: 'operator', team: 'B', _helperFrom: 'HYDROFORM', _helperTo: 'APRON', _helperShift: 'night' },
  ];
  const b = M.buildManpowerBoard({ section: NODES[0], nodes: NODES, employees: EMPS, lines: LINES, maps: { byLine: { 10: 'A' }, byDept: {} }, helpers });
  const h = b.depts.find(d => d.name === 'HYDROFORM');
  assert.deepEqual(h.borrowed.map(p => p.id), ['zz']);
  assert.deepEqual(h.borrowed[0].borrowed, { from: 'GOR', to: 'HDF1', shift: 'day' });
  assert.equal(h.opsTotal, 5, 'คนยืมไม่เข้าทะเบียนแผนก');
  assert.deepEqual(h.cols.find(c => c.team === 'B').ops[0].lentTo, { to: 'APRON', shift: 'night' });
  assert.equal(h.lentOut, 1);
  const ap = b.depts.find(d => d.name === 'APRON');
  assert.deepEqual(ap.borrowed.map(p => p.id), ['b1'], 'ยืมข้ามแผนกในส่วนงานเดียวกัน = โผล่ทั้ง 2 ฝั่ง (ไปช่วย / มาช่วย)');
  assert.equal(b.totals.borrowed, 2);
});

test('📍 ช่องระดับจุดงาน: ขาดที่จุดไหน กะไหน · ชนะ std แต่แพ้ช่องต่อทีม · คนไม่มีจุดประจำต้องถูกนับบอก', () => {
  const stations = [
    { id: 's1', line_id: 10, station_name: 'ST-1' },
    { id: 's2', line_id: 11, station_name: 'ST-2' },
    { id: 's3', line_id: 99, station_name: 'นอกแผนก' },
  ];
  const stationPlans = [{ station_id: 's1', per_shift: 2 }, { station_id: 's2', per_shift: 1 }, { station_id: 's3', per_shift: 5 }];
  const homeByEmp = { a1: 's1', b1: 's1', a2: 's2' };   // A = เช้า · B = ดึก (byLine 10 → A)
  const base = { section: NODES[0], nodes: NODES, employees: EMPS, lines: LINES, maps: { byLine: { 10: 'A' }, byDept: {} }, stations, stationPlans, homeByEmp };
  const h = M.buildManpowerBoard(base).depts.find(d => d.name === 'HYDROFORM');
  assert.equal(h.stationInfo.planned, 2, 'จุดนอกไลน์ของแผนกไม่นับ');
  assert.deepEqual(h.stationInfo.need, { day: 3, night: 3 });
  const A = h.cols.find(c => c.team === 'A'), B = h.cols.find(c => c.team === 'B');
  assert.equal(A.slotSource, 'station'); assert.equal(A.slots, 1); assert.deepEqual(A.slotStations, ['ST-1']);   // เช้า: ST-1 มี a1 (ขาด 1) · ST-2 มี a2
  assert.equal(B.slots, 2); assert.deepEqual(B.slotStations.sort(), ['ST-1', 'ST-2']);                          // ดึก: ST-1 มี b1 (ขาด 1) · ST-2 ขาด 1
  assert.equal(h.stationInfo.noHome, 2, 'weird + c1 ยังไม่มีจุดประจำ');
  // ช่องต่อทีมที่ตั้งเองยังชนะ (กะดึก)
  const h2 = M.buildManpowerBoard({ ...base, slotPlans: [{ org_node_id: 'd1', team: 'B', slots: 4 }] }).depts.find(d => d.name === 'HYDROFORM');
  assert.equal(h2.cols.find(c => c.team === 'B').slotSource, 'plan');
  assert.equal(h2.cols.find(c => c.team === 'A').slotSource, 'station');
});

test('📍 ผัง LAYOUT: ช่องที่ขาดต่อกะของจุด · ไม่ตั้ง = null · คนย้ายมาชั่วคราวไม่นับเป็นคนประจำ', () => {
  const emp = { a: { id: 'a', name: 'a' }, b: { id: 'b', name: 'b' } };
  const res = M.layoutPeople({
    stations: [{ id: 1 }, { id: 2 }], homeByEmp: { a: 1 },
    attendance: { b: { is_present: true, assigned_line: '1' } }, empById: emp,
    shiftOfEmp: (e) => (e.id === 'a' ? 'day' : 'night'), stationPlans: [{ station_id: 1, per_shift: 1 }],
  });
  assert.deepEqual(res[0].missing, { day: 0, night: 1, unknown: 0 });
  // คนประจำที่ไม่รู้กะ ⇒ ไม่เดา บอกยอดรวมที่ขาดแบบไม่รู้กะ
  const r2 = M.layoutPeople({ stations: [{ id: 1 }], homeByEmp: { a: 1 }, empById: emp, shiftOfEmp: () => null, stationPlans: [{ station_id: 1, per_shift: 2 }] });
  assert.deepEqual(r2[0].missing, { day: 0, night: 0, unknown: 3 });
  assert.equal(res[1].need, null); assert.equal(res[1].missing, null);
});

test('📜 ประวัติการเปลี่ยนช่อง: แปลง audit_log เป็นภาษาคน · ของที่ถูกลบยังอยู่ · actor ว่าง = ระบบ · ตัดตามขอบเขต · สรุปรายเดือน', () => {
  const rows = [
    { id: 1, table_name: 'manpower_slot_plans', action: 'INSERT', actor: 'สมชาย', new_data: { org_node_id: 'd1', team: 'A', slots: 6 }, changed_at: '2026-09-02T01:00:00Z' },
    { id: 2, table_name: 'manpower_slot_plans', action: 'UPDATE', actor: 'สมชาย', old_data: { org_node_id: 'd1', team: 'A', slots: 6 }, new_data: { org_node_id: 'd1', team: 'A', slots: 8 }, changed_at: '2026-10-01T01:00:00Z' },
    { id: 3, table_name: 'station_slot_plans', action: 'DELETE', actor: null, old_data: { station_id: 'gone', per_shift: 2 }, changed_at: '2026-10-02T01:00:00Z' },
    { id: 4, table_name: 'line_technicians', action: 'INSERT', actor: 'สมหญิง', new_data: { employee_id: 'e1', line_id: 10 }, changed_at: '2026-10-03T01:00:00Z' },
    { id: 5, table_name: 'manpower_slot_plans', action: 'INSERT', actor: 'x', new_data: { org_node_id: 'other', team: 'B', slots: 3 }, changed_at: '2026-10-04T01:00:00Z' },
    { id: 6, table_name: 'employees', action: 'UPDATE', actor: 'x', changed_at: '2026-10-04T01:00:00Z' },
  ];
  const list = M.describeSlotChanges(rows, {
    nodeById: new Map([['d1', { name: 'HYDROFORM' }]]),
    lineById: new Map([['10', { name: 'HYDROFORM' }]]),
    empById: new Map([['e1', { name: 'ช่างเอ' }]]),
    inScope: ({ kind, nodeId }) => kind !== 'team' || nodeId === 'd1',
  });
  assert.deepEqual(list.map(c => c.id), [4, 3, 2, 1], 'ล่าสุดก่อน · ตัดนอกขอบเขต · ไม่ใช่ตารางบอร์ด = ไม่เอา');
  assert.equal(list.find(c => c.id === 2).text, '6 → 8 ช่อง'); assert.equal(list.find(c => c.id === 2).delta, 2);
  const del = list.find(c => c.id === 3);
  assert.equal(del.where, 'จุดงาน (ถูกลบแล้ว)'); assert.equal(del.actor, 'ระบบ'); assert.equal(del.delta, -2);
  assert.equal(list.find(c => c.id === 4).where, 'HYDROFORM · ช่างเอ');
  const sum = M.summarizeSlotChanges(list);
  assert.deepEqual(sum.map(m => m.month), ['2026-10', '2026-09']);
  assert.equal(sum[0].teamDelta, 2); assert.equal(sum[0].stationDelta, -2); assert.equal(sum[0].techIn, 1);
  assert.equal(sum[1].teamDelta, 6);
});
