/* กฎการจับคู่ "โหนดผังองค์กร ↔ ทะเบียนอื่น" — ที่พลาดแล้วข้อมูลคนหายเงียบ (2026-10-05) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  orgRefValues, otherNodesWithSameValue, orgRefKeyChange,
  orgRefBlockMessage, orgRefDeleteNote, orgRefDeactivateNote, ORG_TEXT_REF,
  mixedKeyHolders, loadOrgNodeRefs, renameOrgRefs,
} from '../orgNodeRefs.js';

const N = (o) => ({ id: o.id || 'x', kind: 'team', name: '', code: null, is_active: true, ...o });

test('คีย์จับคู่: ส่วนงาน/แผนก/ทีม = code||name · กลุ่ม = ชื่อ (ไม่ใช่เลขไลน์)', () => {
  // ทีมในผังชื่อ "Team A" แต่ employees.team = 'A' ⇒ ต้องได้ code
  assert.deepEqual(orgRefValues(N({ kind: 'team', name: 'Team A', code: 'A' })), ['A']);
  assert.deepEqual(orgRefValues(N({ kind: 'section', name: 'PLN & STO', code: 'Planning&Store' })), ['Planning&Store']);
  assert.deepEqual(orgRefValues(N({ kind: 'department', name: 'DIE MTN', code: null })), ['DIE MTN']);
  // กลุ่ม: code เป็นเลขไลน์ '9' ⇒ ชื่อต้องมาก่อน (operator.jsx เก็บชื่อกลุ่ม)
  assert.deepEqual(orgRefValues(N({ kind: 'line', name: 'APRON ASSY', code: '9' })), ['APRON ASSY', '9']);
  assert.deepEqual(orgRefValues(null), []);
});

test('โหนด active ตัวอื่นถือคีย์เดียวกัน = ชื่อไม่กำพร้า (ทีม A/B/C มีชุดละกลุ่ม)', () => {
  const a1 = N({ id: '1', name: 'Team A', code: 'A' });
  const a2 = N({ id: '2', name: 'Team A', code: 'A' });
  const b  = N({ id: '3', name: 'Team B', code: 'B' });
  assert.equal(otherNodesWithSameValue(a1, [a1, a2, b]).length, 1);
  assert.equal(otherNodesWithSameValue(a1, [a1, b]).length, 0);
  // ปิดใช้งานแล้วไม่นับ — dropdown กรอง is_active ออกไปแล้ว
  assert.equal(otherNodesWithSameValue(a1, [a1, { ...a2, is_active: false }]).length, 0);
  // ชั้นต่างกันไม่ใช่คีย์เดียวกัน
  assert.equal(otherNodesWithSameValue(a1, [a1, N({ id: '4', kind: 'line', name: 'A' })]).length, 0);
});

test('เปลี่ยน code แล้วคีย์เปลี่ยน · เปลี่ยนแค่ชื่อขณะมี code = คีย์เดิม', () => {
  const t = N({ kind: 'team', name: 'Team A', code: 'A' });
  assert.equal(orgRefKeyChange(t, 'ทีมเช้า', 'A'), null);           // code เดิม = ทะเบียนยังจับคู่ได้
  assert.deepEqual(orgRefKeyChange(t, 'Team A', 'A1'), { from: 'A', to: 'A1' });
  const g = N({ kind: 'line', name: 'APRON ASSY', code: null });
  assert.deepEqual(orgRefKeyChange(g, 'APRON ASSY 2', null), { from: 'APRON ASSY', to: 'APRON ASSY 2' });
});

test('นับไม่ครบ (partial) = บล็อกการลบ ห้ามปล่อยผ่านเพราะนับได้ 0', () => {
  const node = N({ kind: 'department', name: 'DIE MTN' });
  const msg = orgRefBlockMessage(node, { partial: true, values: ['DIE MTN'], sharedWith: [] });
  assert.match(msg, /ยังไม่ลบ/);
});

test('มีคนสังกัดด้วย org_node_id = บล็อก และบอกจำนวน', () => {
  const node = N({ kind: 'department', name: 'DIE MTN' });
  const msg = orgRefBlockMessage(node, { empId: 9, profId: 1, heads: 0, textEmp: 9, textProf: 0, values: ['DIE MTN'], sharedWith: [] });
  assert.match(msg, /พนักงาน 9 คน/);
  assert.match(msg, /บัญชีผู้ใช้ 1 รายการ/);
  assert.match(msg, /ปิดใช้งาน/);
});

test('สำเนาชื่อกำพร้าก็บล็อก — แต่ถ้ามีโหนดอื่นถือคีย์เดียวกัน ลบได้', () => {
  const g = N({ kind: 'line', name: 'APRON ASSY' });
  const orphan = { empId: 0, profId: 0, heads: 0, textEmp: 35, textProf: 0, values: ['APRON ASSY'], sharedWith: [] };
  assert.match(orgRefBlockMessage(g, orphan), /35 คนยังเขียน/);
  const shared = { ...orphan, sharedWith: [N({ id: 'z' })] };
  assert.equal(orgRefBlockMessage(g, shared), null);
  assert.match(orgRefDeleteNote(shared), /ยังมีโหนดอื่นถืออยู่/);
});

test('ของที่จะหายไปด้วยต้องเขียนใน confirm (การแต่งตั้งหัวหน้า = cascade)', () => {
  assert.match(orgRefDeleteNote({ heads: 4, sharedWith: [], values: [] }), /ผู้คุมหน่วยนี้ \(ตำแหน่ง\/รักษาการ\) 4 รายการจะถูกลบ/);
  assert.equal(orgRefDeleteNote({ heads: 0, sharedWith: [], values: [] }), '');
});

test('ปิดใช้งาน: คนเดียวกันถูกนับ 2 ทาง ต้องไม่บวกกัน', () => {
  const note = orgRefDeactivateNote({ empId: 9, textEmp: 9, profId: 0 });
  assert.match(note, /พนักงาน 9 คน/);          // ไม่ใช่ 18
  assert.equal(orgRefDeactivateNote({ empId: 0, textEmp: 0, profId: 0 }), '');
  assert.equal(orgRefDeactivateNote({ partial: true, empId: 9 }), '');
});

/* ── ทะเบียนนอกฝั่งพนักงานที่เคย "ไม่ถูกนับเลย" (2026-10-08) ─────────────────────────
   วัด 08/10 ด้วยการสแกนทุกคอลัมน์ text ของ schema public: ลบ/เปลี่ยนชื่อแผนกแล้ว
   `shift_schedules.dept_name` 35 แถว · `kpi_definitions.scope_value` (MTN 11 · JIG MTN 13)
   · `cost_centers.section` กำพร้าเงียบ เพราะตัวนับมองแค่ employees/profiles */

