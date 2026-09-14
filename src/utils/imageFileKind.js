/* ── imageFileKind — ตัดสิน "ไฟล์ที่ผู้ใช้เลือกมาเป็นรูปชนิดไหน" จุดเดียวของทั้งแอป (2026-09-11)

   ทำไมต้องแยกออกมา: ทุกจุดรับไฟล์ต้องตอบ 2 คำถามเดียวกัน —
     1. "นี่เป็นไฟล์รูปจริงไหม"  (ไม่ใช่ → ต้อง **เตือนให้เห็น** ห้ามปิดหน้าต่างเงียบๆ)
     2. "เป็น GIF หรือเปล่า"     (รูปพนักงานไม่รับ GIF แล้ว — ดู ImageCropModal prop `allowGif`)

   ⚠️ **ต้องดูนามสกุลด้วย ไม่ใช่ดูแต่ MIME** — Android/Chrome หลายรุ่นส่ง `type` เป็นค่าว่าง
      หรือ `application/octet-stream` มากับรูปจริง (กับดักเดียวกับ `isHeicFile` ใน heicToJpeg.js)
      ถ้าเชื่อ MIME อย่างเดียว รูปดีๆ จากมือถือจะถูกปฏิเสธ

   ⚠️ ห้ามเอาไปใช้แทนการตรวจฝั่ง server — นี่คือ UX guard (บอกผู้ใช้เร็วๆ ว่าเลือกผิดไฟล์)
      ไม่ใช่ด่านความปลอดภัย                                                                  */

/** ชนิดที่ระบบรับได้ (HEIC/HEIF ถูกแปลงเป็น JPEG ก่อนใช้งานจริง — ดู heicToJpeg.js) */
export const OK_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'];

/** นามสกุลของไฟล์ (ตัวพิมพ์เล็ก, ไม่มีจุด) — ไม่มีนามสกุล = '' */
export function extOf(name) {
  const s = String(name ?? '');
  const i = s.lastIndexOf('.');
  return i > 0 ? s.slice(i + 1).toLowerCase() : '';
}

/** เป็นไฟล์รูปที่รับได้ไหม — ผ่านถ้า MIME บอกว่ารูป **หรือ** นามสกุลอยู่ในลิสต์ */
export function looksLikeImage(file) {
  if (!file) return false;
  if (String(file.type || '').toLowerCase().startsWith('image/')) return true;
  return OK_IMAGE_EXT.includes(extOf(file.name));
}

/** เป็น GIF ไหม (ดูทั้ง MIME และนามสกุล ด้วยเหตุผลเดียวกับข้างบน) */
export function isGifFile(file) {
  if (!file) return false;
  return String(file.type || '').toLowerCase() === 'image/gif' || extOf(file.name) === 'gif';
}
