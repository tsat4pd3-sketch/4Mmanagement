-- ══ 📷 แนบรูปตอน "ตอบ/ปิด" Action Item ของบอร์ด Obeya + ประชุมเช้า — MAIN · ewhdfqwfwofivojtsizn ══
-- 2026-10-12 · คำสั่ง user: *"เพิ่มรูปแนบได้ด้วย ตอนตอบ action ในกราฟ KPI"*
--
-- ที่มา: `meeting_action_items` เก็บได้แค่ตัวอักษร (problem / root_cause / result_value)
-- ⇒ ปิดงานแล้วบอกว่า "แก้แล้ว" แต่ไม่มีหลักฐานว่าแก้อะไรไป · เดือนถัดไปปัญหาเดิมกลับมา
-- ก็เถียงกันไม่จบว่าเคยแก้จริงไหม (ปัญหาเดียวกับสายของเสียที่เพิ่งปิดไป 12/10)
--
-- 🔴 1 คอลัมน์พอ — เก็บ **public URL** (ไม่ใช่ path) รูปแบบเดียวกับ mtn_orders.after_img /
--    quality_bin_records.repair_img · อ่าน/เขียนผ่าน `src/utils/actionImage.js` เท่านั้น (มีด่าน)
-- 🔴 nullable ไม่มี default = "ไม่มีรูป" ไม่ใช่ "ยังไม่โหลด" · แถวเดิมทุกแถวพฤติกรรมเท่าเดิม
-- 🔴 รูปเป็น **ทางเลือก ห้ามบังคับ** — บังคับแนบ = คนเลิกปิดใบ แล้วบอร์ดเต็มไปด้วยงานค้างปลอม
--
-- ย้อนกลับ (ปลอดภัย — คอลัมน์ใหม่ ไม่มีของเดิมพึ่งพา):
--   alter table public.meeting_action_items drop column result_img;
--   delete from storage.objects where bucket_id = 'action-images';
--   delete from storage.buckets where id = 'action-images';
--   (⚠️ `drop column` สั่งผ่าน MCP ไม่ผ่าน — ให้ user รันใน SQL Editor · บทเรียน 12/10)

alter table public.meeting_action_items
  add column if not exists result_img text;

comment on column public.meeting_action_items.result_img is
  'public URL รูปหลักฐานตอนตอบ/ปิด Action Item (ทางเลือก) — เขียนผ่าน src/utils/actionImage.js เท่านั้น';

-- ── ถังเก็บรูป ────────────────────────────────────────────────────────────────
-- public = true (รูปโชว์บนบอร์ด/จอ TV) · เพดาน 5 MB/ไฟล์ เท่าถังอื่น — client บีบเหลือ ~1024px/WebP อยู่แล้ว
-- ⚠️ แยกถังจาก quality-images/mtn-images โดยตั้งใจ: รูปของ action ประชุมมีอายุเอกสารและคนดูแลคนละชุด
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('action-images', 'action-images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

-- policy: อ่าน public (รูปโชว์บนบอร์ด) · เขียน/แก้/ลบ = authenticated
-- ✅ ตารางนี้อยู่ฝั่ง **Main** ซึ่ง client login จริง ⇒ `to authenticated` ใช้ได้
--    (กฎเหล็ก "ห้าม TO authenticated" เป็นของฝั่ง DR ที่วิ่งด้วย anon เสมอ — คนละฝั่ง)
-- 🔴 ไม่มี `drop policy if exists` นำหน้า — **ตั้งใจ** (บทเรียน 12/10 ซ้ำรอยเดิม):
--    MCP รันทั้งก้อนที่มี `drop …` แล้วค้างครบ 60 วิ → rollback ทั้ง migration (ตรวจกลับแล้ว = ไม่มีอะไรลง)
--    แยกเป็น 2 ก้อน (คอลัมน์+ถัง / policy ล้วน) แล้วผ่านทั้งคู่ · **apply แล้ว 2026-10-12 ตรวจกลับ
--    col_ok=1 · bucket_ok=1 · policies=4** · ถ้าต้องรันซ้ำบน env ที่มี policy อยู่แล้ว ให้ลบ policy เก่าก่อนมือ
create policy action_images_read   on storage.objects for select
  using (bucket_id = 'action-images');
create policy action_images_write  on storage.objects for insert to authenticated
  with check (bucket_id = 'action-images');
create policy action_images_update on storage.objects for update to authenticated
  using (bucket_id = 'action-images') with check (bucket_id = 'action-images');
create policy action_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'action-images');
