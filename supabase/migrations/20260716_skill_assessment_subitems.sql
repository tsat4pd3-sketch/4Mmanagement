-- ══════════════════════════════════════════════════════════════════════════
-- Skill assessment sub-items (หัวข้อการพิจารณา) — master สำหรับใบประเมินรายบุคคล
-- (Main project) · 2026-07-16
--
-- ที่มา: ฟอร์มกระดาษ "ใบประเมินทักษะความสามารถของพนักงาน" (F-PRS-P1-119-0) แต่ละสกิล
-- มีหัวข้อการพิจารณาย่อยหลายข้อ (เช่น Production Control = วางแผนการผลิต / บันทึกผลการผลิต / ...)
-- ระบบเดิมเก็บแค่คะแนนเดียว 0-100 ต่อ (พนักงาน, สกิล) — ตารางนี้เพิ่ม "รายการหัวข้อย่อย"
-- ต่อสกิล (โหมด Hybrid: ข้อความหัวข้อจริงจาก master, ค่าติ๊ก 4 ระดับ derive จากคะแนนสกิลใน export)
--
-- Additive ล้วน — ไม่กระทบ employee_skills / skill_definitions เดิม · ถ้าสกิลไหนไม่มีหัวข้อย่อย
-- ใบประเมินจะ fallback เป็น 1 แถว = ชื่อสกิลนั้น
--
-- Rollback: drop table public.skill_sub_items;  (ไม่มีอะไรอ้างถึงใน schema อื่น)
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.skill_sub_items (
  id         uuid primary key default gen_random_uuid(),
  skill_name text        not null,              -- = skill_definitions.name
  seq        integer     not null default 1,    -- ลำดับหัวข้อในสกิล
  label      text        not null,              -- ข้อความหัวข้อการพิจารณา
  wi_ref     text,                              -- อ้างอิง WI/เอกสาร (เช่น WI-PD4-001) — optional
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_skill_sub_items_skill on public.skill_sub_items (skill_name, seq);

alter table public.skill_sub_items enable row level security;

-- อ่านได้ทุก role ที่ login (ใช้ตอน export ใบประเมิน)
create policy skill_sub_items_select_authenticated
  on public.skill_sub_items
  for select
  to authenticated
  using (true);

-- เขียนได้เฉพาะ role ที่แก้ master data ได้ (ตรงกับสิทธิ์แก้ skill_definitions ในหน้า operator)
create policy skill_sub_items_write_privileged
  on public.skill_sub_items
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin','manager','supervisor','leader']::user_role[])
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin','manager','supervisor','leader']::user_role[])
    )
  );

revoke all on public.skill_sub_items from anon;
