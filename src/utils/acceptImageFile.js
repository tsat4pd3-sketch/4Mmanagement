/* ══ 📷 acceptImageFile — ด่านรับไฟล์รูปจาก <input type="file"> จุดเดียวของทั้งแอป (2026-10-06) ══
 *
 * 🔴 ปัญหาที่มาแก้ (QC audit 06/10) — `storage-images.md` เขียนกฎไว้ชัดว่า
 *    *"ทุกจุดรับรูปต้องผ่าน `toDecodableImage`"* แต่ของจริงมี **12 ช่องรับรูปใน 9 ไฟล์**
 *    ที่รับไฟล์ตรงๆ ไม่เคยผ่าน ⇒ 2 อาการ:
 *
 *    1. **รูปจาก iPhone (HEIC) ใช้ไม่ได้** — Chrome/Android decode HEIC ไม่ได้
 *       · บางจุดพังตอนกด "บันทึก" (เช่นลายเซ็น: `new Image()` onerror → "ลองใช้ JPG/PNG")
 *         = เลือกไฟล์ → เห็นพรีวิว → กดเซฟ → พังเอาตอนท้าย เสียเวลาเปล่า
 *       · บางจุด **อัปโหลดไฟล์ HEIC ดิบขึ้นไปเงียบๆ** แล้วทุกคนที่เปิดดูเห็นรูปเสีย
 *    2. **เลือกไฟล์ที่ไม่ใช่รูป (PDF/Excel) ไม่มีใครเตือน** — ขัดคำสั่ง user 11/09 ตรงๆ:
 *       *"ปฏิเสธไฟล์ต้องขึ้น toast บอกเหตุผล+ทางแก้เสมอ ห้ามปิดหน้าต่างเงียบๆ"*
 *
 * ✅ วิธีใช้ — ครอบ onChange ของ `<input type="file" accept="image/*">` ทุกตัว:
 *
 *      onChange={async (e) => {
 *        const picked = e.target.files?.[0];
 *        e.target.value = '';                  // เลือกไฟล์เดิมซ้ำต้องยิง change อีกครั้ง
 *        const f = await acceptImageFile(picked);
 *        if (!f) return;                       // ปฏิเสธแล้ว + toast ขึ้นให้แล้ว
 *        setFile(f);                           // ใช้ f (ไม่ใช่ picked) — HEIC ถูกแปลงเป็น JPEG แล้ว
 *      }}
 *
 * ⚠️ **ต้องใช้ค่าที่คืนมา ไม่ใช่ไฟล์เดิม** — ตัวแปลง HEIC คืน File ตัวใหม่
 * ⚠️ ไฟล์ที่เข้าหน้าตัด/ครอปรูป ใช้ `<ImageCropModal>` ตามเดิม (มี toDecodableImage ในตัวแล้ว)
 * 📌 มีด่าน `image-input-via-accept-helper` ใน build — เพิ่มช่องรับรูปใหม่แล้วไม่ครอบ = build ล่ม
 */
import { toast } from '../components/Toast';
import { looksLikeImage, isGifFile } from './imageFileKind';
import { toDecodableImage } from './heicToJpeg';

/**
 * @param file ไฟล์จาก `e.target.files?.[0]` (รับ `undefined`/`null` ได้ — คืน null เงียบๆ)
 * @param allowGif `false` = ปฏิเสธ GIF (รูปพนักงาน — บีบไม่ได้ เฉลี่ย 4.3 MB/รูป)
 * @returns `File` ที่เบราว์เซอร์นี้อ่านออกแน่ๆ · **`null` = ไม่รับ (toast ขึ้นให้แล้ว)**
 */
export async function acceptImageFile(file, { allowGif = true } = {}) {
  if (!file) return null;                       // ผู้ใช้กดยกเลิก — ไม่ใช่ error ไม่ต้องเตือน

  if (!looksLikeImage(file)) {
    toast.error(`"${file.name}" ไม่ใช่ไฟล์รูป — ใช้ JPG / PNG / WEBP / HEIC (รูปจาก iPhone ใช้ได้)`);
    return null;
  }
  if (!allowGif && isGifFile(file)) {
    toast.error('ไม่รับไฟล์ GIF — บีบขนาดไม่ได้ (เฉลี่ย 4.3 MB/รูป) · บันทึกเป็น JPG หรือ PNG ก่อน');
    return null;
  }
  try {
    return await toDecodableImage(file);        // ไม่ใช่ HEIC = คืนไฟล์เดิม ไม่มี overhead
  } catch (e) {
    // ข้อความจาก heicToJpeg ชี้ทางแก้อยู่แล้ว (HEIC_FAIL_MSG / HEIC_STUCK_MSG) — ห้ามแทนที่
    toast.error(e?.message || 'อ่านไฟล์รูปไม่ได้ — ลองบันทึกเป็น JPG แล้วเลือกใหม่');
    return null;
  }
}
