/* ═══ 🩺 /add-user — จัดกลุ่มงานค้างตามความรุนแรง (2026-11-03 · ประชุม 02/11 A6) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserIssues, issueSummaryText, USER_ISSUES, SEV_FIX, SEV_INFO, issueDef, issueLine } from '../userIssues.js';

test('ทุกกองในทะเบียนมีประโยค "ผิดอะไร" + "ทางแก้" ครบ และคีย์ไม่ซ้ำ', () => {
  const keys = new Set();
  for (const d of USER_ISSUES) {
    assert.ok(d.what && d.fix && d.chip, d.key);
    assert.ok([SEV_FIX, SEV_INFO].includes(d.sev), d.key);
    assert.ok(!keys.has(d.key), `ซ้ำ ${d.key}`);
    keys.add(d.key);
  }
});

test('ขอบเขตที่มีผลกับสิทธิ์จริง = ต้องแก้ · ค่าเก่าค้าง/คนละตำแหน่ง = ข้อมูลประกอบ', () => {
  for (const k of ['toowide', 'ghost', 'unknown', 'unlinked', 'review']) assert.equal(issueDef(k).sev, SEV_FIX, k);
  for (const k of ['mismatch', 'fallback', 'dual']) assert.equal(issueDef(k).sev, SEV_INFO, k);
});

test('รายคน: เรียง "ต้องแก้" ก่อน "ข้อมูลประกอบ" · ไม่ซ้ำ · มี detail ต่อท้าย', () => {
  const r = buildUserIssues({
    dual: ['u1'],
    review: ['u1', 'u1'],
    fallback: [{ id: 'u1', detail: 'ทีม/ไลน์' }],
    mismatch: ['u2'],
  });
  assert.deepEqual(r.byUser.u1.map(i => i.key), ['review', 'fallback', 'dual']);
  assert.match(r.byUser.u1[1].line, /\(ทีม\/ไลน์\) →/);
  assert.equal(r.fixUsers, 1);
  assert.equal(r.infoUsers, 1, 'u2 มีแต่ข้อมูลประกอบ · u1 นับในฝั่งต้องแก้แล้ว');
  assert.equal(r.fixTotal, 1);
  assert.equal(r.infoTotal, 3);
  assert.deepEqual(r.groups.fix.map(g => [g.key, g.count]), [['review', 1]]);
  assert.deepEqual(r.groups.info.map(g => g.key), ['fallback', 'mismatch', 'dual']);
});

test('กองว่าง/ไม่รู้จัก/ค่าเพี้ยน ไม่ทำให้พัง และไม่โผล่เป็นกองว่าง', () => {
  const r = buildUserIssues({ ghost: [], whatever: ['x'], toowide: [null, '', undefined] });
  assert.deepEqual(r.groups, { fix: [], info: [] });
  assert.deepEqual(r.byUser, {});
  assert.deepEqual(buildUserIssues(undefined).groups, { fix: [], info: [] });
});

test('ข้อความสรุป: ศูนย์ต้องพูดว่าศูนย์ ห้ามคืนสตริงว่าง', () => {
  assert.equal(issueSummaryText({}), 'ไม่มีบัญชีที่ต้องแก้ · ไม่มีข้อมูลประกอบ');
  assert.equal(issueSummaryText({ fixUsers: 2, fixTotal: 3, infoTotal: 4, infoUsers: 1 }),
    'ต้องแก้ 2 บัญชี (3 เรื่อง) · ข้อมูลประกอบ 4 เรื่อง · 1 บัญชีมีแต่ข้อมูลประกอบ');
  assert.equal(issueLine(null), '');
});
