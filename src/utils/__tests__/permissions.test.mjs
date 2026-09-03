/**
 * เทสโค้ดจริงของ src/utils/permissions.js — กติกาที่ห้าม regress:
 *   1. bucket dept_admin ปลดล็อกได้เฉพาะ action ห้ามปลดล็อก page:* (แม้ seed หลุดมา)
 *   2. pagination ของ loadPermissions ต้องได้ครบทุกหน้า (>1000 แถว + order ครบคีย์)
 *   3. fail-closed: role ที่ไม่มีแถว = เข้าไม่ได้ · admin bypass เสมอ
 *   4. canDelete fallback · Daily Checker piggyback
 * เคสอ้างอิงจริง: แอดมินหน่วยงาน MTN ตั้งกะหน่วยงานตัวเอง (feedback 2026-08-19)
 *
 * permissions.js import supabaseClient (พึ่ง import.meta.env) → เทสตรงใน node ไม่ได้
 * จึง bundle ด้วย rolldown + stub client ที่เสิร์ฟ matrix จำลองจาก globalThis.__FAKE_ROWS
 * (stub จำลองพฤติกรรม PostgREST: sort ตาม order แล้วตัดช่วงตาม range)
 * รัน: node --test src/utils/__tests__/permissions.test.mjs  (จาก root โปรเจค)
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const STUB = `
export const supabase = {
  from(table) {
    if (table !== 'role_permissions') throw new Error('unexpected table: ' + table);
    const q = {
      _from: 0, _to: 999,
      select() { return q; },
      order() { return q; },
      range(from, to) { q._from = from; q._to = to; return q; },
      then(resolve) {
        const all = globalThis.__FAKE_ROWS || [];
        const sorted = [...all].sort((a, b) =>
          a.role.localeCompare(b.role) || a.permission_key.localeCompare(b.permission_key));
        resolve({ data: sorted.slice(q._from, q._to + 1), error: null });
      },
    };
    return q;
  },
};
export const supabaseDR = supabase;
`;

let mod;
before(async () => {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({
    input: 'src/utils/permissions.js',
    plugins: [{
      name: 'stub-supabase',
      resolveId(id) { return /supabaseClient$/.test(id) ? '\0stub' : null; },
      load(id) { return id === '\0stub' ? STUB : null; },
    }],
  });
  const out = join(tmpdir(), `permissions-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });

  // matrix จำลอง: สภาพหลัง apply 20260819_shift_organize_mtn_page_main
  const rows = [
    { role: 'admin',      permission_key: 'page:/shift-organize', allowed: true },
    { role: 'manager',    permission_key: 'page:/shift-organize', allowed: true },
    { role: 'supervisor', permission_key: 'page:/shift-organize', allowed: true },
    { role: 'mtn',        permission_key: 'page:/shift-organize', allowed: true },
    { role: 'qa',         permission_key: 'page:/shift-organize', allowed: false },
    { role: 'manager',    permission_key: 'shift_schedule:edit',   allowed: true },
    { role: 'mtn',        permission_key: 'shift_schedule:edit',   allowed: false },
    { role: 'dept_admin', permission_key: 'shift_schedule:edit',   allowed: true },
    { role: 'dept_admin', permission_key: 'shift_schedule:delete', allowed: true },
    { role: 'mtn',        permission_key: 'shift_schedule:delete', allowed: false },
    // page:* ที่ seed enum_range แจกหลุดเข้า bucket — โค้ดต้องบล็อกเอง
    { role: 'dept_admin', permission_key: 'page:/org-setup',       allowed: true },
    { role: 'mtn',        permission_key: 'page:/daily-pm',        allowed: true },
    // หน้าหมวด Logistic — ใช้เทสด่านฝั่งงาน (ชั้น 3 · 2026-09-04)
    { role: 'sale',       permission_key: 'page:/line-stock',      allowed: true },
    { role: 'sale',       permission_key: 'page:/customer-demand', allowed: true },
    { role: 'sale',       permission_key: 'page:/store-monitor',   allowed: true },
    { role: 'sale',       permission_key: 'page:/planner-sales',   allowed: true },
    { role: 'qa',         permission_key: 'page:/line-stock',      allowed: false },
  ];
  // แถวถ่วง 2300 แถว → pagination ต้องวิ่ง 3 หน้า · role 'display' เรียงกลางลิสต์
  // ทำให้แถว manager/mtn/qa/supervisor ถูกดันไปหน้า 2-3 — ถ้า pagination พังเทสล้มทันที
  for (let i = 0; i < 2300; i++) {
    rows.push({ role: 'display', permission_key: `zpad:${String(i).padStart(5, '0')}`, allowed: false });
  }
  globalThis.__FAKE_ROWS = rows;

  mod = await import(pathToFileURL(out).href);
  const m = await mod.loadPermissions();
  assert.ok(m.size > 2300, `cache ต้องได้ครบทุกหน้า (ได้ ${m.size})`);
});

test('mtn ธรรมดา: เข้าหน้าตารางกะได้ แต่แก้/ลบไม่ได้ (ดูอย่างเดียว)', () => {
  mod.setDeptAdmin(false);
  assert.equal(mod.canAccessPage('/shift-organize', 'mtn'), true);
  assert.equal(mod.can('shift_schedule', 'edit', 'mtn'), false);
  assert.equal(mod.canDelete('shift_schedule', 'edit', 'mtn'), false);
});

test('mtn + แอดมินหน่วยงาน: แก้/ลบกะได้ผ่าน bucket dept_admin', () => {
  mod.setDeptAdmin(true);
  assert.equal(mod.canAccessPage('/shift-organize', 'mtn'), true);
  assert.equal(mod.can('shift_schedule', 'edit', 'mtn'), true);
  assert.equal(mod.canDelete('shift_schedule', 'edit', 'mtn'), true);
  mod.setDeptAdmin(false);
});

test('bucket ห้ามปลดล็อกหน้า — page:* ที่หลุดเข้า bucket ต้องถูกบล็อกในโค้ด', () => {
  mod.setDeptAdmin(true);
  assert.equal(mod.canAccessPage('/org-setup', 'mtn'), false);
  mod.setDeptAdmin(false);
});

test('fail-closed: role ที่ปิด/ไม่มีแถว เข้าไม่ได้ · admin bypass เสมอ', () => {
  assert.equal(mod.canAccessPage('/shift-organize', 'qa'), false);
  assert.equal(mod.canAccessPage('/shift-organize', 'planner_store'), false);
  assert.equal(mod.canAccessPage('/shift-organize', 'admin'), true);
  assert.equal(mod.can('shift_schedule', 'edit', 'admin'), true);
});

test('Daily Checker piggyback: เข้าได้ผ่านสิทธิ์แท็บใดแท็บหนึ่ง', () => {
  assert.equal(mod.canAccessPage('/daily-checker', 'mtn'), true);
});

test('pagination: แถวที่ถูกดันไปหน้าท้ายๆ (>2000 แถว) ต้องไม่หลุดจาก cache', () => {
  assert.equal(mod.canAccessPage('/shift-organize', 'supervisor'), true);
});

/* ═══ ด่านฝั่งงาน Logistic (ชั้น 3 · 2026-09-04) — ชั้น "จำกัดเพิ่ม" ทับสิทธิ์ role ═══ */
test('ฝั่งงาน: ไม่ตั้งฝั่ง = เห็นครบตาม role (บัญชีเดิมไม่เสียอะไรตอน deploy)', () => {
  mod.registerPageSides(new Map([
    ['/line-stock', ['inbound']], ['/customer-demand', ['outbound']],
    ['/store-monitor', ['inbound', 'outbound']], ['/planner-sales', ['control']],
  ]));
  mod.setUserSides([]);
  for (const p of ['/line-stock', '/customer-demand', '/store-monitor', '/planner-sales']) {
    assert.equal(mod.canAccessPage(p, 'sale'), true, p);
  }
});

