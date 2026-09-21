/* ── layoutImage — บีบ "รูปผัง" (ผังไลน์ · ผังโรงงาน · ผังเครื่องจักร) จุดเดียวของทั้งแอป ──
   (2026-09-17 · งานลด egress รอบ 5 — เตรียมรับจอ/แท็บเล็ต ~40 เครื่อง)

   ═══ ทำไมต้องมี ═══════════════════════════════════════════════════════════════
   รูปผังถูกอัปเป็น **PNG** แล้วส่งเข้า `imageCompression` โดย**ไม่ระบุ fileType**
   ⇒ ไลบรารีคืนชนิดเดิม = PNG ⇒ `maxSizeMB: 2.5` แทบไม่ช่วยอะไร เพราะ PNG เป็น lossless
   วัดจริงบน Main project 17/09: `layouts/layout_LINE_APRON_ASSY_*.png` = **8.4 MB**
   (ยังมี 5.3 · 3.0 · 2.5 · 2.4 MB อีกหลายใบ) — จอ TV/แท็บเล็ตที่เปิดผังไลน์ต้องโหลดทั้งก้อน
   egress ฝั่ง Storage วัดได้ **MAIN 70.5 MB/วัน + DR 135.7 MB/วัน ≈ 6 GB/เดือน**
   = **เกินโควต้า Free 5 GB/เดือน ด้วยรูปอย่างเดียว** ก่อนจะนับคิวรีสักตัว

   ═══ ทำไมเป็น WebP ไม่ใช่ "ย่อให้เล็กลง" ═══════════════════════════════════════
   🔴 **ห้ามลดความละเอียดลงจาก 2560px** — เคยลดไป 1600px/0.5MB แล้ว **ผังเบลอจนอ่านไม่ออก**
      (มีคอมเมนต์เตือนไว้ใน LineSetup.jsx มาก่อนแล้ว) ผังต้องซูมอ่านชื่อสถานี/เลขเครื่องได้
   ⇒ วิธีที่ได้ทั้งสองอย่าง: **คงความละเอียดเท่าเดิม เปลี่ยนรูปแบบไฟล์แทน**
      WebP ที่คุณภาพเท่ากันเล็กกว่า PNG ~70-85% สำหรับภาพผัง/สกรีนช็อต และยัง**เก็บ alpha ได้**
      (ต่างจาก JPEG ที่พื้นโปร่งจะกลายเป็นดำ/ขาว)
   · รองรับ: จอ TV ที่ใช้จริง webOS 23 = Chromium 94 — WebP decode มีตั้งแต่ Chrome 32 ✅
     (ดูเพดานเบราว์เซอร์ใน CLAUDE.md — ตัวนี้ไม่ชนเพดาน)

   ⚠️ **กับดักที่ต้องกันไว้: `canvas.toBlob('image/webp')` ไม่ได้มีทุกเบราว์เซอร์**
      Safari รุ่นเก่า (< 16.4) เขียน WebP ไม่ได้ แล้ว**เงียบๆ คืน PNG มาแทน**
      ถ้าเราตั้งนามสกุลไฟล์เป็น `.webp` ไว้ล่วงหน้า จะได้ไฟล์ PNG ที่ชื่อ .webp
      ⇒ **ต้อง derive นามสกุลจาก `blob.type` ที่ได้จริงเสมอ ห้ามเดา** (ฟังก์ชันนี้ทำให้แล้ว)             */
import imageCompression from 'browser-image-compression';

/** ความละเอียดสูงสุดของรูปผัง — ห้ามลด (ผังต้องซูมอ่านชื่อสถานี/เลขเครื่องได้) */
export const LAYOUT_MAX_PX = 2560;

/** เพดานขนาดไฟล์หลังบีบ — WebP ที่ 2560px คุณภาพ 0.9 ปกติได้ ~300-600 KB อยู่แล้ว */
export const LAYOUT_MAX_MB = 1.2;

/** นามสกุลตามชนิดไฟล์จริงที่เบราว์เซอร์คืนมา (ห้ามเดาจากชื่อไฟล์ต้นทาง) */
const extOfType = (type) => ({
  'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
}[String(type || '').toLowerCase()] || 'jpg');

/**
 * บีบรูปเป็น WebP — คืนทั้ง blob และนามสกุลที่ **ตรงกับชนิดจริงที่ได้** (ห้ามเดา)
 *
 * GIF ส่งผ่านทั้งไฟล์ (บีบแล้วการเคลื่อนไหวหาย) — ผู้เรียกต้องกันขนาด GIF เองก่อน
 * ตามกฎเดิมใน ImageCropModal
 *
 * @param {File|Blob} file ไฟล์ที่ผู้ใช้เลือก (ผ่าน toDecodableImage มาแล้ว)
 * @param {object}    [o]
 * @param {number}    [o.maxPx]   ความละเอียดสูงสุด
 * @param {number}    [o.maxMB]   เพดานขนาดไฟล์
 * @param {number}    [o.quality] คุณภาพตั้งต้น
 * @returns {Promise<{blob: Blob, ext: string}>}
 */
export async function compressToWebp(file, { maxPx = LAYOUT_MAX_PX, maxMB = LAYOUT_MAX_MB, quality = 0.9 } = {}) {
  if (file.type === 'image/gif') return { blob: file, ext: 'gif' };
  const blob = await imageCompression(file, {
    maxSizeMB: maxMB,
    maxWidthOrHeight: maxPx,
    initialQuality: quality,
    fileType: 'image/webp',   // ← หัวใจของการลด egress · เบราว์เซอร์ที่เขียนไม่ได้จะคืนชนิดเดิมมา
  });
  // ชนิดที่ "ได้จริง" อาจไม่ใช่ webp (Safari เก่า) — ใช้ตัวนั้นตั้งนามสกุลเสมอ
  return { blob, ext: extOfType(blob.type || file.type) };
}

/** รูปผัง (ผังไลน์ · ผังโรงงาน · ผังเครื่องจักร) — ความละเอียดสูง ห้ามลด */
export const compressLayoutImage = (file) => compressToWebp(file);

/* ── รูปอ้างอิงจุดตรวจ PM / เฟรมหมุน ────────────────────────────────────────
   วัดจริง 16/09: `jig-images/jigs/` = **90.1 MB/วัน** (1,033 ครั้ง × 89 KB) = ก้อนใหญ่สุด
   ฝั่ง Storage ของ DR · ของที่เก็บอยู่ 1,014 ไฟล์ = 102 MB (JPEG 676 + PNG 338)
   ⚠️ รูปพวกนี้ **เคยถูกบีบมาแล้วรอบหนึ่ง** (JPEG q ต่ำ) ⇒ บีบซ้ำเป็น lossy อีกทีจะเสียคุณภาพซ้ำซ้อน
      จึง **ไม่ลดความละเอียดเพิ่ม** (maxPx สูงพอที่จะไม่ไปย่อของเดิม) และใช้ quality สูง 0.85
      ได้ขนาดลดจากการเปลี่ยน**ฟอร์แมต**เป็นหลัก ไม่ใช่จากการทิ้งรายละเอียด                       */
export const PHOTO_MAX_PX = 2000;
export const PHOTO_MAX_MB = 0.35;
export const compressPhotoImage = (file) =>
  compressToWebp(file, { maxPx: PHOTO_MAX_PX, maxMB: PHOTO_MAX_MB, quality: 0.85 });

export default compressLayoutImage;
