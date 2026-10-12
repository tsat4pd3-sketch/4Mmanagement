/* ═══ 📷 รูปหลักฐานของเสีย — ของกลางจุดเดียวของทั้งสายงาน (2026-10-12 · คำสั่ง user) ═══

   สายงาน: ลงงานเสียในกะ (`defect_logs.defect_img`) → ลงถังเหลือง/แดง
   (`quality_bin_records.found_img` / `repair_img`) → ใบรายงานของเสีย (`scrap_report_items.defect_img`)

   ที่มา: ก่อนหน้านี้ **ไม่มีการแนบรูปเลยสักขั้น** (วัด 12/10: defect_logs 233 แถว · ถัง 35 แถว
   — ไม่มีคอลัมน์รูปทั้งคู่) ⇒ QA ตัดสิน 4 ทางโดยไม่มีหลักฐานภาพ และของที่ถูกซ่อม/ทำลายไปแล้ว
   สืบย้อนไม่ได้ว่าเสียยังไง

   🔴 **จุดแนบรูปใหม่ในสายของเสียทุกจุด ต้องเรียกผ่านไฟล์นี้เท่านั้น** — มีด่าน regressionGuards
      (บทเรียนเดียวกับ `src/utils/mtnImage.js` ของใบ MO: กติกาเคยฝังอยู่ในหน้า แล้วจุดที่ 2 ต้องก๊อป)

   ⚠️ คนละถังกับ `mtn-images` โดยตั้งใจ — รูปซ่อมเครื่อง (ของช่าง) กับรูปของเสีย (ของ QA/ผลิต)
      มีอายุเอกสารและคนดูแลคนละชุด · ปนถังแล้วแยกไม่ออกตอนจะล้าง
   ═══════════════════════════════════════════════════════════════════════════════════ */
import resizeImg, { imgExt } from './resizeImage';
import { uploadOpts } from './storageUpload';
import { supabaseDR } from '../supabaseClient';

export const QUALITY_BUCKET = 'quality-images';

/* 📐 4:3 = สัดส่วนกล้องมือถือแนวนอน — กรอบกว้างพอเห็นชิ้นงานทั้งชิ้น
   🔴 จุดที่เรียกต้องเปิด `allowFull` ของ `<ImageCropModal>` เสมอ — รูปหลักฐานถูกครอบแล้ว
      "ตำหนิหลุดกรอบ" = รูปใช้ไม่ได้เลย (บทเรียนเดียวกับรูปผังเครื่องจักร 21/08) */
export const QUALITY_IMG_ASPECT = 4 / 3;

/* 🗜️ 1024px + webp — ต้องใหญ่พอให้เห็น "ตำหนิ" (480px ของรูปโปรไฟล์เล็กเกินไปสำหรับงานตรวจ)
   ⚠️ นามสกุลต้องมาจาก `imgExt(blob)` เสมอ ห้าม hardcode '.jpg' (Safari เก่าถอยไป JPEG/PNG เอง) */
export const resizeQualityImage = (file, maxPx = 1024, quality = 0.8) =>
  resizeImg(file, maxPx, quality, { webp: true, aspect: QUALITY_IMG_ASPECT });

/** อัปโหลดขึ้น bucket quality-images → คืน public URL · โยน error ถ้าล้ม (ผู้เรียกต้อง toast เอง) */
export async function uploadQualityImg(blob, path) {
  const { error } = await supabaseDR.storage.from(QUALITY_BUCKET)
    .upload(path, blob, uploadOpts({ upsert: true, contentType: blob.type }));
  if (error) throw error;
  return supabaseDR.storage.from(QUALITY_BUCKET).getPublicUrl(path).data.publicUrl;
}

export const qualityImgPath = (url) => {
  const p = String(url || '').split(`/${QUALITY_BUCKET}/`)[1];
  return p ? decodeURIComponent(p) : null;
};

/** ลบไฟล์เก่าทิ้ง — เงียบได้ (ไฟล์กำพร้าไม่ทำให้จอผิด แต่ toast เตือนซ้ำๆ กวนหน้างาน)
 *  🔴 เรียกได้ **หลังจาก** เขียนแถวสำเร็จและนับแถวได้แล้วเท่านั้น (กฎเหล็ก db-write ข้อ 2) */
export const removeQualityImg = (url) => {
  const p = qualityImgPath(url);
  if (p) supabaseDR.storage.from(QUALITY_BUCKET).remove([p]).catch(() => {});
};

/**
 * บีบ + อัปโหลด + คืน URL ในขั้นตอนเดียว
 * @param file   File ที่ผ่าน `acceptImageFile()` / `<ImageCropModal>` มาแล้ว · null = ไม่มีรูป
 * @param folder โฟลเดอร์ในถัง: 'bin' (ถังเหลือง/แดง) · 'defect' (ลงงานเสียในกะ) · 'scrap' (ใบรายงาน)
 * @param key    คีย์ของเจ้าของรูป — ใช้ประกอบชื่อไฟล์ให้สืบกลับได้
 *               ⚠️ `scrap_report_items` ถูกลบ-เขียนใหม่ทุกครั้งที่บันทึกใบ ⇒ ที่นั่นต้องส่ง **id ของใบ**
 *                  ไม่ใช่ id ของรายการ (id รายการเปลี่ยนทุกการบันทึก = ชื่อไฟล์สืบกลับไม่ได้)
 * @returns {Promise<string|null>} public URL · null = ไม่มีไฟล์ · โยน error ถ้าอัปโหลดล้ม
 */
export async function uploadQualityPhoto(file, folder, key) {
  if (!file) return null;
  const blob = await resizeQualityImage(file);
  return uploadQualityImg(blob, `${folder}/${key || 'tmp'}-${Date.now()}.${imgExt(blob)}`);
}
