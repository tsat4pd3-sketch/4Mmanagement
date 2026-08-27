/* เทส isHeicFile — ตัวตัดสินว่าจะโหลดตัวแปลง 1.3MB หรือไม่
   เคสสำคัญที่สุดคือ "Android ส่ง type ว่างมากับไฟล์ .heic" ซึ่งเป็นเหตุที่ต้องดูนามสกุลด้วย */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHeicFile } from '../heicToJpeg.js';

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
