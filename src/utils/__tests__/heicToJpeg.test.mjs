/* เทส heicToJpeg — 2 กลุ่ม
   1. isHeicFile — ตัวตัดสินว่าจะโหลดตัวแปลง 1.3MB หรือไม่
      เคสสำคัญที่สุดคือ "Android ส่ง type ว่างมากับไฟล์ .heic" ซึ่งเป็นเหตุที่ต้องดูนามสกุลด้วย
   2. toDecodableImage — กันกับดัก worker ของ heic2any (2026-09-08): แปลงค้าง = ต้อง timeout + poison
      ไม่ import heic2any จริง (ไม่มี DOM/worker ใน node) — inject ตัวแปลงจำลองผ่าน __heicTestHooks */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isHeicFile, toDecodableImage, HEIC_FAIL_MSG, HEIC_STUCK_MSG, HEIC_TIMEOUT_MS, __heicTestHooks as hooks,
} from '../heicToJpeg.js';

const f = (name, type) => ({ name, type });

test('จับ HEIC จาก MIME ตรงๆ', () => {
  assert.equal(isHeicFile(f('a.heic', 'image/heic')), true);
  assert.equal(isHeicFile(f('a.heif', 'image/heif')), true);
  assert.equal(isHeicFile(f('a.heic', 'IMAGE/HEIC')), true);       // case-insensitive
  assert.equal(isHeicFile(f('live.heic', 'image/heic-sequence')), true);
});

test('Android/Chrome ส่ง type ว่าง หรือ octet-stream → ต้องดูนามสกุล', () => {
  assert.equal(isHeicFile(f('20260825_101500.heic', '')), true);
  assert.equal(isHeicFile(f('IMG_0001.HEIC', undefined)), true);
  assert.equal(isHeicFile(f('a.heic', 'application/octet-stream')), true);
});

test('รูปชนิดอื่นต้องไม่ถูกจับ — ทางเดินปกติห้ามโหลดตัวแปลง', () => {
  assert.equal(isHeicFile(f('a.jpg', 'image/jpeg')), false);
  assert.equal(isHeicFile(f('a.png', 'image/png')), false);
  assert.equal(isHeicFile(f('a.gif', 'image/gif')), false);
  assert.equal(isHeicFile(f('a.webp', 'image/webp')), false);
});

test('MIME บอกว่าเป็นรูปชนิดอื่นแล้ว ให้เชื่อ MIME (ชื่อไฟล์หลอกได้)', () => {
  // ผู้ใช้เปลี่ยนนามสกุลเอง/แอปตั้งชื่อมั่ว — แต่เบราว์เซอร์อ่านหัวไฟล์แล้วบอกว่า jpeg
  assert.equal(isHeicFile(f('photo.heic.jpg', 'image/jpeg')), false);
});

test('ค่าที่ไม่ใช่ไฟล์ ต้องไม่พัง', () => {
  assert.equal(isHeicFile(null), false);
  assert.equal(isHeicFile(undefined), false);
  assert.equal(isHeicFile({}), false);
});

/* ───────────── toDecodableImage — กับดัก worker ───────────── */

const HEIC = f('IMG_0001.heic', 'image/heic');   // MIME ชัด → ข้าม probe ตรงไปตัวแปลง (ไม่มี createImageBitmap ใน node อยู่แล้ว)
const hang = () => new Promise(() => {});        // ตัวแปลงที่ไม่ตอบ = worker ตาย
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

beforeEach(() => hooks.reset());

test('ข้อความ STUCK ต้องบอกให้รีเฟรช และห้ามพูดเรื่อง "ใหญ่เกิน"', () => {
  assert.match(HEIC_STUCK_MSG, /รีเฟรช/);
  assert.doesNotMatch(HEIC_STUCK_MSG, /ใหญ่เกิน/);
  assert.doesNotMatch(HEIC_FAIL_MSG, /ใหญ่เกิน/);
  assert.equal(HEIC_TIMEOUT_MS, 45_000);
});

test('ไม่ใช่ HEIC → คืนไฟล์เดิมทันที ไม่โหลดตัวแปลง (แม้ตัวแปลงจะตายไปแล้ว)', async () => {
  let loaded = 0;
  hooks.setLoader(async () => { loaded++; return hang; });
  const jpg = f('a.jpg', 'image/jpeg');
  assert.equal(await toDecodableImage(jpg), jpg);
  assert.equal(loaded, 0);
});