test('ฝั่งงาน: คน Store (inbound) เห็นเฉพาะขาเข้า + หน้าที่คาบ 2 ฝั่ง · ไม่เห็นขาออก/แผนงาน', () => {
  mod.setUserSides(['inbound']);
  assert.equal(mod.canAccessPage('/line-stock', 'sale'), true);
  assert.equal(mod.canAccessPage('/store-monitor', 'sale'), true, 'เฝ้าระวังสต๊อกคาบ 2 ฝั่ง');
  assert.equal(mod.canAccessPage('/customer-demand', 'sale'), false, 'จัดส่งลูกค้าเป็นของ Warehouse/Delivery');
  assert.equal(mod.canAccessPage('/planner-sales', 'sale'), false);
  // หน้าหมวดอื่นไม่ถูกกรองด้วยฝั่ง
  assert.equal(mod.canAccessPage('/shift-organize', 'supervisor'), true);
  mod.setUserSides([]);
});

test('ฝั่งงาน: ไม่เคยเปิดหน้าที่ role ไม่มีสิทธิ์ · admin bypass เสมอแม้ตั้งฝั่ง', () => {
  mod.setUserSides(['inbound']);
  assert.equal(mod.canAccessPage('/line-stock', 'qa'), false, 'qa ไม่มีสิทธิ์หน้า — ฝั่งช่วยไม่ได้');
  assert.equal(mod.canAccessPage('/customer-demand', 'admin'), true, 'admin ต้องไม่โดนล็อกตัวเองด้วยฝั่ง');
  mod.setUserSides([]);
});
