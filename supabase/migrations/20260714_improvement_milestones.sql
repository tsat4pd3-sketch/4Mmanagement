-- ═══════════════════════════════════════════════════════════════════
-- Milestone/แผนงานของโปรเจคปรับปรุง (Improvements → Gantt) — DR project
-- คำสั่ง user 2026-07-14: Improvements เดิมเป็นฟอร์มบันทึกทีเดียวจบ ไม่ตรงใจ —
-- ต้องการแบบ gantt chart / project milestone เอาไว้ตามงานโปรเจคของทีม
-- แต่ละโปรเจคมีขั้นงาน (มาตรฐาน PDCA 5 ขั้น seed ให้ตอนสร้าง แก้/เพิ่ม/ลบได้อิสระ)
-- RLS: anon-open ตาม convention ฝั่ง DR — do NOT switch to TO authenticated
-- ═══════════════════════════════════════════════════════════════════

create table if not exists improvement_milestones (
  id uuid primary key default gen_random_uuid(),
  improvement_id uuid not null references improvements(id) on delete cascade,
  title text not null,
  assignee text,                    -- ผู้รับผิดชอบ (ชื่ออิสระ)
  planned_start date,
  planned_end date,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  done_at date,                     -- วันที่ปิดขั้นจริง (stamp ตอนกด done)
  sort_order int not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_imp_milestones_imp on improvement_milestones(improvement_id, sort_order);

alter table improvement_milestones enable row level security;
drop policy if exists imp_milestones_all on improvement_milestones;
create policy imp_milestones_all on improvement_milestones
  for all to public using (true) with check (true);
