/* เทส imageFileKind — ด่านชนิดไฟล์ของทุกจุดอัปโหลดรูป
   เคสที่สำคัญที่สุดคือ "Android ส่ง type ว่างมากับรูปจริง" — ถ้าเชื่อ MIME อย่างเดียว
   รูปดีๆ จากมือถือจะถูกปฏิเสธทั้งหมด (กับดักเดียวกับที่เคยเจอใน heicToJpeg)
   และ "GIF ที่ MIME ไม่บอกว่าเป็น GIF" ต้องยังถูกจับได้ ไม่งั้นด่านห้าม GIF ของรูปพนักงานรั่ว */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeImage, isGifFile, extOf, OK_IMAGE_EXT } from '../imageFileKind.js';

const f = (name, type) => ({ name, type });

test('extOf — ตัวพิมพ์เล็กเสมอ และไม่มีนามสกุลคืนค่าว่าง', () => {
  assert.equal(extOf('a.JPG'), 'jpg');
  assert.equal(extOf('IMG_0001.HEIC'), 'heic');
  assert.equal(extOf('รูปพนักงาน.png'), 'png');
  assert.equal(extOf('no-extension'), '');
  assert.equal(extOf('.gitignore'), '');          // จุดนำหน้า ไม่ใช่นามสกุล
  assert.equal(extOf(undefined), '');
});

test('รูปปกติผ่านทุกชนิดที่รองรับ', () => {
  for (const ext of OK_IMAGE_EXT) {
    assert.equal(looksLikeImage(f(`p.${ext}`, `image/${ext}`)), true, ext);
  }
});

test('🔴 Android ส่ง type ว่าง/octet-stream มากับรูปจริง → ต้องผ่าน (ดูนามสกุล)', () => {
  assert.equal(looksLikeImage(f('20260911_151030.jpg', '')), true);
  assert.equal(looksLikeImage(f('IMG_0002.HEIC', undefined)), true);
  assert.equal(looksLikeImage(f('photo.png', 'application/octet-stream')), true);
});

test('ไฟล์ที่ไม่ใช่รูป ต้องไม่ผ่าน (แล้วหน้าจอจะขึ้น alarm บอกผู้ใช้)', () => {
  assert.equal(looksLikeImage(f('เอกสาร.pdf', 'application/pdf')), false);
  assert.equal(looksLikeImage(f('ข้อมูล.xlsx', '')), false);
  assert.equal(looksLikeImage(f('clip.mp4', 'video/mp4')), false);
  assert.equal(looksLikeImage(f('no-extension', '')), false);
  assert.equal(looksLikeImage(null), false);
});

test('MIME บอกว่าเป็นรูป ก็ผ่าน แม้นามสกุลแปลก (กล้อง/แอปบางตัวตั้งชื่อเอง)', () => {
  assert.equal(looksLikeImage(f('capture', 'image/jpeg')), true);
  assert.equal(looksLikeImage(f('x.bmp', 'image/bmp')), true);
});

test('🚫 จับ GIF ได้ทั้งจาก MIME และนามสกุล — ด่านห้าม GIF ของรูปพนักงานต้องไม่รั่ว', () => {
  assert.equal(isGifFile(f('cat.gif', 'image/gif')), true);
  assert.equal(isGifFile(f('cat.GIF', '')), true);              // Android ไม่ส่ง MIME
  assert.equal(isGifFile(f('emp_1781753923018.gif', 'application/octet-stream')), true);
  assert.equal(isGifFile(f('p.jpg', 'image/jpeg')), false);
  assert.equal(isGifFile(null), false);
});
