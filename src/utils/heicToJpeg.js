/* 📷 HEIC/HEIF → JPEG — ให้รูปจากกล้องมือถือยุคใหม่ใช้งานได้โดยไม่ต้องไปตั้งค่ากล้อง
   (single source of truth — ทั้ง resizeImage.js และ ImageCropModal เรียกตัวนี้ ห้ามเขียนซ้ำ)

   ⚠️ เคสจริงที่ทำให้ต้องมีไฟล์นี้ (feedback หน้างาน 2026-08-25):
     หัวหน้าส่วนใช้ Samsung ที่ตั้งกล้องเป็น "รูปภาพประสิทธิภาพสูง (HEIF)" → แนบรูปใบซ่อมไม่ได้
     แล้ว **ลดความละเอียดกล้องต่ำสุดก็ไม่หาย** เพราะปัญหาคือฟอร์แมตที่ Chrome decode ไม่ได้
     ไม่ใช่ขนาดไฟล์ · รอบแรกแก้แค่ "ข้อความ error ให้ไปปิด HEIF" ซึ่งเป็นการแก้ที่ *อาการ*
     — พนักงานเปลี่ยนเครื่อง/คนใหม่เข้ามา ปัญหาก็กลับมาอีก จึงต้องให้ระบบแปลงเองได้

   หลักการ (ตามลำดับ — ห้ามสลับ):
     1. ไม่ใช่ HEIC → คืนไฟล์เดิม ไม่แตะอะไรเลย (ทางเดินปกติต้องไม่เปลี่ยนพฤติกรรม)
     2. เบราว์เซอร์ decode เองได้ (Safari/iOS ทำได้) → คืนไฟล์เดิม **ไม่ต้องโหลด wasm 1.3MB**
     3. decode เองไม่ได้ (Chrome/Android) → lazy import `heic2any` แล้วแปลงเป็น JPEG
     4. แปลงไม่สำเร็จ → โยน error ที่บอก "ทำยังไงต่อ" (ไปปิด HEIF ที่กล้อง) — ห้ามเงียบ

   ⚠️ `heic2any` ต้อง **dynamic import เท่านั้น** (ไฟล์เดียว ~1.3MB) — import แบบ static
      จะไปฝังใน bundle หลักทุกหน้า ทั้งที่คนส่วนใหญ่ไม่เคยส่ง HEIC
      (กฎเดียวกับ pptxgenjs / xlsx / exceljs)
*/

/** ข้อความเมื่อแปลงไม่ผ่าน — ชี้ที่ "ฟอร์แมต + วิธีตั้งกล้อง" ห้ามพูดเรื่องขนาดไฟล์ (ดู IMG_READ_ERROR) */
export const HEIC_FAIL_MSG =
  'แปลงรูปจากกล้อง (HEIC/HEIF) ไม่สำเร็จ — วิธีแก้: ตั้งกล้องให้ถ่ายเป็น JPEG · ' +
  'Samsung: ตั้งค่ากล้อง → รูปแบบภาพ → ปิด "รูปภาพประสิทธิภาพสูง (HEIF)" · ' +
  'iPhone: ตั้งค่า → กล้อง → รูปแบบ → เลือก "เข้ากันได้มากที่สุด" แล้วถ่ายใหม่';

const HEIC_MIME = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const HEIC_EXT = /\.(heic|heif)$/i;

/**
 * ไฟล์นี้เป็น HEIC/HEIF ไหม
 * ⚠️ ดูนามสกุลด้วยเสมอ — Android/Chrome หลายรุ่นส่ง `type` มาเป็นค่าว่างหรือ
 *    `application/octet-stream` กับไฟล์ .heic (เช็คแต่ MIME จะหลุด แล้วไปพังที่ decoder แทน)
 */
export function isHeicFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase().trim();
  if (HEIC_MIME.has(type)) return true;
  // MIME บอกชัดว่าเป็นรูปชนิดอื่น (jpeg/png/gif/webp) = เชื่อ MIME ไม่ต้องดูนามสกุล
  if (type.startsWith('image/')) return false;
  return HEIC_EXT.test(String(file.name || ''));
}

/** เบราว์เซอร์นี้ decode ไฟล์นี้เองได้ไหม (Safari อ่าน HEIC ได้ → ไม่ต้องโหลดตัวแปลง) */
async function browserCanDecode(file) {
  if (typeof createImageBitmap !== 'function') return false;
  let bmp = null;
  try {
    bmp = await createImageBitmap(file);
    return true;
  } catch {
    return false;
  } finally {
    bmp?.close?.();
  }
}

/** แปลง HEIC → JPEG (โหลดตัวแปลงแบบ lazy) · คืน File ชื่อ .jpg */
async function convert(file, quality) {
  const mod = await import('heic2any');
  const heic2any = mod?.default || mod;
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality });
  // ไฟล์ HEIC แบบ sequence (Live Photo / burst) คืนมาเป็น array — เอาเฟรมแรก
  const blob = Array.isArray(out) ? out[0] : out;
  if (!blob) throw new Error(HEIC_FAIL_MSG);
  const name = String(file.name || 'image').replace(HEIC_EXT, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}

/**
 * คืนไฟล์ที่ "เบราว์เซอร์นี้อ่านออกแน่ๆ"
 * — ไม่ใช่ HEIC หรือ decode เองได้ = คืนไฟล์เดิม (ไม่มี overhead)
 * — เป็น HEIC ที่ decode ไม่ได้ = แปลงเป็น JPEG ให้
 * @throws Error(HEIC_FAIL_MSG) เมื่อแปลงไม่สำเร็จ — ผู้เรียกต้องโชว์ข้อความนี้ ห้ามกลืน
 */
export async function toDecodableImage(file, quality = 0.9) {
  if (!isHeicFile(file)) return file;
  if (await browserCanDecode(file)) return file;
  try {
    return await convert(file, quality);
  } catch (e) {
    console.warn('heic convert failed', e);
    throw new Error(HEIC_FAIL_MSG);
  }
}
