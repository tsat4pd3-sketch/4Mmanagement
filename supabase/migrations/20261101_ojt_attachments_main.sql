-- ── Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn) ──
-- 📎 ไฟล์แนบของใบอบรม OJT (FM-HRM-004) — หน้างาน PD4 ขอ 01/11:
--    "OJT ขอเพิ่มแนบรูปภาพ/เพิ่มเอกสารได้ด้วยครับ"
--    (รูปบรรยากาศการสอน · สำเนา WI/OPS ที่ใช้สอน · ใบทดสอบที่พนักงานทำ)
-- หน้า /ojt-training (src/pages/OjtTraining.jsx) · อัปผ่าน src/utils/fileAttach.js
--
-- ย้อนกลับ (ไม่กระทบของเดิม — ตารางนี้ไม่มีใครอ้างถึง):
--   drop table if exists ojt_training_files;
--   delete from storage.objects where bucket_id = 'ojt-files';
--   delete from storage.buckets where id = 'ojt-files';

create table if not exists ojt_training_files (
  id           uuid primary key default gen_random_uuid(),
  training_id  uuid not null references ojt_trainings(id) on delete cascade,
  file_url     text not null,            -- public URL ใน bucket ojt-files
  file_name    text,                     -- ชื่อไฟล์เดิมที่ผู้ใช้เลือก (โชว์บนจอ — URL เป็น timestamp อ่านไม่รู้เรื่อง)
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid,
  uploaded_name text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ojt_files_training on ojt_training_files(training_id);

alter table ojt_training_files enable row level security;
-- pattern เดียวกับ ojt_trainings / ojt_training_attendees (policy เปิด authenticated · คุมสิทธิ์ที่ชั้นจอ
-- ด้วย role_permissions `ojt:record` / `ojt:delete`) — ห้ามเขียนให้แคบกว่า 2 ตารางพี่น้อง
-- ไม่งั้นลบใบ (cascade) จะลบลูกไม่ผ่าน = ใบหายแต่ไฟล์แนบค้าง
drop policy if exists "ojt_files_all" on ojt_training_files;
create policy "ojt_files_all" on ojt_training_files for all to authenticated using (true) with check (true);

-- ── Storage — bucket ไฟล์แนบ OJT · 20MB · รูป + PDF + office (สเปคเดียวกับ npi-files) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ojt-files', 'ojt-files', true, 20971520,
        array['application/pdf','image/jpeg','image/png','image/webp','image/gif',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;
drop policy if exists ojt_files_read   on storage.objects;
create policy ojt_files_read   on storage.objects for select using (bucket_id = 'ojt-files');
drop policy if exists ojt_files_write  on storage.objects;
create policy ojt_files_write  on storage.objects for insert to authenticated with check (bucket_id = 'ojt-files');
drop policy if exists ojt_files_update on storage.objects;
create policy ojt_files_update on storage.objects for update to authenticated using (bucket_id = 'ojt-files');
drop policy if exists ojt_files_delete on storage.objects;
create policy ojt_files_delete on storage.objects for delete to authenticated using (bucket_id = 'ojt-files');

-- ── คิวรีตรวจผล ──
-- select count(*) from ojt_training_files;                                  -- 0 (ตารางใหม่ ยังไม่มีไฟล์)
-- select id, public, file_size_limit from storage.buckets where id='ojt-files';
-- select policyname from pg_policies where tablename='objects' and policyname like 'ojt_files%';   -- ต้องได้ 4 แถว
