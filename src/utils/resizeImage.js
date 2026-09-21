/* 📷 resizeImage — บีบรูปก่อนอัปโหลด (single source of truth)
   เดิมก๊อปโค้ดชุดนี้ซ้ำ 3 ไฟล์ (MtnRepair / PEDocs / Improvements) แล้วพังพร้อมกันทั้งหมด
   เมื่อเจอไฟล์ที่เบราว์เซอร์ decode ไม่ได้ — รวมมาที่นี่ที่เดียว แก้ทีเดียวได้ทุกจุด

   ⚠️ เคสจริงที่ทำให้ต้องเขียนใหม่ (feedback หน้างาน 2026-08-21):
     ช่างเปิดจาก **in-app browser ของ LINE บนมือถือ** แล้วเลือกรูป "รูปหลังซ่อม"
     → `new Image()` ยิง onerror → โยน "อ่านไฟล์รูปไม่ได้" → **บันทึกทั้งใบล้ม**
     วิธีการแก้ไข/ช่างหลัก/ช่างรอง ที่พิมพ์มาหายหมด · ช่างกดบันทึกซ้ำ 13 ครั้ง
     (เห็น toast ซ้อนกัน 13 อัน) โดยไม่รู้ว่าติดที่รูป

   สิ่งที่แก้:
     1. ลอง `createImageBitmap(file)` ก่อน — รองรับฟอร์แมต/หน่วยความจำดีกว่า `<img>`
        และไม่ต้องพึ่ง blob URL ซึ่งบาง in-app browser จัดการได้ไม่ดี
     2. ถอยไป `<img>` + object URL ถ้าเบราว์เซอร์ไม่มี createImageBitmap
     3. **revoke object URL ทุกทาง** (เดิม revoke เฉพาะตอนสำเร็จ = รั่วทุกครั้งที่พัง)
     4. ข้อความ error บอก "น่าจะเพราะอะไร + ทำยังไงต่อ" ไม่ใช่แค่ "อ่านไฟล์รูปไม่ได้"

   ⚠️ ผู้เรียกต้องไม่ปล่อยให้รูปพังแล้วลากงานหลักล้มไปด้วย —
      บันทึกข้อมูลหลักให้สำเร็จก่อน แล้วค่อยเตือนว่ารูปไม่ได้ถูกแนบ (กฎเดียวกับ close_approve_note)
*/

/* ⚠️ ห้ามใส่คำว่า "รูปใหญ่เกินไป" ในข้อความนี้ — เคยมีแล้วผู้ใช้เข้าใจผิดว่าเป็นเรื่อง "ขนาดไฟล์"
   (feedback หน้างาน 2026-08-25: Samsung ลดความละเอียดกล้องต่ำสุดแล้วก็ยังพัง เพราะปัญหาจริงคือ
   ฟอร์แมต HEIF/HEIC ที่เบราว์เซอร์ decode ไม่ได้ ไม่เกี่ยวกับขนาด — ลดความละเอียดไม่มีวันหาย)
   ข้อความต้องชี้ไปที่ "ฟอร์แมต + วิธีตั้งกล้อง" เท่านั้น */
export const IMG_READ_ERROR =
  'อ่านไฟล์รูปนี้ไม่ได้ — มักเกิดจากไฟล์เป็นฟอร์แมต HEIF/HEIC จากกล้องมือถือ ซึ่งเบราว์เซอร์ไม่รองรับ (ไม่เกี่ยวกับขนาดไฟล์/ความละเอียด) · ' +
  'วิธีแก้: ตั้งกล้องให้ถ่ายเป็น JPEG — Samsung: ตั้งค่ากล้อง → รูปแบบภาพ → ปิด "รูปภาพประสิทธิภาพสูง (HEIF)" · iPhone: ตั้งค่า → กล้อง → รูปแบบ → เลือก "เข้ากันได้มากที่สุด" · ' +
  'หรือเปิดระบบผ่าน Chrome/Safari แทนเบราว์เซอร์ในแอป (เช่น LINE) แล้วลองใหม่';

import { toDecodableImage } from './heicToJpeg';