test('ตัวแปลงไม่ตอบ → timeout โยน HEIC_STUCK_MSG และตั้ง poisoned', async () => {
  hooks.setTimeoutMs(30);
  hooks.setLoader(async () => hang);
  const t0 = Date.now();
  await assert.rejects(toDecodableImage(HEIC), { message: HEIC_STUCK_MSG });
  assert.ok(Date.now() - t0 < 1000, 'ต้องล้มตาม timeout ไม่ใช่ค้าง');
  assert.equal(hooks.isPoisoned(), true);
});

test('poisoned แล้ว → ครั้งถัดไปโยนทันที ไม่รอ timeout และไม่โหลดตัวแปลงซ้ำ', async () => {
  hooks.setTimeoutMs(30);
  let loaded = 0;
  hooks.setLoader(async () => { loaded++; return hang; });
  await assert.rejects(toDecodableImage(HEIC), { message: HEIC_STUCK_MSG });
  assert.equal(loaded, 1);

  hooks.setTimeoutMs(10_000);   // ถ้ายังไปรอ timeout อีก เทสจะช้าเกินเกณฑ์ข้างล่าง
  const t0 = Date.now();
  await assert.rejects(toDecodableImage(HEIC), { message: HEIC_STUCK_MSG });
  await assert.rejects(toDecodableImage(f('b.heic', '')), { message: HEIC_STUCK_MSG });   // เคสรู้จากนามสกุลก็ต้องล้มทันที
  assert.ok(Date.now() - t0 < 200, 'ต้องตอบทันที');
  assert.equal(loaded, 1, 'ห้ามโหลดตัวแปลงซ้ำ — worker สร้างใหม่ในหน้าไม่ได้');
});

test('ไฟล์อ่านไม่ออก (ตัวแปลง reject) → HEIC_FAIL_MSG และ **ไม่** poison — รูปถัดไปยังแปลงได้', async () => {
  hooks.setLoader(async () => async () => { throw { code: 2, message: 'ERR_LIBHEIF format not supported' }; });
  await assert.rejects(toDecodableImage(HEIC), { message: HEIC_FAIL_MSG });
  assert.equal(hooks.isPoisoned(), false);
});

test('แปลงสำเร็จ → File .jpg ชนิด image/jpeg (sequence คืน array = เอาเฟรมแรก)', async () => {
  hooks.setLoader(async () => async () => [new Blob(['x'], { type: 'image/jpeg' }), new Blob(['y'])]);
  const out = await toDecodableImage(f('IMG_0002.HEIC', 'image/heic-sequence'));
  assert.equal(out.name, 'IMG_0002.jpg');
  assert.equal(out.type, 'image/jpeg');
  assert.equal(hooks.isPoisoned(), false);
});

test('แปลงทีละไฟล์ — 2 คำขอพร้อมกันห้ามซ้อนกันใน worker', async () => {
  let inFlight = 0, maxInFlight = 0, calls = 0;
  hooks.setLoader(async () => async () => {
    calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(20);
    inFlight--;
    return new Blob(['ok'], { type: 'image/jpeg' });
  });
  const [a, b, c] = await Promise.all([
    toDecodableImage(f('1.heic', 'image/heic')),
    toDecodableImage(f('2.heic', 'image/heic')),
    toDecodableImage(f('3.heic', 'image/heic')),
  ]);
  assert.equal(calls, 3);
  assert.equal(maxInFlight, 1);
  assert.deepEqual([a.name, b.name, c.name], ['1.jpg', '2.jpg', '3.jpg']);
});

test('ตัวแรกในคิวล้ม (timeout) → ตัวที่รออยู่ต้องล้มด้วย STUCK ไม่ใช่ค้าง', async () => {
  hooks.setTimeoutMs(30);
  hooks.setLoader(async () => hang);
  const results = await Promise.allSettled([toDecodableImage(HEIC), toDecodableImage(HEIC)]);
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected']);
  assert.deepEqual(results.map(r => r.reason.message), [HEIC_STUCK_MSG, HEIC_STUCK_MSG]);
});
