-- QA Inspection Setup — Part master + Drawing upload + มาตรฐานจุดตรวจ (หน้า /qa-setup)
-- Target project: MAIN (ewhdfqwfwofivojtsizn) — client `supabase` (authenticated)
-- PURELY ADDITIVE — ตารางใหม่ 2 ตาราง + storage bucket ใหม่ + seed permission page:/qa-setup
--
--   qa_parts             part master ฝั่ง QA + drawing (url, revision)
--   qa_inspection_items  จุดตรวจตามแบบ (balloon บน drawing + spec/วิธีวัด/ความถี่)
--
-- สิทธิ์เขียนใช้ key เดิม qa:manage (admin/manager/qa) — ไม่เพิ่ม key ใหม่

-- ── Part master ─────────────────────────────────────────────────────────────
create table if not exists qa_parts (
  id                 uuid primary key default gen_random_uuid(),
  part_no            text not null unique,
  part_name          text,
  customer           text,
  model              text,
  line_name          text,
  drawing_url        text,
  drawing_rev        text,                -- revision ของแบบ เช่น "Rev.C"
  drawing_updated_at timestamptz,
  is_active          boolean not null default true,
  created_by         text,
  created_at         timestamptz not null default now()
);

-- ── จุดตรวจตามแบบ (1 แถว = 1 balloon/หัวข้อตรวจ) ───────────────────────────
create table if not exists qa_inspection_items (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references qa_parts(id) on delete cascade,
  balloon_no    int  not null,
  pos_x         numeric,                  -- ตำแหน่ง balloon บน drawing (% ของกว้าง/สูง)
  pos_y         numeric,
  item_type     text not null default 'variable'
                check (item_type in ('variable','attribute')),
  characteristic text not null,           -- ชื่อจุดตรวจ เช่น "ความกว้างร่อง A"
  spec_text     text,                     -- สเปคตามแบบ เช่น "12.5 ±0.1" หรือ "ไม่มีครีบ"
  nominal       numeric,
  usl           numeric,
  lsl           numeric,
  unit          text,
  method        text,                     -- เครื่องมือ/วิธีตรวจ เช่น Vernier, Checking fixture, Visual
  stage         text not null default 'inprocess'
                check (stage in ('incoming','setup_first','inprocess','final','patrol')),
  frequency     text,                     -- เช่น "5 ชิ้น/กะ", "ทุก lot", "ชิ้นแรกหลังตั้งเครื่อง"
  sample_size   int,
  control_item  boolean not null default false,  -- จุดควบคุมพิเศษ (◇ / SC / CC)
  is_active     boolean not null default true,
  remark        text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_qa_inspection_items_part
  on qa_inspection_items (part_id, balloon_no);

-- ── RLS: อ่านทุก authenticated / เขียนเฉพาะ qa:manage ──────────────────────
alter table qa_parts            enable row level security;
alter table qa_inspection_items enable row level security;

drop policy if exists qa_parts_select on qa_parts;
create policy qa_parts_select on qa_parts
  for select to authenticated using (true);
drop policy if exists qa_parts_write on qa_parts;
create policy qa_parts_write on qa_parts
  for all to authenticated
  using ((select has_perm('qa:manage')))
  with check ((select has_perm('qa:manage')));

drop policy if exists qa_inspection_items_select on qa_inspection_items;
create policy qa_inspection_items_select on qa_inspection_items
  for select to authenticated using (true);
drop policy if exists qa_inspection_items_write on qa_inspection_items;
create policy qa_inspection_items_write on qa_inspection_items
  for all to authenticated
  using ((select has_perm('qa:manage')))
  with check ((select has_perm('qa:manage')));

-- ── Storage bucket สำหรับ drawing (public read เหมือน employee-photos) ─────
insert into storage.buckets (id, name, public)
values ('qa-drawings', 'qa-drawings', true)
on conflict (id) do nothing;

drop policy if exists qa_drawings_read on storage.objects;
create policy qa_drawings_read on storage.objects
  for select to public using (bucket_id = 'qa-drawings');
drop policy if exists qa_drawings_insert on storage.objects;
create policy qa_drawings_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'qa-drawings' and (select public.has_perm('qa:manage')));
drop policy if exists qa_drawings_update on storage.objects;
create policy qa_drawings_update on storage.objects
  for update to authenticated
  using (bucket_id = 'qa-drawings' and (select public.has_perm('qa:manage')));
drop policy if exists qa_drawings_delete on storage.objects;
create policy qa_drawings_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'qa-drawings' and (select public.has_perm('qa:manage')));

-- ── Seed permission ─────────────────────────────────────────────────────────
insert into role_permissions (role, permission_key, allowed)
select r::user_role, 'page:/qa-setup', true
from unnest(array['admin','manager','qa']) as r
on conflict (role, permission_key) do nothing;
