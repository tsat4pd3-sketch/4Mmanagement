/**
 * ล็อก "map ที่มาของแจ้งเตือน → หน้าที่เปิดตอนกด" ให้ตรงกัน 2 ฝั่งเสมอ
 *
 * ที่มา (full QC audit 2026-09-02): `NOTIF_ROUTE` (กระดิ่งในแอป) กับ `routeFor()` (Web Push)
 * ต้อง mirror กัน — โค้ดทั้งสองฝั่งเขียนคอมเมนต์เตือนไว้แล้วว่า "แก้ฝั่งไหนให้ตามไปแก้อีกฝั่ง"
 * แต่ **ไม่มีอะไรบังคับ** → เวลาผ่านไป map เดิมรู้จักแค่ 4 ตาราง ขณะที่ระบบเขียน ref_table จริง 11 ค่า
 * ⇒ วัดจากฐานจริง: 1,194 แจ้งเตือนกดแล้วไม่ไปไหน (กระดิ่งไม่มีลูกศร › · Push เปิดหน้าแรก)
 *
 * เทสนี้อ่านซอร์สเป็น "ข้อความ" เพราะ App.jsx ลาก react+router มาทั้งก้อน import ตรงไม่ได้
 * (pattern เดียวกับ homeCoverage.test.mjs)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');
const push = readFileSync(new URL('../../../supabase/functions/send-push/index.ts', import.meta.url), 'utf8');

/** ดึงคู่ key: '/path' จากบล็อกที่ระบุ */
function pairs(src, startMarker) {
  const i = src.indexOf(startMarker);
  assert.ok(i > -1, `หาบล็อก ${startMarker} ไม่เจอ — โครงไฟล์เปลี่ยน ให้อัปเดตเทสนี้ด้วย`);
  const body = src.slice(i, src.indexOf('};', i));
  const out = {};
  for (const m of body.matchAll(/^\s*([a-z_0-9]+)\s*:\s*'([^']+)'/gm)) out[m[1]] = m[2];
  return out;
}

const bell = pairs(app, 'const NOTIF_ROUTE = {');
const web = pairs(push, 'const ROUTES: Record<string, string> = {');

test('NOTIF_ROUTE (กระดิ่ง) กับ routeFor (Web Push) ต้องมีคีย์ชุดเดียวกัน', () => {
  assert.deepEqual(Object.keys(bell).sort(), Object.keys(web).sort());
});

test('ปลายทางของแต่ละ ref_table ต้องตรงกันทั้ง 2 ฝั่ง', () => {
  for (const k of Object.keys(bell)) assert.equal(bell[k], web[k], `ref_table "${k}" ชี้คนละหน้า`);
});

test('ครอบ ref_table ที่มีแถวจริงในฐานครบ (วัด 2026-09-02)', () => {
  // ตารางที่ `notifications.ref_table` มีแถวจริงแล้ว — ขาดตัวไหน = แจ้งเตือนนั้นกดไม่ได้
  // (`user_feedback` ไม่มี route โดยตั้งใจ — กล่องขาเข้าเป็นโมดัลใน sidebar ไม่มีหน้าเป็นของตัวเอง)
  for (const t of ['four_m_logs', 'mtn_orders', 'downtime_logs', 'shift_schedules',
    'defect_logs', 'skill_level_up_requests', 'ojt_trainings', 'improvements',
    'cqi15_event_logs', 'inspections'])
    assert.ok(bell[t], `ref_table "${t}" มีแถวจริงในฐานแต่ยังไม่มีปลายทาง`);
});

test('ปลายทางต้องขึ้นต้นด้วย / และไม่ชี้หน้าแรกเปล่าๆ', () => {
  for (const [k, v] of Object.entries(bell)) {
    assert.ok(v.startsWith('/'), `${k} → "${v}" ต้องเป็น path`);
    assert.notEqual(v, '/', `${k} ชี้หน้าแรก = เท่ากับไม่มี route`);
  }
});

