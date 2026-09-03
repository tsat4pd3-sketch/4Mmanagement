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
