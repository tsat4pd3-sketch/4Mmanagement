/* เทส coalesce — เพดานความถี่ของการโหลดใหม่จาก realtime (2026-09-15)

   เคสที่ต้องล็อกไว้ เพราะพลาดแล้วเจ็บคนละแบบ:
   · ไม่มีเพดาน  → วันทำงานยุ่ง = จอโหลดรัวไม่จำกัด = egress ทะลุโควต้า (เหตุที่ทำรอบนี้)
   · เพดานแล้วกินทุกอย่าง → event ระหว่างทางหาย จอค้างแสดงของเก่า = คนหน้างานเลิกเชื่อจอ
   · ไม่มี event → ต้องไม่ยิงเลยสักครั้ง (นี่คือข้อได้เปรียบเหนือ poll ทั้งหมด)

   ⏱️ ทุกเคสใช้เวลา "สัมพัทธ์" (ส่ง ms เข้าไปเอง) ไม่ผูกกับวันที่จริง
      → ผ่านทั้งรอบปกติและรอบนาฬิกา +400 วัน (กฎเทสระเบิดเวลา ดู scripts/run-tests.mjs) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesce, payloadField } from '../liveRefresh.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('event เดียว → โหลด 1 ครั้ง หลัง settle', async () => {
  let n = 0;
  const bump = coalesce(() => { n++; }, 500, 20);
  bump();
  assert.equal(n, 0, 'ต้องไม่ยิงทันที — ให้ settle ซับ burst ก่อน');
  await sleep(60);
  assert.equal(n, 1);
  bump.cancel();
});

test('🔴 หัวใจของรอบนี้ — event รัวๆ ต่อเนื่อง ต้องไม่โหลดเกินเพดาน', async () => {
  let n = 0;
  const bump = coalesce(() => { n++; }, 200, 10);
  // จำลองวันทำงานจริง: มีคนบันทึกงานทุก 20 ms ติดกัน 300 ms
  const stop = Date.now() + 300;
  while (Date.now() < stop) { bump(); await sleep(20); }
  await sleep(250);
  // 300 ms ที่เพดาน 200 ms ⇒ อย่างมาก 3 รอบ (debounce เดิมจะได้ ~15 รอบ)
  assert.ok(n <= 3, `โหลด ${n} ครั้ง = เกินเพดาน (เดิมไม่มีเพดานเลย)`);
  assert.ok(n >= 1, 'ยุบรวมจนไม่โหลดเลย = จอค้าง');
  bump.cancel();
});

test('🔴 ไม่มี event = ไม่ยิงเลยสักครั้ง (ข้อได้เปรียบเหนือ poll)', async () => {
  let n = 0;
  const bump = coalesce(() => { n++; }, 100, 10);
  await sleep(150);
  assert.equal(n, 0);
  bump.cancel();
});

test('event ที่มาระหว่างรอคิว ต้องถูกยุบรวม ไม่ใช่ทิ้ง — รอบถัดไปยังเกิด', async () => {
  let n = 0;
  const bump = coalesce(() => { n++; }, 120, 10);
  bump();
  await sleep(40);           // รอบที่ 1 ยิงไปแล้ว
  assert.equal(n, 1);
  bump();                    // มาใหม่ทันที — ยังไม่ครบเพดาน ต้องรอ
  await sleep(40);
  assert.equal(n, 1, 'ยิงก่อนครบเพดาน = ไม่มีเพดานจริง');
  await sleep(120);
  assert.equal(n, 2, 'event ระหว่างทางถูกทิ้ง = จอไม่อัปเดตทั้งที่มีของใหม่');
  bump.cancel();
});

test('cancel ใน cleanup แล้วต้องไม่ยิงต่อ (กัน setState หลัง unmount)', async () => {
  let n = 0;
  const bump = coalesce(() => { n++; }, 100, 20);
  bump();
  bump.cancel();
  await sleep(60);
  assert.equal(n, 0);
});

test('fn โยน error ต้องไม่ทำให้ handler ของ realtime ตาย', async () => {
  let n = 0;
  const bump = coalesce(() => { n++; throw new Error('โหลดล้ม'); }, 50, 10);
  bump();
  await sleep(30);
  bump();
  await sleep(80);
  assert.ok(n >= 2, 'error รอบแรกทำให้รอบถัดไปไม่เกิด');
  bump.cancel();
});

test('payloadField — อ่านได้ทั้ง INSERT/UPDATE (new) และ DELETE (old)', () => {
  assert.equal(payloadField({ new: { session_id: 'a' } }, 'session_id'), 'a');
  assert.equal(payloadField({ old: { session_id: 'b' } }, 'session_id'), 'b');
  assert.equal(payloadField({}, 'session_id'), undefined);
  assert.equal(payloadField(null, 'session_id'), undefined);
});
