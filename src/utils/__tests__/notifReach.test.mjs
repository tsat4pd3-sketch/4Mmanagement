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

test('🔴 inapp_scope_strict = ผจก./admin ถูกกรองตามส่วนงานเหมือนคนอื่น (21/09)', () => {
  // ที่มา: ผจก. 4 คนได้ 50 แถว/วัน อ่านรวมกัน 2 จาก 2,920 เพราะ notify_recipients
  // ยกเว้น admin/manager จากตัวกรองส่วนงานเสมอ · ธงนี้ปิดข้อยกเว้นเป็นรายกฎ
  const rule = { inapp_roles: ['supervisor', 'manager'], inapp_match_section: true, inapp_scope_strict: true };
  const r = reachOf(rule, raw({ people_all: 20, people_admin_mgr: 4, people_no_section: 2 }));
  assert.equal(r.strict, true);
  assert.equal(r.alwaysThrough, 2);              // เหลือแค่คนที่ยังไม่ได้ตั้งส่วนงาน (admin/ผจก. ไม่นับแล้ว)
  assert.equal(r.perEvent, 2 + Math.round((20 - 2) / 5));
  // คำเตือนต้องไม่พูดถึง "admin/ผจก. ระบบยกเว้นให้เสมอ" อีก แต่ยังเตือนเรื่องคนไม่มีส่วนงาน
  const w = reachWarnings(rule, raw({ people_all: 20, people_admin_mgr: 4, people_no_section: 2 }));
  assert.ok(!w.some(x => x.text.includes('ยกเว้นให้เสมอ')));
  assert.ok(w.some(x => x.text.includes('ยังไม่ได้ตั้งส่วนงาน')));
});

test('ไม่ตั้ง strict = พฤติกรรมเดิมเป๊ะ (ค่า default ห้ามเปลี่ยนความหมายของกฎเก่า)', () => {
  const base = { inapp_roles: ['supervisor', 'manager'], inapp_match_section: true };
  const a = reachOf(base, raw({ people_all: 20, people_admin_mgr: 4, people_no_section: 2 }));
  const b = reachOf({ ...base, inapp_scope_strict: false }, raw({ people_all: 20, people_admin_mgr: 4, people_no_section: 2 }));
  assert.equal(a.alwaysThrough, 6);
  assert.deepEqual(a, b);
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

/* ── 🗑️ ความเสียเปล่า — "ยิงผิดคน" ต่างจาก "อ่านน้อย" (2026-09-23) ──────────────────
   รูทคอสที่วัดได้: 64% ของแถวทั้งระบบส่งให้คนที่ไม่เคยเปิดอ่านเลยสักใบใน 30 วัน
   และคนกลุ่มนั้นไม่ใช่บัญชีร้าง (login สัปดาห์นี้) ⇒ เขาไม่ใช่คนที่ต้องลงมือ */
test('เตือนแดงเมื่อเกินครึ่งถูกส่งให้คนที่ไม่เคยเปิดอ่านเรื่องนี้เลย', () => {
  const rule = { inapp_roles: ['supervisor'], inapp_match_section: true };
  const raw = { people_all: 22, rows_n: 1000, read_n: 40, waste_n: 860, dead_n: 16, days_n: 30, events_n: 50, n_sections: 4 };
  const r = reachOf(rule, raw);
  assert.equal(r.wastePct, 86);
  assert.equal(r.deadUsers, 16);
  const w = reachWarnings(rule, raw);
  assert.ok(w.some(x => x.level === 'red' && /ไม่เคยเปิดอ่าน/.test(x.text)), 'ต้องมีคำเตือนแดงเรื่องยิงผิดคน');
  // ห้ามขึ้นคำเตือน "อ่านน้อย" ซ้ำอีกใบ — ข้อความเดียวที่ชี้ต้นเหตุตรงกว่าพอแล้ว
  assert.equal(w.filter(x => /คนเปิดอ่าน \d+%/.test(x.text)).length, 0);
});

test('ข้อมูลน้อยเกินไป ห้ามสรุปว่าเสียเปล่า (กฎความซื่อสัตย์ของจอ)', () => {
  const rule = { inapp_roles: ['qa'] };
  const r = reachOf(rule, { people_all: 20, rows_n: 5, read_n: 0, waste_n: 5, dead_n: 3, days_n: 14 });
  assert.equal(r.wastePct, null, 'ต่ำกว่าเกณฑ์ขั้นต่ำต้องคืน null ไม่ใช่ 100');
  assert.equal(reachWarnings(rule, { people_all: 20, rows_n: 5, waste_n: 5, dead_n: 3, days_n: 14 })
    .filter(x => /ไม่เคยเปิดอ่าน/.test(x.text)).length, 0);
});

test('RPC รุ่นเก่าไม่คืน waste_n ก็ต้องไม่พัง (จอ fallback เป็น 0)', () => {
  const r = reachOf({ inapp_roles: ['mtn'] }, { people_all: 15, rows_n: 500, read_n: 50, days_n: 14 });
  assert.equal(r.waste, 0);
  assert.equal(r.wastePct, 0);
});
