-- ═══════════════════════════════════════════════════════════════════════════════
-- Backfill Cache-Control ของไฟล์เก่าบน Storage  ·  **DR project "Product DB" (eyhclzkifitbhbljgoav)**
-- 2026-09-11 — คู่กับ `20260911_storage_cache_control_backfill.sql` (Main) · เหตุผลเต็มอยู่ในไฟล์นั้น
--
-- ⚠️ ต่างจากฝั่ง Main ตรงข้อยกเว้น: **ยกเว้น bucket `jig-images` ทั้ง bucket**
--    ไฟล์ในนั้นใช้ path คงที่ (`jigs/<jigId>/frame-<key>.jpg` · `jigs/<jigId>/cp-<key>.jpg`
--    · `facility/<areaId>.jpg`) แล้วอัปทับด้วย `upsert: true` = **URL เดิม เนื้อไฟล์ใหม่**
--    ตั้ง cache ยาวที่นี่ = เปลี่ยนรูปจุดตรวจ PM แล้วหน้างานเห็นรูปเก่าค้างเป็นปี
--    (ฝั่งโค้ดจุดพวกนี้ใช้ `uploadOpts({ mutable: true })` ด้วยเหตุผลเดียวกัน)
--
--    bucket อื่นปลอดภัย — ตรวจแล้วทุกไฟล์มี Date.now() ในชื่อ:
--    `mtn-images` (before/ after/ qa/ sign/ spare/ rack/ die-area/) · `product-images` · `improvement-images`
--
-- ปลอดภัย: แตะแค่ `metadata->>'cacheControl'` · รันซ้ำได้ · rollback อยู่ท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════════════

update storage.objects
set metadata = jsonb_set(metadata, '{cacheControl}', '"max-age=31536000"')
where metadata ? 'cacheControl'
  and metadata->>'cacheControl' <> 'max-age=31536000'
  and bucket_id <> 'jig-images'   -- path คงที่ + upsert → ห้าม cache ยาว
  and name ~ '[0-9]{10,}';        -- ชื่อไฟล์มี Date.now() = ไม่มีวันซ้ำ

-- ตรวจผล (รันแยกได้):
--   select bucket_id, metadata->>'cacheControl' cc, count(*)
--   from storage.objects group by 1,2 order by 1,2;
--
-- rollback (ถ้าจำเป็น):
--   update storage.objects
--   set metadata = jsonb_set(metadata, '{cacheControl}', '"max-age=3600"')
--   where metadata->>'cacheControl' = 'max-age=31536000';
