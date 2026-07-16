-- ═══════════════════════════════════════════════════════════════════
-- Improvements (Kaizen) module — DR project (eyhclzkifitbhbljgoav)
-- ตารางโปรเจคปรับปรุง ผูกกับปัญหาจริง (dr_downtime_types / dr_defect_types)
-- ระบบเทียบผลก่อน/หลังวันเริ่มแก้จาก downtime_logs / defect_logs สดๆ ไม่ต้องกรอกผลเอง
-- RLS: anon-open ตาม convention ฝั่ง DR — client `supabaseDR` ไม่มี JWT
--      do NOT switch to TO authenticated (ดูกฎเหล็กใน CLAUDE.md "Supabase Projects")
-- ═══════════════════════════════════════════════════════════════════

create table if not exists improvements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  line_name text not null,
  machine_no text,                       -- จุด/เครื่องจักร (null = ทั้งไลน์)
  mat_no text,                           -- สินค้า/พาร์ท (null = ทุกสินค้า)
  problem_source text not null default 'downtime'
    check (problem_source in ('downtime','defect')),
  problem_type_id uuid,                  -- dr_downtime_types.id หรือ dr_defect_types.id ตาม source
  problem_label text,                    -- snapshot ชื่อปัญหาตอนสร้าง (กัน master ถูกลบ/เปลี่ยนชื่อ)
  description text,                      -- สภาพปัญหา / สาเหตุ
  action_taken text,                     -- การแก้ไข / countermeasure
  image_before_url text,
  image_after_url text,
  start_date date not null,              -- วันเริ่มแก้ไข = จุดตัดเทียบก่อน/หลัง
  baseline_days integer not null default 30,  -- หน้าต่างเทียบ (วัน) ทั้งฝั่งก่อนและหลัง
  status text not null default 'monitoring'
    check (status in ('monitoring','done','cancelled')),
  result_note text,                      -- สรุปผลตอนปิดโปรเจค
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_improvements_line on improvements(line_name);
create index if not exists idx_improvements_status on improvements(status);

alter table improvements enable row level security;
drop policy if exists improvements_all on improvements;
create policy improvements_all on improvements
  for all to public using (true) with check (true);

-- bucket รูป before/after — client บีบ 1280px q0.85 ก่อนอัปโหลด (~100-300KB/รูป)
-- cap 5MB กันพลาดอัปโหลดรูปดิบ
insert into storage.buckets (id, name, public, file_size_limit)
values ('improvement-images', 'improvement-images', true, 5242880)
on conflict (id) do nothing;

drop policy if exists public_read_improvement_images on storage.objects;
create policy public_read_improvement_images on storage.objects
  for select using (bucket_id = 'improvement-images');
drop policy if exists anon_upload_improvement_images on storage.objects;
create policy anon_upload_improvement_images on storage.objects
  for insert with check (bucket_id = 'improvement-images');
drop policy if exists anon_update_improvement_images on storage.objects;
create policy anon_update_improvement_images on storage.objects
  for update using (bucket_id = 'improvement-images');
drop policy if exists anon_delete_improvement_images on storage.objects;
create policy anon_delete_improvement_images on storage.objects
  for delete using (bucket_id = 'improvement-images');
