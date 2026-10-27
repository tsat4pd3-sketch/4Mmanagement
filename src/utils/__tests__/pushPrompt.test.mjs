/* pushPrompt — กฎของแถบ "เปิดแจ้งเตือนเข้ามือถือ" (2026-10-20)
   เน้นคลาสที่พลาดแล้วจอโกหก: ตรวจไม่ได้ ≠ ยังไม่เปิด · เปิดแล้วห้ามรบกวน · อ่าน RPC ไม่ได้ห้ามโชว์ 0 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pushPromptCopy, pushCoverageFailText, snoozeUntil, isSnoozed, readSnooze,
  SNOOZE_KEY, SNOOZE_DAYS,
} from '../pushPrompt.js';

test('เปิดแล้ว / ไม่รองรับ / ค่าแปลก = ไม่วาดแถบ (ห้ามรบกวน)', () => {
  for (const st of ['subscribed', 'unsupported', undefined, null, '', 'อะไรก็ไม่รู้']) {
    assert.equal(pushPromptCopy(st), null, String(st));
  }
});

test('ยังไม่เปิด = ชวนเปิด + มีปุ่ม', () => {
  for (const st of ['default', 'unsubscribed']) {
    const c = pushPromptCopy(st);
    assert.equal(c.cta, 'เปิด', st);
    assert.match(c.text, /ยังไม่เปิดแจ้งเตือน/);
    assert.match(c.text, /ไม่เด้งบนมือถือ/);      // ต้องบอกผลที่ตามมา ไม่ใช่แค่สถานะ
  }
});

test('ลงทะเบียนหลุด (stale) = เตือน + ปุ่ม "เปิดใหม่" (คนเคยเปิดแล้ว ต้องรู้ว่าหลุด)', () => {
  const c = pushPromptCopy('stale');
  assert.equal(c.tone, 'warn');
  assert.equal(c.cta, 'เปิดใหม่');
  assert.match(c.text, /หลุด/);
});

test('🔴 ตรวจไม่ได้ (check-failed) ต้องบอกว่า "ยังไม่ทราบ" · ห้ามบอกว่า "ยังไม่เปิด" และห้ามมีปุ่มเปิด', () => {
  const c = pushPromptCopy('check-failed');
  assert.equal(c.cta, null, 'ปุ่มเปิดตอนที่ยังไม่รู้สถานะ = ชวนให้กดมั่ว');
  assert.match(c.text, /ยังไม่ทราบ/);
  assert.ok(!/ยังไม่เปิดแจ้งเตือน/.test(c.text), 'จอโกหก: ตรวจไม่ได้ ≠ ยังไม่เปิด');
});

test('เบราว์เซอร์บล็อก / iOS ยังไม่ติดตั้ง = บอกวิธีแก้ที่เครื่อง ไม่มีปุ่ม (กดไปก็ไม่ช่วย)', () => {
  for (const st of ['denied', 'ios-need-install']) {
    const c = pushPromptCopy(st);
    assert.equal(c.cta, null, st);
    assert.ok(c.text.length > 20, st);
  }
  assert.match(pushPromptCopy('ios-need-install').text, /หน้าจอโฮม/);
  assert.match(pushPromptCopy('denied').text, /ตั้งค่าเบราว์เซอร์/);
});

test('ข้อความ error ของ RPC แยก "ไม่มีสิทธิ์" ออกจาก "ยังไม่ apply migration"', () => {
  assert.match(pushCoverageFailText({ code: '42501' }), /ไม่มีสิทธิ์/);
  for (const code of ['PGRST202', '42883']) {
    assert.match(pushCoverageFailText({ code }), /migration/, code);
  }
  assert.match(pushCoverageFailText({ message: 'network down' }), /network down/);
  assert.match(pushCoverageFailText(null), /ไม่ทราบสาเหตุ/);   // error ว่าง = ยังต้องมีข้อความ
});

/* ⏱️ เวลาต้องรับเข้ามาเป็นพารามิเตอร์ ไม่ใช่อ่าน Date.now() ข้างใน
   (ด่าน "นาฬิกา +400 วัน" ของ npm test จับเทสระเบิดเวลา) */
test('พัก 3 วัน — คิดจาก now ที่ส่งเข้ามา และหมดอายุเองตามเวลา', () => {
  const t0 = 1_700_000_000_000;
  const until = snoozeUntil(t0);
  assert.equal(until, t0 + SNOOZE_DAYS * 86400_000);
  assert.equal(isSnoozed(t0), readSnooze() > t0);
  // ไม่มี localStorage ใน node ⇒ readSnooze ต้องคืน 0 ไม่โยน และ "ไม่พัก"
  assert.equal(readSnooze(), 0);
  assert.equal(isSnoozed(t0), false, 'storage อ่านไม่ได้ = ไม่พัก (แถบยังทำงาน)');
  assert.equal(isSnoozed(until + 1), false);
  assert.equal(SNOOZE_KEY, 'esm.pushPrompt.snoozeUntil');
});

test('snoozeUntil ปรับจำนวนวันได้ และไม่โยนแม้ storage ใช้ไม่ได้', () => {
  const t0 = 1_700_000_000_000;
  assert.equal(snoozeUntil(t0, 1), t0 + 86400_000);
  assert.doesNotThrow(() => snoozeUntil(t0, 0));
});