test('ตัวนับต้องครอบทะเบียนนอกฝั่งพนักงาน — ตารางกะ · นิยาม KPI · ศูนย์ต้นทุน', () => {
  const dep = (ORG_TEXT_REF.department.extra || []).map(x => `${x.tbl}.${x.col}`);
  assert.ok(dep.includes('shift_schedules.dept_name'), 'ตารางกะต้องถูกนับ');
  assert.ok(dep.includes('kpi_definitions.scope_value'), 'นิยาม KPI ต้องถูกนับ');
  assert.ok(dep.includes('cost_centers.section'), 'ศูนย์ต้นทุนต้องถูกนับ');
  // 🔴 ชื่อศูนย์ต้นทุนเอง / ผู้ตรวจในใบ CP = คนละความหมาย ห้ามนับ
  const all = Object.values(ORG_TEXT_REF).flatMap(t => (t.extra || []).map(x => `${x.tbl}.${x.col}`));
  assert.ok(!all.includes('cost_centers.name'));
  assert.ok(!all.includes('pe_cp_items.person'));
});

test('kpi_definitions เก็บ 2 ชั้นในคอลัมน์เดียว ⇒ ต้องกรอง scope_kind ตามชั้นของโหนด', () => {
  const kpiOf = (kind) => (ORG_TEXT_REF[kind].extra || []).find(x => x.tbl === 'kpi_definitions');
  assert.equal(kpiOf('section').kindCol, 'scope_kind');
  assert.equal(kpiOf('section').kindValue, 'section');
  assert.equal(kpiOf('department').kindValue, 'department');
  // ชั้นที่ KPI ไม่ได้ผูก ต้องไม่มี entry (ไม่ใช่กรองว่าง)
  assert.equal(kpiOf('team'), undefined);
  assert.equal(kpiOf('line'), undefined);
});

test('cost_centers ไม่มีคอลัมน์ id — ต้องนับแถวด้วย PK จริง (code)', () => {
  const cc = (ORG_TEXT_REF.department.extra || []).find(x => x.tbl === 'cost_centers');
  assert.equal(cc.pk, 'code');   // .select('id') = คิวรีล้ม = rename รายงานผิด
});

