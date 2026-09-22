-- 📎 แนบรูปหน้าจอในกล่อง feedback (Main project · 2026-09-22)
--
-- ที่มา: คุณสุรเสน (ทีมงาน) แจ้งทาง LINE 22/09 ว่า "ตอนผมรายงานบัคไป เพิ่มให้มีแนบรูป"
-- แล้วส่งสกรีนช็อตที่เขาวงกรอบสี 3 จุด (แดง=แก้ไข · เหลือง=เปลี่ยนชื่อ · ฟ้า=จัดคอลัมน์) มาให้ดู
-- ⇒ เขาวงกรอบเองบนมือถืออยู่แล้ว แค่ไม่มีที่แนบเข้าระบบ เลยต้องส่ง LINE ตามหลังทุกครั้ง
--
-- 🔴 ที่แย่กว่านั้น: ตัวฟอร์มเองเขียนบอกผู้ใช้ไว้ว่า
--    "ถ้ามีรูปหน้าจอ ส่งใน LINE ตามหลังได้ (ระบบยังไม่รับไฟล์แนบ)"
--    = ระบบสั่งให้คนเดินออกไปนอกระบบเอง ซึ่งขัดกับเหตุผลที่สร้างกล่องนี้ตั้งแต่แรก
--    (กล่อง feedback เกิดเพราะ "เดิม feedback วิ่งผ่าน LINE → ตกหล่น ค้นย้อนไม่ได้")

-- ── 1) คอลัมน์เก็บ URL รูป ────────────────────────────────────────────────────
-- text[] ไม่ใช่ตารางลูก: 1 เรื่องแนบได้ไม่กี่รูป ไม่ต้อง query แยก ไม่ต้อง join
-- default '{}' + nullable-safe ⇒ แถวเก่า 100% ยังอ่านได้เหมือนเดิม (backward-compatible)
alter table public.user_feedback add column if not exists images text[] not null default '{}';

comment on column public.user_feedback.images is
  'URL รูปหน้าจอที่ผู้แจ้งแนบมา (bucket feedback-images) — เรียงตามลำดับที่เลือก · [] = ไม่ได้แนบ';

-- ── 2) bucket ─────────────────────────────────────────────────────────────────
-- ⚠️ ไม่รับ image/gif: สกรีนช็อตไม่ต้องใช้ GIF และ GIF บีบไม่ได้ (เฉลี่ย 4.3 MB/ไฟล์)
--    เคยทำ egress ทะลุโควต้าจน Supabase ล็อกทั้ง organization มาแล้ว (ดู CLAUDE.md "Storage & รูปภาพ")
--    ฝั่ง client ปฏิเสธพร้อม toast บอกเหตุผลก่อนถึงตรงนี้ — ตรงนี้เป็นด่านสอง
-- เพดาน 5 MB = ขนาด "ก่อนบีบ" ที่ยอมให้เลือก · ที่อัปจริงเป็น WebP ~100-400 KB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-images', 'feedback-images', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- อ่าน: public — รูปโชว์ในกล่องขาเข้า และลิงก์ถูกส่งเข้า Telegram ให้กดดูได้
-- (ระดับเดียวกับ bucket อื่นทั้งระบบ เช่น signatures/employee-photos ซึ่งอ่อนไหวกว่าสกรีนช็อตด้วยซ้ำ)
drop policy if exists feedback_images_read on storage.objects;
create policy feedback_images_read on storage.objects
  for select using (bucket_id = 'feedback-images');

-- เขียน: ต้อง login และ **ลงได้เฉพาะโฟลเดอร์ของตัวเอง** (path = <auth.uid()>/<ไฟล์>)
-- แคบกว่า bucket อื่นในระบบโดยตั้งใจ: รูปพวกนี้มาจาก "ใครก็ได้ที่ login" ไม่ได้ผ่านหน้าที่มีสิทธิ์คุม
drop policy if exists feedback_images_write on storage.objects;
create policy feedback_images_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback-images'
              and (storage.foldername(name))[1] = auth.uid()::text);

-- ลบ: เจ้าของรูป (ถอนก่อนส่ง / ส่งพลาด) หรือ admin/manager (เก็บกวาดในกล่องขาเข้า)
-- ⚠️ ถ้าลืม policy นี้ RLS จะปฏิเสธแบบ "สำเร็จ 0 แถว ไม่มี error" — ปุ่มลบจะเงียบสนิท
--    (กฎเหล็กการเขียน DB จาก client ข้อ 2 ใน CLAUDE.md)
drop policy if exists feedback_images_delete on storage.objects;
create policy feedback_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback-images'
         and ((storage.foldername(name))[1] = auth.uid()::text
              or exists (select 1 from public.profiles p
                         where p.id = auth.uid() and p.role in ('admin','manager'))));

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (ย้อนได้ ไม่กระทบของเดิม — แถวเก่าไม่เคยมีคอลัมน์นี้อยู่แล้ว)
--   drop policy if exists feedback_images_read   on storage.objects;
--   drop policy if exists feedback_images_write  on storage.objects;
--   drop policy if exists feedback_images_delete on storage.objects;
--   delete from storage.objects where bucket_id = 'feedback-images';   -- ลบไฟล์ก่อน ไม่งั้น bucket ลบไม่ออก
--   delete from storage.buckets where id = 'feedback-images';
--   alter table public.user_feedback drop column if exists images;
-- ⚠️ ลำดับ: revert โค้ดก่อน แล้วค่อยแตะ schema (โค้ดเก่าไม่รู้จักคอลัมน์ images อยู่แล้ว จึงปลอดภัยทั้งสองทาง)
-- ═══════════════════════════════════════════════════════════════════════════
