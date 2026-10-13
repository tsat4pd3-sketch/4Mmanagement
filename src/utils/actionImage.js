/* ═══ 📷 รูปหลักฐานของ Action Item (ประชุมเช้า + บอร์ด Obeya) — ของกลางจุดเดียว ═══
   2026-10-12 · คำสั่ง user: *"เพิ่มรูปแนบได้ด้วย ตอนตอบ action ในกราฟ KPI"*

   ที่มา: `meeting_action_items` เก็บได้แค่ตัวอักษร ⇒ ปิดงานแล้วบอก "แก้แล้ว" โดยไม่มีหลักฐาน
   เดือนถัดไปปัญหาเดิมกลับมา ก็เถียงกันไม่จบว่าเคยแก้จริงไหม

   🔴 **จุดแนบรูปของ action ทุกจุดต้องเรียกผ่านไฟล์นี้เท่านั้น** (มีด่าน regressionGuards)
      — บทเรียนเดียวกับ `mtnImage.js` / `qualityImage.js`: กติกาที่ฝังอยู่ในหน้า พอมีจุดที่ 2 ก็ถูกก๊อป

   ⚠️ ฝั่ง **Main** (`supabase` — login จริง) คนละถังกับ `quality-images` (DR) โดยตั้งใจ:
      รูปของ action ประชุมมีอายุเอกสารและคนดูแลคนละชุดกับรูปของเสีย · ปนถังแล้วแยกไม่ออกตอนจะล้าง
   ═══════════════════════════════════════════════════════════════════════════════════ */
import resizeImg, { imgExt } from './resizeImage';
import { uploadOpts } from './storageUpload';
import { supabase } from '../supabaseClient';

export const ACTION_BUCKET = 'action-images';

/* 📐 4:3 = สัดส่วนกล้องมือถือแนวนอน · 🔴 จุดที่เรียกต้องเปิด `allowFull` ของ `<ImageCropModal>`
   — รูปหลักฐานที่ครอบจนของสำคัญหลุดกรอบ = ใช้ไม่ได้เลย (ชุดเดียวกับรูปของเสีย) */
export const ACTION_IMG_ASPECT = 4 / 3;

/* 🗜️ 1024px + webp — ต้องใหญ่พอให้เห็นสิ่งที่แก้ไป (480px ของรูปโปรไฟล์เล็กเกินไป) */
export const resizeActionImage = (file, maxPx = 1024, quality = 0.8) =>
  resizeImg(file, maxPx, quality, { webp: true, aspect: ACTION_IMG_ASPECT });

/** อัปโหลดขึ้น bucket action-images → คืน public URL · โยน error ถ้าล้ม (ผู้เรียก toast เอง) */
export async function uploadActionImg(blob, path) {
  const { error } = await supabase.storage.from(ACTION_BUCKET)
    .upload(path, blob, uploadOpts({ upsert: true, contentType: blob.type }));
  if (error) throw error;
  return supabase.storage.from(ACTION_BUCKET).getPublicUrl(path).data.publicUrl;
}

export const actionImgPath = (url) => {
  const p = String(url || '').split(`/${ACTION_BUCKET}/`)[1];
  return p ? decodeURIComponent(p) : null;
};

/** ลบไฟล์เก่าทิ้ง — เงียบได้ (ไฟล์กำพร้าไม่ทำให้จอผิด แต่ toast ซ้ำๆ กวนหน้างาน)
 *  🔴 เรียกได้ **หลังจาก** เขียนแถวสำเร็จและนับแถวได้แล้วเท่านั้น (กฎเหล็ก db-write ข้อ 2) */
export const removeActionImg = (url) => {
  const p = actionImgPath(url);
  if (p) supabase.storage.from(ACTION_BUCKET).remove([p]).catch(() => {});
};

/**
 * บีบ + อัปโหลด + คืน URL ในขั้นตอนเดียว
 * @param file File ที่ผ่าน `<ImageCropModal>` มาแล้ว · null = ไม่มีรูป
 * @param id   id ของ action item (ใช้ประกอบชื่อไฟล์ให้สืบกลับได้)
 * @returns {Promise<string|null>} public URL · null = ไม่มีไฟล์ · โยน error ถ้าอัปโหลดล้ม
 */
export async function uploadActionPhoto(file, id) {
  if (!file) return null;
  const blob = await resizeActionImage(file);
  return uploadActionImg(blob, `result/${id || 'tmp'}-${Date.now()}.${imgExt(blob)}`);
}