/* ══ ปลายทางของแจ้งเตือน "สรุป" (notification_rules.link) — 2026-09-16 ═══════════════════════
 * feedback ทีมงานผ่าน user: "กระดิ่งบางอันกดเข้าไปในจุดที่แจ้งเตือนได้ แต่บางอันไม่ได้"
 * วัดจากฐาน 16/09: ref_table = null **6,873 แถว และยังเกิดใหม่ทุกวัน** (หลุดเฟสงานส่ง 5,489 ·
 * เตือนรอบ PM 379 · ส่งงานลูกค้า 338 · เฝ้าระวังสโตร์ 326 · EDI 156 · แผนประสานงาน PM 131)
 * — ทุกก้อนออกจาก notifyInApp() ใน edge ซึ่งไม่เคยส่ง ref_table/link เลย ⇒ กดแล้วไม่ไปไหน
 *
 * ⚠️ ปลายทางพวกนี้ **ไม่ได้อยู่ในโค้ด edge** — อยู่ที่ `notification_rules.link` (data-driven)
 *    แล้ว trigger `trg_notification_fill_link` เติมให้ตอน insert
 *    เหตุผล: `send-notification/index.ts` = 59 KB · `qa-fme-scan` = 53 KB ซึ่ง
 *    `docs/modules/edge-functions.md` ห้าม deploy ผ่าน MCP (ต้องพิมพ์ทั้งไฟล์ซ้ำ) และ user ไม่มี CLI
 * เทสนี้อ่าน **ไฟล์ migration** (= สิ่งที่ apply ลงฐานจริง) กันปลายทางพิมพ์ผิด/ชี้หน้าที่ถูกลบ
 */
const APP_ROUTES = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1]));
const ruleLinkSql = readFileSync(
  new URL('../../../supabase/migrations/20260916_notification_rules_link.sql', import.meta.url), 'utf8');
/** คู่ ('event_key', '/path') ในบล็อก values(...) ของ migration */
const RULE_LINKS = [...ruleLinkSql.matchAll(/\(\s*'([a-z_0-9]+)',\s*'(\/[^']*)'\)/g)].map(m => [m[1], m[2]]);

test('🔴 notification_rules.link ทุกค่าต้องชี้ route ที่มีจริงใน App.jsx', () => {
  assert.ok(RULE_LINKS.length >= 20, `seed link เหลือ ${RULE_LINKS.length} รายการ — น้อยผิดปกติ (เดิม 25)`);
  for (const [key, path] of RULE_LINKS) {
    assert.ok(APP_ROUTES.has(path.split('?')[0]),
      `notification_rules.link ของ "${key}" → "${path}" ไม่มีใน <Route> ของ App.jsx (พิมพ์ผิด/หน้าถูกลบ?)`);
  }
});

test('🔴 ทุก event ที่ยิง notifyInApp ใน send-notification ต้องมีปลายทางใน seed', () => {
  const src = readFileSync(new URL('../../../supabase/functions/send-notification/index.ts', import.meta.url), 'utf8');
  const links = new Map(RULE_LINKS);
  const called = [...src.matchAll(/notifyInApp\(routes,\s*'([a-z_0-9]+)'/g)].map(m => m[1]);
  assert.ok(called.length >= 14, `เจอ call notifyInApp แค่ ${called.length} จุด — regex เพี้ยนหรือโครงเปลี่ยน`);
  for (const ev of new Set(called)) {
    assert.ok(links.has(ev), `event "${ev}" ยิงแจ้งเตือนในแอปแต่ไม่มีปลายทางใน notification_rules.link ⇒ กระดิ่งกดไม่ได้`);
  }
});

test('ปลายทางใน NOTIF_ROUTE ต้องเป็น route ที่มีจริงเช่นกัน', () => {
  for (const [k, v] of Object.entries(bell)) {
    assert.ok(APP_ROUTES.has(v.split('?')[0]), `NOTIF_ROUTE.${k} → "${v}" ไม่มีใน <Route> ของ App.jsx`);
  }
});
