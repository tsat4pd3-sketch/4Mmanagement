-- ═══════════════════════════════════════════════════════════════════════════════
-- Backfill Cache-Control ของไฟล์เก่าบน Storage  ·  **MAIN project (ewhdfqwfwofivojtsizn)**
-- 2026-09-11 — แก้ต้นเหตุที่ทำให้ egress ทะลุโควต้าจน Supabase ล็อกบริการทั้ง organization
--              (ผู้ใช้ทั้งโรงงาน login ไม่ได้: "exceed_egress_quota")
--
-- ปัญหา: `storage.upload()` ที่ไม่ส่ง `cacheControl` จะได้ค่า default **max-age=3600 (1 ชม.)**
--        ตรวจแล้วพบว่า **25 จุดอัปโหลดทั้งระบบไม่มีสักจุดที่ตั้งค่านี้** → ทุกไฟล์อายุ cache 1 ชม.
--        `employee-photos` อย่างเดียว 229 รูป = 124 MB · หน้าเช็คชื่อ/Management โชว์รูปทั้งไลน์
--        ⇒ จ่าย egress ซ้ำทุกชั่วโมงทั้งที่ไฟล์ไม่เคยเปลี่ยน
--        แก้โค้ด (uploadOpts ใน src/utils/storageUpload.js) ช่วยเฉพาะไฟล์ใหม่ —
--        ไฟล์เก่าฝัง max-age=3600 ไว้ใน metadata แล้ว ต้อง backfill ด้วยไฟล์นี้
--
-- เงื่อนไขที่ใช้ตัดสิน (พิสูจน์ได้ ไม่ใช่ไล่รายชื่อ bucket):
--   ตั้ง 1 ปี **เฉพาะไฟล์ที่ชื่อมีเลข timestamp 10 หลักขึ้นไป** = ชื่อไฟล์ไม่มีวันซ้ำ
--   ⇒ เปลี่ยนรูป = URL ใหม่เสมอ ⇒ ไม่มีทางที่ใครจะเห็นรูปเก่าค้าง
--   ไฟล์ที่ชื่อคงที่ (ทับไฟล์เดิมที่ URL เดิมได้) ไม่แตะ — ปล่อยไว้ที่ 1 ชม. ตามเดิม
--
-- ปลอดภัย: แตะแค่ `metadata->>'cacheControl'` (ไม่แตะไฟล์/ไม่แตะ path/ไม่แตะสิทธิ์)
--          รันซ้ำได้ (idempotent) · rollback = รัน UPDATE ท้ายไฟล์ที่ comment ไว้
-- ═══════════════════════════════════════════════════════════════════════════════

update storage.objects
set metadata = jsonb_set(metadata, '{cacheControl}', '"max-age=31536000"')
where metadata ? 'cacheControl'
  and metadata->>'cacheControl' <> 'max-age=31536000'
  and name ~ '[0-9]{10,}';        -- ชื่อไฟล์มี Date.now() = ไม่มีวันซ้ำ

-- ตรวจผล (รันแยกได้):
--   select bucket_id, metadata->>'cacheControl' cc, count(*)
--   from storage.objects group by 1,2 order by 1,2;
--
-- rollback (ถ้าจำเป็น — จะกลับไปกิน egress เท่าเดิม):
--   update storage.objects
--   set metadata = jsonb_set(metadata, '{cacheControl}', '"max-age=3600"')
--   where metadata->>'cacheControl' = 'max-age=31536000';
