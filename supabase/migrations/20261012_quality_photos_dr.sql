-- ═══ 📷 รูปหลักฐานของเสีย — ลงงานเสีย → ถังเหลือง/แดง → ใบรายงานของเสีย (DR project) ═══
-- 2026-10-12 · คำสั่ง user "ทำทั้ง 3 ขั้น เริ่มจากถังเหลือง/แดงก่อน"
--
-- ที่มา: ทั้งสายงานเสียเดิม **ไม่มีการแนบรูปเลยสักขั้น** (วัดจริง 12/10: defect_logs 233 แถว ·
-- quality_bin_records 35 แถว — ไม่มีคอลัมน์รูปทั้งคู่) ⇒ QA ตัดสิน 4 ทาง (good/repair/use_as_is/scrap)
-- โดยไม่มีหลักฐานภาพ · ของถูกย้าย/ทำลายไปแล้วก็สืบย้อนไม่ได้ว่าเสียยังไง
--
-- 🔴 ทุกคอลัมน์เก็บ **public URL** (ไม่ใช่ path) — รูปแบบเดียวกับ mtn_orders.before_img/after_img/qa_img
--    อ่าน/เขียนผ่าน `src/utils/qualityImage.js` เท่านั้น (มีด่าน regressionGuards)
-- 🔴 nullable ทุกตัว ไม่มี default = "ไม่มีรูป" ไม่ใช่ "ยังไม่โหลด" · แถวเดิมทั้งหมดไม่เปลี่ยนพฤติกรรม
--
-- ย้อนกลับ (ปลอดภัย — คอลัมน์ใหม่ทั้งหมด ไม่มีของเดิมพึ่งพา):
--   alter table public.quality_bin_records drop column found_img, drop column repair_img;
--   alter table public.defect_logs         drop column defect_img;
--   alter table public.scrap_report_items  drop column defect_img;
--   alter table public.scrap_report_items  add  column image_path text;   -- คืนคอลัมน์ตายที่ถอดไป 12/10
--   delete from storage.objects where bucket_id = 'quality-images';
--   delete from storage.buckets where id = 'quality-images';

-- ── 1. ถังเหลือง/ถังแดง — 2 รูป ────────────────────────────────────────────────
alter table public.quality_bin_records
  add column if not exists found_img  text,
  add column if not exists repair_img text;

comment on column public.quality_bin_records.found_img  is
  'public URL รูปตอนพบของเสีย/ลงถัง — หลักฐานให้ QA ตัดสิน 4 ทางโดยไม่ต้องเดินไปดูของ · เขียนผ่าน src/utils/qualityImage.js';
comment on column public.quality_bin_records.repair_img is
  'public URL รูปหลังซ่อม/หลังดำเนินการ — คู่กับ repair_detail/repair_by ปิดลูปว่าซ่อมแล้วใช้ได้จริง';

-- ── 2. ลงงานเสียในกะ (Daily Report) — 1 รูป (ทางเลือก ไม่บังคับ) ──────────────
alter table public.defect_logs
  add column if not exists defect_img text;

comment on column public.defect_logs.defect_img is
  'public URL รูปงานเสียตอนลงในกะ — ทางเลือก (หน้างานใส่ถุงมือ/รีบ ห้ามบังคับ) · ไหลต่อไปเป็น found_img ของใบถังเมื่อกดลงถัง';

-- ── 3. ใบรายงานของเสีย FM-PD2-002 — 1 รูปต่อรายการ ───────────────────────────
-- ⚠️ `scrap_report_items` ถูก **ลบทั้งชุดแล้ว insert ใหม่** ทุกครั้งที่บันทึกใบ (ScrapReport.jsx)
--    ⇒ URL ต้องถูกพากลับมาใน payload ทุกรอบ · path ในถังห้ามผูกกับ id ของแถว (id เปลี่ยนทุกการบันทึก)
alter table public.scrap_report_items
  add column if not exists defect_img text;

comment on column public.scrap_report_items.defect_img is
  'public URL รูปของเสียในใบรายงาน — ปกติสืบทอดมาจาก quality_bin_records.found_img ผ่าน src_bin_id · แนบเองได้เฉพาะรายการที่ไม่มีต้นทาง';

-- `image_path` = คอลัมน์ตาย ไม่เคยถูกเขียนเลย (12/10 วัดได้ 0 จาก 8 แถว) และไม่มีโค้ดบรรทัดไหนอ่าน/เขียน
-- (grep ทั้งรีโป: image_path ที่เหลือเป็นของ jigs / jig_checkpoints / pm_facility_areas คนละตาราง)
-- ✅ **drop แล้ว 2026-10-12** (user รันเองใน Supabase SQL Editor · ตรวจกลับแล้ว = 0 คอลัมน์)
--    ปลอดภัยเพราะตอนถอด: 8 แถว กรอก image_path 0 แถว · grep ทั้งรีโปไม่มีโค้ดอ่าน/เขียน ·
--    ไม่มี view/rule ไหน depend คอลัมน์นี้
--
-- 🔴 บทเรียนสำหรับ session ถัดไป — **`drop column` สั่งผ่าน MCP ไม่ได้** (ลองแล้ว 4 ครั้ง)
--    ค้างครบ 60 วิทุกครั้งแล้ว rollback · **ไม่ใช่การรอ lock**: ตั้ง `lock_timeout='3s'` +
--    `statement_timeout='10s'` แล้วยังค้าง 60 วิ (ถ้า statement ทำงานจริงต้องถูกฆ่าที่ 10 วิ)
--    · `add column` / `comment on column` บนตารางเดียวกันผ่านฉลุย ⇒ เป็นข้อจำกัดของ**ท่อ** ไม่ใช่ schema
--    ⇒ **อย่าเสียเวลาลองซ้ำ — ส่ง SQL ให้ user รันใน SQL Editor พร้อมคิวรีเช็คผล**

-- ── 4. ถังเก็บรูป ─────────────────────────────────────────────────────────────
-- public = true · เพดาน 5 MB/ไฟล์ (เท่า mtn-images) — ฝั่ง client บีบเหลือ ~1024px/WebP อยู่แล้ว
insert into storage.buckets (id, name, public, file_size_limit)
values ('quality-images', 'quality-images', true, 5242880)
on conflict (id) do nothing;

-- 🔴 policy ต้องเป็น {anon, authenticated} — `supabaseDR` ไม่เคย authenticate (กฎเหล็ก CLAUDE.md)
--    ตั้ง TO authenticated = แนบรูปไม่ได้ทั้งโรงงาน · ลอกชุดเดียวกับ mtn_images_* ที่ใช้งานจริงอยู่
drop policy if exists quality_images_read   on storage.objects;
drop policy if exists quality_images_insert on storage.objects;
drop policy if exists quality_images_update on storage.objects;
drop policy if exists quality_images_delete on storage.objects;

create policy quality_images_read   on storage.objects for select
  to anon, authenticated using (bucket_id = 'quality-images');
create policy quality_images_insert on storage.objects for insert
  to anon, authenticated with check (bucket_id = 'quality-images');
create policy quality_images_update on storage.objects for update
  to anon, authenticated using (bucket_id = 'quality-images') with check (bucket_id = 'quality-images');
create policy quality_images_delete on storage.objects for delete
  to anon, authenticated using (bucket_id = 'quality-images');
