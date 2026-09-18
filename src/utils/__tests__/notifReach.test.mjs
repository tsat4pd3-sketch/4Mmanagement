/**
 * ป้ายราคาของกฎแจ้งเตือน — src/utils/notifReach.js
 * ที่มา 2026-09-17 (คำสั่ง user "ป้ายราคาโชว์ตอนเลือกติ๊กคอนฟิค จะได้รู้"):
 * เหตุการณ์จริง ~69/วัน แต่กลายเป็น 3,844 แถว/วัน เพราะตัวคูณผู้รับเฉลี่ย 56 คน
 * (ใบซ่อม 99 คน/ใบ) · คนอ่าน 8% · 19/41 กฎไม่กรองส่วนงานเลย · ระบุส่วนงานเอง 0 กฎ
 * เทสนี้ล็อกสูตร + เกณฑ์เตือน ไม่ให้เพี้ยนจนป้ายราคาชี้ทางผิด
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachOf, reachWarnings, reachLabel, WIDE_AUDIENCE, MIN_ROWS_FOR_READ } from '../notifReach.js';

const raw = (o = {}) => ({
  people_all: 54, people_no_section: 13, people_admin_mgr: 0,
  n_sections: 5, rows_n: 42000, read_n: 3000, events_n: 434, days_n: 14, ...o,
});

test('ไม่กรองส่วนงาน = ทุกคนที่ role ตรงได้รับทุกครั้ง', () => {
  const r = reachOf({ inapp_roles: ['supervisor'] }, raw());
  assert.equal(r.perEvent, 54);
  assert.equal(r.scoped, false);
});

test('🔴 กรองตามส่วนงาน: คนที่ไม่มี section + admin/ผจก. ยังได้รับทุกส่วนงาน', () => {
  // เกิดจริง: ช่างซ่อม 13/13 คนไม่มี section (ใช้ mtn_teams แทน) ⇒ ตัวกรองไม่มีผลกับกลุ่มนี้
  const r = reachOf({ inapp_roles: ['supervisor', 'leader', 'mtn'], inapp_match_section: true }, raw());
  assert.equal(r.alwaysThrough, 13);
  assert.equal(r.perEvent, 13 + Math.round((54 - 13) / 5));   // 13 + 8 = 21
  assert.ok(reachWarnings({ inapp_roles: ['mtn'], inapp_match_section: true }, raw())
    .some(w => w.text.includes('ยังไม่ได้ตั้งส่วนงาน')));
});

test('admin/ผจก. ถูกยกเว้นจากตัวกรองเสมอ — ต้องนับเป็น "ผ่านเสมอ"', () => {
  const r = reachOf({ inapp_roles: ['admin', 'manager'], inapp_match_section: true },
    raw({ people_all: 7, people_admin_mgr: 7, people_no_section: 3 }));
  assert.equal(r.alwaysThrough, 7);      // ตัดที่ people_all ไม่บวกซ้ำ
  assert.equal(r.perEvent, 7);
});

test('ระบุส่วนงาน/แผนกเอง = ประมาณไม่ได้ → null (ห้ามเดาเป็นตัวเลข)', () => {
  const r = reachOf({ inapp_roles: ['supervisor'], inapp_sections: ['PD1'] }, raw());
  assert.equal(r.perEvent, null);
  assert.match(reachLabel({ inapp_roles: ['supervisor'], inapp_sections: ['PD1'] }, raw()), /≤ 54 คน/);
});

test('🔴 ประวัติน้อยเกิน = ไม่สรุป % อ่าน (ห้ามบอกว่า "ไม่มีคนอ่าน" ทั้งที่เพิ่งเปิดใช้)', () => {
  const r = reachOf({ inapp_roles: ['qa'] }, raw({ rows_n: MIN_ROWS_FOR_READ - 1, read_n: 0 }));
  assert.equal(r.readPct, null);
  assert.equal(r.thin, true);
  assert.ok(!reachWarnings({ inapp_roles: ['qa'] }, raw({ rows_n: 5, read_n: 0, people_all: 5 }))
    .some(w => w.text.includes('เปิดอ่าน')));
});

test('ไม่เคยเกิดเหตุการณ์ = เขียนว่ายังไม่มีสถิติ ห้ามโชว์ 0 แจ้งเตือน/วัน', () => {
  const s = reachLabel({ inapp_roles: ['qa'] }, raw({ events_n: 0, rows_n: 0, read_n: 0 }));
  assert.match(s, /ยังไม่มีสถิติ/);
  assert.ok(!/0 แจ้งเตือน\/วัน/.test(s));
});

test('ยังไม่เลือก role = บอกตรงๆ ว่าไม่เข้ากระดิ่ง และไม่เตือนอะไร', () => {
  assert.match(reachLabel({ inapp_roles: [] }, raw()), /ไม่เข้ากระดิ่ง/);
  assert.deepEqual(reachWarnings({ inapp_roles: [] }, raw()), []);
});

test('ผู้รับกว้างเกิน + ไม่กรอง = เตือนแดง', () => {
  const w = reachWarnings({ inapp_roles: ['supervisor', 'leader'] }, raw({ people_all: WIDE_AUDIENCE + 1 }));
  assert.equal(w[0].level, 'red');
  assert.ok(w[0].text.includes('ทุกแผนกได้รับหมด'));
});

test('ป้ายราคาเต็มรูปแบบอ่านรู้เรื่อง', () => {
  const s = reachLabel({ inapp_roles: ['supervisor', 'leader', 'mtn'], inapp_match_section: true }, raw());
  assert.match(s, /≈ 21 คน\/ครั้ง/);
  assert.match(s, /เกิด 31 ครั้ง\/วัน/);
  assert.match(s, /651 แจ้งเตือน\/วัน/);
  assert.match(s, /เปิดอ่าน 7%/);
});

test('raw หาย (RPC ไม่คืนแถวของ event นี้) = ไม่ throw', () => {
  assert.doesNotThrow(() => reachLabel({ inapp_roles: ['qa'] }, null));
  assert.doesNotThrow(() => reachWarnings({ inapp_roles: ['qa'] }, undefined));
  assert.doesNotThrow(() => reachOf(null, null));
});