test('ข้อความบล็อกต้องบอกชื่อทะเบียนที่ยังอ้างอยู่ ไม่ใช่เงียบ', () => {
  const node = N({ kind: 'department', name: 'Maintenance', code: 'MTN' });
  const refs = {
    empId: 0, profId: 0, heads: 0, textEmp: 0, textProf: 0, textOther: 46,
    otherBy: [{ label: 'ตารางกะ', n: 35 }, { label: 'นิยาม KPI', n: 11 }],
    values: ['MTN'], sharedWith: [],
  };
  const msg = orgRefBlockMessage(node, refs);
  assert.match(msg, /ตารางกะ 35 รายการ/);
  assert.match(msg, /นิยาม KPI 11 รายการ/);
  // มีโหนดอื่นถือคีย์เดียวกัน = ชื่อไม่กำพร้า ⇒ ไม่บล็อกด้วยสำเนาชื่อ
  assert.equal(orgRefBlockMessage(node, { ...refs, sharedWith: [N({ id: 'z' })] }), null);
});

/* 04/11 เคสจริง: แผนก "QA" (CC ผิด) ใต้ส่วนงาน "QA" — cost_centers.section='QA' 5 แถวเป็นของส่วนงาน
   แต่ถูกนับมาบล็อกการลบแผนก · และถ้าเปลี่ยนชื่อแผนก จะไล่เขียนทับ CC ของส่วนงาน */
const secQA  = { id: 's', kind: 'section',    name: 'QA', code: null, is_active: true };
const deptQA = { id: 'd', kind: 'department', name: 'QA', code: null, is_active: true, parent_id: 's' };
const deptX  = { id: 'x', kind: 'department', name: 'Inspection', code: null, is_active: true, parent_id: 's' };

function fakeSb(log) {
  const q = (tbl) => {
    const st = { tbl, op: 'select' };
    const api = {
      select() { return api; }, update() { st.op = 'update'; return api; },
      eq() { return api; }, in() { return api; }, overlaps() { return api; },
      then(res) { log.push(`${st.op}:${tbl}`); return Promise.resolve({ count: 5, data: [], error: null }).then(res); },
    };
    return api;
  };
  return { from: q };
}

test('คอลัมน์ปนชั้น (cost_centers.section): คีย์ชนกับโหนดต่างชั้น = ไม่นับ/ไม่ไล่เปลี่ยน', async () => {
  const kinds = ORG_TEXT_REF.department.extra.find(x => x.tbl === 'cost_centers').mixedKinds;
  assert.deepEqual(mixedKeyHolders(deptQA, [secQA, deptQA, deptX], kinds).map(n => n.id), ['s']);
  assert.equal(mixedKeyHolders(deptX, [secQA, deptQA, deptX], kinds).length, 0);       // ชื่อไม่ชน = นับปกติ
  assert.equal(mixedKeyHolders(deptQA, [{ ...secQA, is_active: false }, deptQA], kinds).length, 0);

  const log = [];
  const refs = await loadOrgNodeRefs(fakeSb(log), deptQA, [secQA, deptQA, deptX]);
  assert.ok(!log.includes('select:cost_centers'), 'ห้ามนับ CC ที่แยกไม่ออก');
  assert.ok(log.includes('select:shift_schedules'), 'ตารางกะ (ชั้นแผนกล้วน) ยังต้องนับ');
  assert.deepEqual(refs.ambiguous, ['รหัสศูนย์ต้นทุน']);
  assert.ok(!(refs.otherBy || []).some(o => o.label === 'รหัสศูนย์ต้นทุน'));
  assert.match(orgRefDeleteNote(refs), /ไม่ถูกนับเป็นของหน่วยนี้/);

  const log2 = [];
  await loadOrgNodeRefs(fakeSb(log2), deptX, [secQA, deptQA, deptX]);
  assert.ok(log2.includes('select:cost_centers'), 'ชื่อไม่ชน = ยังนับ CC เหมือนเดิม');

  const log3 = [];
  const r = await renameOrgRefs(fakeSb(log3), deptQA, 'QA', 'QA2', [secQA, deptQA]);
  assert.ok(!log3.includes('update:cost_centers'), 'ห้ามเขียนทับ CC ของส่วนงาน');
  assert.deepEqual(r.skipped, ['รหัสศูนย์ต้นทุน']);
  const log4 = [];
  await renameOrgRefs(fakeSb(log4), deptQA, 'QA', 'QA2');                     // ไม่ส่ง nodes = พฤติกรรมเดิม
  assert.ok(log4.includes('update:cost_centers'));
});
