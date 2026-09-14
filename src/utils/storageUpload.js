/* ── storageUpload — อายุ cache ของไฟล์บน Supabase Storage จุดเดียวของทั้งแอป (2026-09-11) ──

   ทำไมต้องมี — **ต้นเหตุที่ทำให้ egress เกินโควต้าจนระบบล็อกทั้งองค์กร (11 ก.ย. 2026)**
   `supabase.storage.upload()` ถ้าไม่ส่ง `cacheControl` มา จะใช้ค่า default = **max-age=3600 (1 ชม.)**
   → เบราว์เซอร์/CDN ทิ้ง cache ทุกชั่วโมงแล้ว**โหลดรูปใหม่ทั้งชุด**
   วัดจริงวันที่ล็อก: `employee-photos` 229 รูป = 124 MB · เปิดหน้าเช็คชื่อ/Management
   ที่โชว์รูปทั้งไลน์ = จ่าย egress ซ้ำทุกชั่วโมง ทั้งที่**ไฟล์ไม่เคยเปลี่ยน**
   (ตรวจแล้ว: 25 จุดอัปโหลดทั้งระบบ **ไม่มีสักจุดเดียว**ที่ตั้ง cacheControl)

   ── หลักที่ใช้ตัดสิน (สำคัญกว่าตัวเลข) ────────────────────────────────────────
   **"URL นี้ถูกเขียนทับด้วยไฟล์ใหม่ได้ไหม"** ไม่ใช่ "รูปเปลี่ยนบ่อยไหม"
   · path มี `Date.now()`/uuid = เปลี่ยนรูป = **URL ใหม่เสมอ** → ของเก่าไม่มีใครเรียกอีก
     ⇒ cache ยาวได้เต็มที่ ไม่มีทางเห็นของเก่าค้าง (`IMMUTABLE`)
   · path คงที่ + `upsert: true` = **ทับไฟล์เดิมที่ URL เดิม** → cache ยาว = คนเห็นรูปเก่าค้างเป็นปี
     ⇒ ต้องสั้นเท่าเดิม (`MUTABLE`)

   ⚠️ **จุดอัปโหลดใหม่ทุกจุดต้องเรียก `uploadOpts()` ห้ามส่ง object ดิบเข้า `.upload()`**
      มีเทสบังคับไว้แล้ว (`__tests__/storageUpload.test.mjs`) — ลืมแล้ว `npm run build` ไม่ผ่าน
      และถ้า path ที่ใช้เป็น path คงที่ (ทับได้) **ต้องใส่ `mutable: true`** ไม่งั้นผู้ใช้จะเห็นรูปเก่า

   ⚠️ ไฟล์ที่อัปไปก่อนหน้านี้ฝัง `max-age=3600` ไว้ใน `storage.objects.metadata` แล้ว
      แก้โค้ดอย่างเดียวไม่ย้อนไปช่วยของเก่า — backfill ด้วย migration
      `20260911_storage_cache_control_backfill.sql` (Main) / `..._dr.sql` (DR)                    */

/** ไฟล์ที่ path ไม่มีวันซ้ำ (มี Date.now()/uuid) — เปลี่ยนรูป = URL ใหม่ ⇒ cache ได้ยาวสุด */
export const CACHE_IMMUTABLE = '31536000';   // 1 ปี

/** ไฟล์ที่ทับ path เดิมได้ (upsert + path คงที่) — ยาวกว่านี้ = ผู้ใช้เห็นรูปเก่าค้าง */
export const CACHE_MUTABLE = '3600';         // 1 ชม. (= ค่า default เดิมของ Supabase)

/**
 * ห่อ options ของ `storage.upload()` ให้มี cacheControl เสมอ
 *
 * @param {object}  opts              options เดิมที่จะส่งให้ `.upload()` (upsert/contentType ฯลฯ)
 * @param {boolean} opts.mutable      true = path คงที่ ทับไฟล์เดิมได้ → cache สั้น
 *                                    (ค่า default false = path มี timestamp/uuid → cache 1 ปี)
 * @returns options เดิม + cacheControl  (ระบุ cacheControl มาเองจะชนะเสมอ)
 */
export function uploadOpts(opts = {}) {
  const { mutable = false, ...rest } = opts;
  return { cacheControl: mutable ? CACHE_MUTABLE : CACHE_IMMUTABLE, ...rest };
}

export default uploadOpts;
