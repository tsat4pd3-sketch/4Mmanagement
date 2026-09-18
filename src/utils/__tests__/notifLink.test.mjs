/**
 * ปลายทางของแจ้งเตือน (กระดิ่ง + Web Push) — src/utils/notifLink.js
 * ที่มา 2026-09-16: ทีมงานแจ้ง "กระดิ่งบางอันกดเข้าไปในจุดที่แจ้งเตือนได้ แต่บางอันไม่ได้"
 * (ฐานจริง: ref_table = null 6,873 แถว = กดไม่ได้เลย) → เพิ่มคอลัมน์ `link` เป็นปลายทางตรง
 * `link` มาจาก DB = **ข้อมูล ไม่ใช่โค้ด** ⇒ ต้องกรองก่อน navigate เสมอ เทสนี้ล็อกกติกานั้นไว้
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeInternalPath, pagePathOf, notifTargetPath } from '../notifLink.js';

const ROUTES = { mtn_orders: '/mtn-repair', downtime_logs: '/daily-report' };

test('safeInternalPath: รับเฉพาะ path ภายใน', () => {
  assert.equal(safeInternalPath('/mtn-repair?mo=PRO-BM-1'), '/mtn-repair?mo=PRO-BM-1');
  assert.equal(safeInternalPath('/qa?tab=ncr#x'), '/qa?tab=ncr#x');
  assert.equal(safeInternalPath('  /pm-forecast?tab=due  '), '/pm-forecast?tab=due');
});

test('🔴 safeInternalPath: ปฏิเสธทุกทางที่พาออกนอกเว็บ', () => {
  for (const bad of [
    '//evil.example.com',              // protocol-relative — เบราว์เซอร์ตีเป็นเว็บนอก
    'https://evil.example.com',
    'javascript:alert(1)',
    'data:text/html,x',
    '/\\evil.example.com',             // backslash ถูกอ่านเป็น / ในบางเบราว์เซอร์
    'mtn-repair',                      // ไม่ขึ้นต้นด้วย /
    '', null, undefined, 0, {},
  ]) assert.equal(safeInternalPath(bad), null, `ต้องปฏิเสธ: ${String(bad)}`);
});

test('safeInternalPath: ":" ที่อยู่หลัง ? ไม่ใช่ scheme — ยังรับได้', () => {
  assert.equal(safeInternalPath('/order-trace?q=10:30'), '/order-trace?q=10:30');
});

test('pagePathOf: ตัด query/hash ก่อนส่งให้ canAccessPage', () => {
  assert.equal(pagePathOf('/qa?tab=ncr'), '/qa');
  assert.equal(pagePathOf('/pm#top'), '/pm');
  assert.equal(pagePathOf('/mtn-repair'), '/mtn-repair');
});

test('notifTargetPath: link ชนะ ref_table (deep-link ถึงตัวปัญหา)', () => {
  assert.equal(
    notifTargetPath({ link: '/mtn-repair?mo=abc', ref_table: 'mtn_orders' }, ROUTES),
    '/mtn-repair?mo=abc');
});

test('notifTargetPath: ไม่มี link ถอยไปหน้ารวมของ ref_table (ใบเก่าทั้งหมด)', () => {
  assert.equal(notifTargetPath({ ref_table: 'downtime_logs' }, ROUTES), '/daily-report');
  assert.equal(notifTargetPath({ ref_table: 'ไม่รู้จัก' }, ROUTES), null);
  assert.equal(notifTargetPath({}, ROUTES), null);
  assert.equal(notifTargetPath(null, ROUTES), null);
});

test('🔴 link ที่ไม่ปลอดภัย ต้องถอยไป ref_table ไม่ใช่พาออกนอกเว็บ', () => {
  assert.equal(
    notifTargetPath({ link: 'https://evil.example.com', ref_table: 'mtn_orders' }, ROUTES),
    '/mtn-repair');
  assert.equal(notifTargetPath({ link: '//evil.example.com' }, ROUTES), null);
});

test('🔴 ไม่มีสิทธิ์เข้าหน้า = ไม่พาไป (ห้ามพาไปแล้วโดนเด้งกลับหน้าแรก)', () => {
  const deny = () => false;
  assert.equal(notifTargetPath({ link: '/mtn-repair?mo=abc' }, ROUTES, deny), null);
  assert.equal(notifTargetPath({ ref_table: 'mtn_orders' }, ROUTES, deny), null);
  // เช็คสิทธิ์ต้องใช้ path ล้วน ไม่ใช่ทั้ง query (ไม่งั้น canAccessPage หาไม่เจอ = กดไม่ได้ทั้งที่มีสิทธิ์)
  const seen = [];
  notifTargetPath({ link: '/qa?tab=ncr' }, ROUTES, (p) => { seen.push(p); return true; });
  assert.deepEqual(seen, ['/qa']);
});
