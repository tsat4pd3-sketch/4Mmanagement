/* ══ 📎 fileAttach — กฎการรับ "ไฟล์แนบ" (รูป + เอกสาร) เข้า Supabase Storage จุดเดียวของทั้งแอป ══
 *
 * เดิมสูตรนี้อยู่ใน `components/NpiUi.jsx` (`uploadNpiFile`) ใช้ได้เฉพาะ bucket `npi-files`
 * ⇒ โมดูลถัดไปที่อยากแนบไฟล์ต้องก๊อปทั้งก้อน · ก๊อปเมื่อไหร่ = กับดักเดิมกลับมาทีละข้อ
 * (HEIC ไม่แปลง · GIF ไม่มีเพดาน · `file.type` ว่างจาก Android เลยข้ามการบีบ · ลืม `uploadOpts`)
 * ⇒ ย้ายมาไว้ที่นี่ที่เดียว bucket เป็นพารามิเตอร์ · NpiUi เหลือเป็น wrapper บางๆ
 *
 * 🔴 กฎที่ห้ามถอด (เหตุผลเต็ม → docs/modules/storage-images.md):
 *   · HEIC จาก iPhone ต้องแปลงก่อน — ไม่แปลง = อัปไฟล์ที่ไม่มีใครเปิดดูได้ขึ้นไปเงียบๆ
 *   · ชนิดไฟล์ตัดสินที่ `utils/imageFileKind.js` เท่านั้น **ห้ามเทียบ `file.type` เองในหน้า**
 *   · GIF บีบไม่ได้ (บีบแล้วภาพเคลื่อนไหวหาย) ⇒ มีเพดานไบต์แทน
 *   · ทุก `.upload()` ต้องผ่าน `uploadOpts()` ไม่งั้น cacheControl หาย = egress ซ้ำทุกชั่วโมง
 *   · ปฏิเสธไฟล์ต้องขึ้น toast บอกเหตุผล **ห้ามคืน null เงียบๆ** (คำสั่ง user 11/09)
 */
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';
import { toDecodableImage, isHeicFile } from './heicToJpeg';
import { looksLikeImage, isGifFile, GIF_MAX_BYTES, GIF_TOO_BIG_MSG } from './imageFileKind';
import { uploadOpts } from './storageUpload';

export const ATTACH_MAX_MB = 20;
/** ชนิดไฟล์ที่ช่องแนบเปิดรับ — ตรงกับ allowed_mime_types ของ bucket (ไม่ตรง = อัปแล้วโดนปฏิเสธฝั่ง server) */
export const ATTACH_ACCEPT = '.pdf,image/*,.xlsx,.docx,.pptx';

/** รูปหรือเปล่า — ดูจากนามสกุลใน URL (ใช้ตัดสินว่าจะโชว์ thumbnail / แนบเป็นหน้าใน PDF ได้ไหม) */
export const isImageAttachment = (url) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url || '');

/** ชื่อไฟล์อ่านง่ายจาก public URL (ตัด prefix timestamp_random ที่เราเติมตอนอัปออก) */
export const attachFileName = (url) => {
  try { return decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/^\d+_[a-z0-9]+\./, ''); }
  catch { return 'ไฟล์'; }
};

/**
 * อัปไฟล์แนบ 1 ไฟล์ → `{ url, name, size, type }` · **`null` = ไม่สำเร็จ (toast ขึ้นให้แล้ว)**
 * `name` = ชื่อไฟล์เดิมที่ผู้ใช้เลือก (เก็บลงตารางไว้โชว์) · `size`/`type` = ของไฟล์ที่อัปจริงหลังบีบ
 */
export async function uploadAttachmentInfo(bucket, folder, file) {
  if (!file) return null;
  if (file.size > ATTACH_MAX_MB * 1024 * 1024) { toast.error(`ไฟล์ใหญ่เกิน ${ATTACH_MAX_MB}MB`); return null; }
  const origName = file.name || 'ไฟล์';
  // HEIC/HEIF จากกล้องมือถือ → JPEG ก่อน · แปลงไม่ได้ = หยุดทั้งอัปโหลด + บอกวิธีแก้ (ห้ามส่งไฟล์ดิบขึ้นไป)
  if (isHeicFile(file)) {
    try { file = await toDecodableImage(file); }
    catch (e) { toast.error(e?.message || 'อ่านไฟล์รูปไม่ได้'); return null; }
  }
  if (isGifFile(file) && file.size > GIF_MAX_BYTES) { toast.error(GIF_TOO_BIG_MSG); return null; }
  let toUpload = file;
  let ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  if (looksLikeImage(file) && !isGifFile(file)) {
    try {
      // รูปหลักฐาน/แบบ = tier drawing (ต้องซูมอ่านตัวหนังสือในรูปได้) — สเปคเดียวกับ pe-images/qa-drawings
      const { default: imageCompression } = await import('browser-image-compression');
      toUpload = await imageCompression(file, { maxSizeMB: 2.5, maxWidthOrHeight: 2560, initialQuality: 0.9, fileType: 'image/jpeg' });
      ext = 'jpg';
    } catch { /* บีบไม่ได้ — ส่งไฟล์เดิมภายใต้เพดาน */ }
  }
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, toUpload, uploadOpts({ upsert: true }));
  if (error) { toast.error(`อัพโหลดไม่สำเร็จ: ${error.message}`); return null; }
  return {
    url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
    name: origName, size: toUpload.size ?? file.size, type: toUpload.type || file.type || null,
  };
}

/** แบบคืน url อย่างเดียว (ผู้เรียกเดิมที่ไม่ได้เก็บชื่อ/ขนาด) */
export async function uploadAttachment(bucket, folder, file) {
  const r = await uploadAttachmentInfo(bucket, folder, file);
  return r ? r.url : null;
}

/** ลบไฟล์ใน bucket จาก public URL (best-effort — แถวในตารางเป็นตัวตัดสิน ไฟล์ค้างไม่ทำใครพัง) */
export function removeAttachment(bucket, url) {
  const p = url?.split(`/${bucket}/`)[1];
  if (p) supabase.storage.from(bucket).remove([decodeURIComponent(p).split('?')[0]]).catch(() => {});
}
