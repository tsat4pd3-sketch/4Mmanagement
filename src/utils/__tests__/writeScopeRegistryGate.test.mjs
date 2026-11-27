/* 🛡️ ด่าน "ขอบเขตการแก้ (ชั้น ③) ห้ามล็อกคนจริงออกจากงาน" — เล่นกฎกับ **ทะเบียนผู้ใช้จริง** (2026-11-13)
 *
 * ทำไมต้องมี: audit role↔scope 13/11 เปลี่ยนความหมายของสิทธิ์ 2 เรื่องพร้อมกัน
 *   1. ใบผ่านข้ามหน่วย `scope:all_units` เลิกแจกราย role (37 บัญชี) → เป็น **รายคน** (`profiles.all_units` · 12 ใบที่ user เคาะ)
 *   2. `sections` (ขอบเขตที่เห็น) เลิกใช้ตัดสินการแก้ → แก้ได้ = บ้าน ∪ มอบหมาย (`writeUnits`) · CC · ใบผ่าน
 *   กฎ 26/10: "เปลี่ยนกฎที่ตัดสินขอบเขต = พิสูจน์กับทะเบียนผู้ใช้จริงก่อน merge" (scopeRegistryGate.test.mjs คุมฝั่ง "เห็น")
 *   ไฟล์นี้คุมฝั่ง "แก้" ด้วยทะเบียนเดียวกัน (fixtures/writeScopeRegistry.json · ไม่มีชื่อคน)
 * ⏱️ ไม่พึ่งเวลาปัจจุบัน (มอบหมายใน fixture เก็บเป็น section key ที่คำนวณแล้ว)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canWriteUnit, hasAllUnits, writeUnitsOf } from '../writeScope.js';
import { applyAssignments } from '../assignmentOverlay.js';
import { qaWriteCtx } from '../qaViewScope.js';

const REG = JSON.parse(readFileSync(new URL('./fixtures/writeScopeRegistry.json', import.meta.url), 'utf8'));
const KEEP = new Set(REG._meta.approved_all_units_accts);
const PEOPLE = REG.profiles.filter(p => !['display', 'viewer'].includes(p.role));
const assignOf = (acct) => REG.assignments.filter(a => a.acct === acct);

/** ctx ที่จอจะได้จาก UserContext หลังเปลี่ยน (ไม่ใช้แกน CC ในด่านนี้ — ต้องการผังจริง · CC คุมด้วย ccScope.test) */
const ctxOf = (p) => {
  const homeUnits = p.section ? [p.section] : [];
  const assigned = assignOf(p.acct).filter(a => a.scope_depth !== 'all').map(a => a.section_key).filter(Boolean);
  const allByAssign = assignOf(p.acct).some(a => a.scope_depth === 'all');
  return {
    role: p.role, section: p.section, sections: p.sections,
    writeUnits: [...new Set([...homeUnits, ...assigned])],
    allUnits: p.role === 'admin' || KEEP.has(p.acct) || allByAssign,
  };
};
const tag = (p) => `${p.acct} ${p.role} home=${p.section ?? '∅'} sees=${JSON.stringify(p.sections)} cc=${p.resp_cost_centers.length}`;

test('ทะเบียนต้องมีของจริง (fixture ว่าง = ด่านผ่านฟรี) + ไม่มีชื่อคน', () => {
  assert.ok(REG.profiles.length >= 100, `บัญชีน้อยผิดปกติ (${REG.profiles.length})`);
  assert.equal(KEEP.size, 12, 'ใบผ่านรายคนที่ user เคาะ 13/11 = 12 ใบ');
  const raw = readFileSync(new URL('./fixtures/writeScopeRegistry.json', import.meta.url), 'utf8');
  assert.ok(!/@[\w.-]+\.\w/.test(raw.replace(/"[^"]*sql[^"]*":/gi, '')), 'เจออีเมลใน fixture');
  for (const p of REG.profiles) assert.match(p.acct, /^[0-9a-f]{8}$/);
});

test('🔴 A — ใบผ่านข้ามหน่วย = admin + 12 ใบที่เคาะ เท่านั้น · ไม่มี role ไหนได้เป็นชุด', () => {
  const holders = PEOPLE.filter(p => hasAllUnits(ctxOf(p)));
  const nonAdmin = holders.filter(p => p.role !== 'admin').map(p => p.acct).sort();
  assert.deepEqual(nonAdmin, [...KEEP].sort(), 'ผู้ถือใบผ่านที่ไม่ใช่ admin ต้องเท่ากับรายชื่อที่ user เคาะเป๊ะ');
  for (const r of ['manager', 'qa', 'document_control']) {
    const roleHolders = holders.filter(p => p.role === r && !KEEP.has(p.acct));
    assert.deepEqual(roleHolders, [], `role ${r} ห้ามได้ใบผ่านจากชื่อ role`);
  }
});

test('🔴 B — ทุกบัญชีที่มีบ้าน ยังแก้ของบ้านตัวเองได้ (ห้ามมีใครถูกล็อกออกจากหน่วยตัวเอง)', () => {
  const bad = PEOPLE.filter(p => p.section && !canWriteUnit(ctxOf(p), p.section).ok).map(tag);
  assert.deepEqual(bad, [], `\nบัญชีที่แก้บ้านตัวเองไม่ได้ ${bad.length} ราย:\n  ${bad.join('\n  ')}\n`);
});