/* ── WebP (งานลด egress 2026-09-21 · `docs/EGRESS-AUDIT-2026-09-17.md` §5c) ────────
   รูปซ่อม `mtn-images/before|after` วัดได้ **39 MB/วัน** (241 ครั้ง × ~165 KB)
   WebP ที่คุณภาพเท่ากันเล็กกว่า JPEG ~30% · จอ TV ที่ใช้จริง (Cr 94) รองรับสบาย

   ⚠️ **เป็น opt-in ไม่ใช่ default** — ตัวนี้เป็น single source ของ 6 หน้า
      เปลี่ยนให้ทุกหน้าพร้อมกันโดยไม่ได้วัด = blast radius กว้างเกินจำเป็น
      (บางหน้าตั้ง contentType/นามสกุลเอง ต้องไล่ดูทีละจุดก่อน)
   ⚠️ **`canvas.toBlob('image/webp')` ไม่มีทุกเบราว์เซอร์** (Safari < 16.4 คืน PNG เงียบๆ) ⇒
      ตรวจ `blob.type` ที่ได้จริง ไม่ตรงก็ถอยไป JPEG · และผู้เรียก**ต้องตั้งนามสกุลจาก
      `imgExt(blob)` เสมอ ห้าม hardcode `.jpg`**                                        */

/** วาดลง canvas แล้วคืน blob (คืน null ถ้า toBlob ไม่ออก) */
function toBlob(canvas, type, quality) {
  return new Promise(res => canvas.toBlob(res, type, quality));
}

async function draw(src, w, h, maxPx, quality, webp) {
  const scale = Math.min(1, maxPx / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  if (webp) {
    const b = await toBlob(canvas, 'image/webp', quality);
    if (b && b.type === 'image/webp') return b;   // เบราว์เซอร์เขียน webp ไม่ได้ → ถอยไป JPEG
  }
  return toBlob(canvas, 'image/jpeg', quality);
}

/** นามสกุลที่ตรงกับชนิดไฟล์จริง — ผู้เรียกที่เปิด webp ต้องใช้ตัวนี้ ห้ามเดาเอง */
export const imgExt = (blob) => ({
  'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif',
}[String(blob?.type || '').toLowerCase()] || 'jpg');

/**
 * @param {File|Blob} file
 * @param {number}    maxPx
 * @param {number}    quality
 * @param {object}    [opts]
 * @param {boolean}   [opts.webp] true = พยายามคืน WebP (ถอยไป JPEG เองถ้าเบราว์เซอร์ไม่รองรับ)
 */
export default async function resizeImage(file, maxPx = 1024, quality = 0.8, { webp = false } = {}) {
  // ⓪ HEIC/HEIF จากกล้องมือถือ → แปลงเป็น JPEG ก่อน (ไม่ใช่ HEIC = คืนไฟล์เดิม ไม่มี overhead)
  //    แปลงไม่สำเร็จ = โยน HEIC_FAIL_MSG ที่บอกวิธีตั้งกล้อง — ผู้เรียกโชว์ต่อได้เลย
  file = await toDecodableImage(file, Math.max(quality, 0.9));

  // ① createImageBitmap — ทางหลัก (decode นอก main thread · รองรับฟอร์แมตกว้างกว่า)
  if (typeof createImageBitmap === 'function') {
    let bmp = null;
    try {
      bmp = await createImageBitmap(file);
      const blob = await draw(bmp, bmp.width, bmp.height, maxPx, quality, webp);
      if (blob) return blob;
    } catch { /* ตกไปทาง <img> ข้างล่าง */ }
    finally { bmp?.close?.(); }
  }

  // ② <img> + object URL — ทางสำรองสำหรับเบราว์เซอร์เก่า
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(IMG_READ_ERROR));
      im.src = url;
    });
    const blob = await draw(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxPx, quality, webp);
    if (!blob) throw new Error('บีบรูปไม่สำเร็จ — ลองใช้รูปที่เล็กลง');
    return blob;
  } finally {
    URL.revokeObjectURL(url);   // ห้ามลืม — เดิม revoke เฉพาะตอนสำเร็จ
  }
}
