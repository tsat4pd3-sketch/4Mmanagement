/* ═══ 🖼️ รูปในใบแจ้งซ่อม MO — ของกลางจุดเดียว (แยกออกจาก MtnRepair.jsx เมื่อ 2026-09-22) ═══

   ที่มา: user แจ้ง *"เปิด MO จากดาวน์ไทม์ ไม่มีให้แนบรูป เหมือนกับเปิด MO ใหม่ step1"*
   ตอนไปเพิ่มช่องแนบรูปให้ `DailyReport` พบว่ากติกา 3 ข้อของรูป MO **ฝังอยู่ใน `MtnRepair.jsx`**
   ⇒ จุดแนบรูปใหม่ต้อง "ก๊อป" ซึ่งผิดกฎที่คอมเมนต์ในไฟล์นั้นเขียนไว้เอง
   ("ห้ามก๊อปโค้ดบีบรูปซ้ำอีก" · "เพิ่มจุดแนบรูปใหม่ในใบ MO ให้ส่ง aspect ตัวนี้ด้วยเสมอ")

   🔴 **จุดแนบรูปใหม่ในใบ MO ทุกจุด ต้องเรียกผ่านไฟล์นี้เท่านั้น** — มีด่าน regressionGuards
   ═══════════════════════════════════════════════════════════════════════════════════ */
import resizeImg, { imgExt } from './resizeImage';
import { uploadOpts } from './storageUpload';
import { supabaseDR } from '../supabaseClient';

/* 📐 รูปในใบ MO ใช้สัดส่วน 16:9 ทุกจุด (แจ้ง/ซ่อมเสร็จ/QA)
   ที่มา: ผจก.สุรเสน 22/09 "กำหนดอัตราส่วน 16:9 ขยายผลไปทุก Step MO ที่มีการแนบรูป"
   ⚠️ **ครอบให้** ไม่ใช่ **ปฏิเสธรูป** (user ตัดสิน 22/09) — หน้างานถ่ายจากมือถือ
      ถ้าปฏิเสธจะแนบรูปไม่ได้เลย */
export const MO_IMG_ASPECT = 16 / 9;

export const MTN_BUCKET = 'mtn-images';

/* 🗜️ webp:true — รูปซ่อมคือ 39 MB/วันของ egress ฝั่ง DR (งานลด egress 2026-09-21)
   ⚠️ นามสกุลไฟล์ต้องมาจาก imgExt(blob) เสมอ ห้าม hardcode '.jpg' (เบราว์เซอร์เก่าถอยไป JPEG เอง) */
export const resizeMoImage = (file, maxPx = 1024, quality = 0.8) =>
  resizeImg(file, maxPx, quality, { webp: true, aspect: MO_IMG_ASPECT });

/** อัปโหลดขึ้น bucket mtn-images → คืน public URL · โยน error ถ้าล้ม (ผู้เรียกต้อง toast เอง) */
export async function uploadMtnImg(blob, path) {
  const { error } = await supabaseDR.storage.from(MTN_BUCKET)
    .upload(path, blob, uploadOpts({ upsert: true, contentType: blob.type }));
  if (error) throw error;
  return supabaseDR.storage.from(MTN_BUCKET).getPublicUrl(path).data.publicUrl;
}

export const mtnPath = (url) => { const p = url?.split(`/${MTN_BUCKET}/`)[1]; return p ? decodeURIComponent(p) : null; };
export const removeMtnImg = (url) => {
  const p = mtnPath(url);
  if (p) supabaseDR.storage.from(MTN_BUCKET).remove([p]).catch(() => {});
};

/** บีบ+อัปโหลด+คืน URL ในขั้นตอนเดียว — ใช้กับ "รูปก่อนซ่อม" ตอนเปิดใบ
 *  @returns {Promise<string|null>} null = ไม่มีไฟล์ · โยน error ถ้าอัปโหลดล้ม */
export async function uploadMoBeforeImg(file, orderId) {
  if (!file) return null;
  const blob = await resizeMoImage(file);
  return uploadMtnImg(blob, `before/${orderId}-${Date.now()}.${imgExt(blob)}`);
}