test('🔴 C — ไม่มีบ้าน + ไม่มีใบผ่าน + ไม่มี CC = ตัดสินไม่ได้ → ต้องอยู่ในรายชื่อที่รู้ตัว (ไม่ใช่โผล่ใหม่เงียบๆ)', () => {
  const stuck = PEOPLE.filter(p => !p.section && !hasAllUnits(ctxOf(p)) && p.resp_cost_centers.length === 0).map(p => `${p.acct}:${p.role}`);
  /* 13/11: marketing 1 ใบ (ยังไม่ตั้งสังกัด · งาน RFQ ไม่ผูกหน่วยผลิต) — เพิ่มชื่อที่นี่ได้เฉพาะเมื่อรู้ว่าทำไม */
  const known = new Set(['892e6700:marketing']);
  const unexpected = stuck.filter(x => !known.has(x));
  assert.deepEqual(unexpected, [], `\nบัญชีที่ "แก้อะไรไม่ได้เลย" โดยไม่มีใครรู้ตัว:\n  ${unexpected.join('\n  ')}\n`);
});

test('🔴 D — `sections` (ที่เห็น) ไม่ขยายการแก้อีกแล้ว · ที่แคบลงต้องตรงกับที่ประกาศไว้ (known_narrowing)', () => {
  const narrowed = PEOPLE.filter((p) => {
    if (hasAllUnits(ctxOf(p)) || p.resp_cost_centers.length) return false;   // ใบผ่าน/CC คุมแทน
    const before = new Set((p.sections.length ? p.sections : (p.section ? [p.section] : [])).map(s => s.toLowerCase()));
    const after = new Set(writeUnitsOf(ctxOf(p)).map(s => s.toLowerCase()));
    return [...before].some(s => !after.has(s));
  });
  const qa = narrowed.filter(p => p.role === 'qa');
  const other = narrowed.filter(p => p.role !== 'qa').map(p => p.acct).sort();
  /* QA ที่ sections = ส่วนงานที่ไปตรวจ: จอคุณภาพครอบด้วย qaWriteCtx (ด่าน E) ⇒ ยอมรับโดยไม่ต้องประกาศรายชื่อ */
  assert.deepEqual(other, [...REG._meta.known_narrowing.accts].sort(),
    `บัญชี (ไม่ใช่ qa) ที่เขียนแคบลงจากเดิม ต้องเท่ากับที่ประกาศใน fixture._meta.known_narrowing (migration §6 ย้ายให้เป็น CC)`);
  assert.ok(qa.length <= 13, `qa ที่แคบลงมากกว่าวันวัด (13): ${qa.length}`);
});

test('🔴 E — คนฝ่ายคุณภาพ (บ้าน QA ไม่มีไลน์ผลิต) ยังแก้งานคุณภาพของทุกไลน์ได้ผ่าน qaWriteCtx แม้ไม่มีใบผ่านแล้ว', () => {
  const lines = [{ name: 'L1', section: 'PD3' }, { name: 'L2', section: 'PD1' }];
  const qa = PEOPLE.filter(p => p.role === 'qa' && p.section === 'QA');
  assert.ok(qa.length >= 10, `บัญชี qa น้อยผิดปกติ (${qa.length})`);
  for (const p of qa) {
    const base = ctxOf(p);
    assert.equal(hasAllUnits(base), false, `${tag(p)} ไม่ควรถือใบผ่านจาก role`);
    const w = qaWriteCtx(base, lines);
    assert.equal(canWriteUnit(w, 'PD1').ok, true, `${tag(p)} จอคุณภาพต้องยังแก้ได้ทุกไลน์`);
    assert.equal(canWriteUnit(base, 'PD1').ok, false, `${tag(p)} นอกจอคุณภาพต้องแก้ได้แค่บ้าน`);
  }
});

test('F — มอบหมายรักษาการใน fixture ขยาย writeUnits จริง (ไม่ใช่แค่ sections)', () => {
  const withAssign = REG.assignments.filter(a => a.scope_depth !== 'all' && a.section_key);
  assert.ok(withAssign.length >= 3, 'fixture ต้องมีมอบหมายจริงอย่างน้อย 3 แถว');
  for (const a of withAssign) {
    const p = REG.profiles.find(x => x.acct === a.acct);
    if (!p) continue;
    assert.equal(canWriteUnit(ctxOf(p), a.section_key).ok, true, `${tag(p)} ต้องแก้หน่วยที่ได้รับมอบ (${a.section_key}) ได้`);
  }
  // pure overlay ให้ผลเดียวกัน: บ้าน + หน่วยที่ได้รับมอบ
  const r = applyAssignments({ section: 'PD1', sections: ['PD1'], respCostCenters: [], allUnits: false },
    [{ id: 1, org_node_id: 'n2', kind: 'acting', scope_depth: 'unit', starts_on: null, ends_on: null }],
    { nodes: [{ id: 'n2', kind: 'section', code: 'PD2', name: 'PD2', parent_id: null }], ccIdx: { ccOfNode: () => null }, today: '2026-11-13' });
  assert.deepEqual(r.writeUnits, ['PD1', 'PD2']);
  assert.equal(r.allUnits, false);
  const rAll = applyAssignments({ section: 'PD1', sections: ['PD1'], respCostCenters: [], allUnits: false },
    [{ id: 1, org_node_id: 'n2', kind: 'acting', scope_depth: 'all', starts_on: null, ends_on: null }],
    { nodes: [{ id: 'n2', kind: 'section', code: 'PD2', name: 'PD2', parent_id: null }], ccIdx: { ccOfNode: () => null }, today: '2026-11-13' });
  assert.equal(rAll.allUnits, true, 'รักษาการทั้งโรงงาน = ใบผ่านชั่วคราว');
});
