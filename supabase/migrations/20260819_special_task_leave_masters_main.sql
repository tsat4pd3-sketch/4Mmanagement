-- ═══ master งานนอกไลน์ + ประเภทลา — เลิก hardcode ในหน้า (QC audit dropdown 2026-08-18) ═══
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- เดิม: Management.jsx SPECIAL_TASKS + Checkin.jsx LEAVE_TYPES เป็น const ในโค้ด —
--   เพิ่ม/แก้ต้องแก้โค้ด และตอน rollout โรงงานอื่นเรียกไม่เหมือนกัน (เป้าโปรเจค prototype ทุกโรงงาน)
-- โครงเดียวกับ ot_task_types/bus_routes (master ของหน้าเช็คชื่อที่ทำไว้แล้ว) · seed = ค่าเดิมในโค้ด
--   เป๊ะ → พฤติกรรมไม่เปลี่ยนจนกว่าจะมีคนแก้เอง · โค้ดอ่าน best-effort (ตารางว่าง/ยังไม่ apply = fallback ค่าเดิม)
-- จัดการจาก UI: แผงจองรถ OT ใน /report (สิทธิ์ ot_master:manage เดิม — ไม่เพิ่ม permission key ใหม่
--   เลี่ยงกับดัก seed enum_range · เป็น master กลุ่มเดียวกัน "ของหน้าเช็คชื่อ/จัดกำลังคน")
--
-- Rollback: drop table special_task_types; drop table leave_types;
--   (โค้ด fallback ค่าเดิม — ไม่พัง)

create table if not exists public.special_task_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.special_task_types enable row level security;
alter table public.leave_types enable row level security;
do $$ begin
  create policy special_task_types_all on public.special_task_types for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy leave_types_all on public.leave_types for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- seed = ค่าที่ hardcode ในโค้ดเดิมเป๊ะ (ลำดับเดิม)
insert into public.special_task_types (name, sort_order)
select v.name, v.so from (values
  ('5ส', 1), ('คัดงาน', 2), ('แก้ไขปัญหาคุณภาพ', 3), ('งานปรับปรุงไลน์', 4), ('อื่นๆ', 5)
) as v(name, so)
where not exists (select 1 from public.special_task_types t where t.name = v.name);

insert into public.leave_types (name, sort_order)
select v.name, v.so from (values
  ('ลากิจ', 1), ('ลาป่วย', 2), ('ลาพักร้อน', 3), ('อื่นๆ', 4)
) as v(name, so)
where not exists (select 1 from public.leave_types t where t.name = v.name);
