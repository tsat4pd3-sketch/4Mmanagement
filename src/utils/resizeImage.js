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

export const IMG_READ_ERROR =
  'อ่านไฟล์รูปไม่ได้ — ไฟล์อาจเป็นฟอร์แมตที่เบราว์เซอร์นี้ไม่รองรับ (เช่น .heic/.heif จากกล้องมือถือ) ' +
  'หรือรูปใหญ่เกินไป · ลองถ่ายใหม่โดยตั้งกล้องเป็น JPEG หรือเปิดระบบผ่าน Chrome/Safari แทนเบราว์เซอร์ในแอป';

/** วาดลง canvas แล้วคืน JPEG blob (คืน null ถ้า toBlob ไม่ออก) */
function draw(src, w, h, maxPx, quality) {
  const scale = Math.min(1, maxPx / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
}

export default async function resizeImage(file, maxPx = 1024, quality = 0.8) {
  // ① createImageBitmap — ทางหลัก (decode นอก main thread · รองรับฟอร์แมตกว้างกว่า)
  if (typeof createImageBitmap === 'function') {
    let bmp = null;
    try {
      bmp = await createImageBitmap(file);
      const blob = await draw(bmp, bmp.width, bmp.height, maxPx, quality);
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
    const blob = await draw(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxPx, quality);
    if (!blob) throw new Error('บีบรูปไม่สำเร็จ — ลองใช้รูปที่เล็กลง');
    return blob;
  } finally {
    URL.revokeObjectURL(url);   // ห้ามลืม — เดิม revoke เฉพาะตอนสำเร็จ
  }
}
