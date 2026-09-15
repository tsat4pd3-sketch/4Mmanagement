import test from 'node:test';
import assert from 'node:assert/strict';
import { KIOSK_PATHS, isKioskPath } from '../kioskRoutes.js';

/* กันการกลับไปเป็นบั๊กเดิม: จอห้องช่างที่ login ด้วยบัญชีคน (role supervisor/mtn)
   โดน idle-logout ทุก 35 นาที เพราะไม่มีใครเดินไปแตะจอ (2026-09-14) */

test('/tv คือจอแขวน — ไม่ว่าจะเขียน path มาแบบไหน', () => {
  assert.equal(isKioskPath('/tv'), true);
  assert.equal(isKioskPath('/tv/'), true);      // trailing slash จากบุ๊กมาร์ก
  assert.equal(isKioskPath('/TV'), true);       // บางจอพิมพ์ URL เอง
  assert.equal(isKioskPath('/tv?dept=maintenance&sound=all'), true); // เผื่อส่ง url เต็มมา
});

test('หน้าที่มีปุ่มเขียนข้อมูลต้องไม่ถูกนับเป็นจอแขวน', () => {
  for (const p of ['/', '/checkin', '/daily-report', '/mtn-repair', '/dept-dashboard', '/factory-map', '/tvx', '/x/tv']) {
    assert.equal(isKioskPath(p), false, `${p} ต้องไม่ใช่ kiosk`);
  }
});

test('ค่าที่ไม่ใช่ string ต้องไม่ระเบิด (pathname หายระหว่าง render)', () => {
  for (const v of [undefined, null, '', 0, {}, []]) assert.equal(isKioskPath(v), false);
});

test('ลิสต์ kiosk ต้องสั้นและแก้ไม่ได้ — เพิ่มหน้าใหม่ต้องตั้งใจ + อ่านกฎในไฟล์ก่อน', () => {
  assert.ok(Object.isFrozen(KIOSK_PATHS));
  assert.deepEqual([...KIOSK_PATHS], ['/tv']);
});
