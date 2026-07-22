-- เลื่อนแผน PM แบบตกลงกันแล้ว (คิวผลิตแน่น/ตัดไฟไม่ได้ ฯลฯ) · DR project (eyhclzkifitbhbljgoav)
-- แยก "เลื่อนแผน (อนุมัติแล้ว)" ออกจาก "เกินกำหนด" — ไม่ให้ขึ้นแดงทั้งที่จัดการแล้ว
-- รอบปีถัดไปยังนับจากวันทำจริง (trigger เดิม last_done + interval) · เลื่อนถูกใช้ไปเมื่อทำ PM รอบใหม่
alter table public.pm_plans add column if not exists deferred_to       date;        -- วันที่เลื่อนแผนไป
alter table public.pm_plans add column if not exists defer_reason      text;        -- เหตุผล (คิวผลิตแน่น ฯลฯ)
alter table public.pm_plans add column if not exists defer_agreed_with text;        -- ตกลงร่วมกับใคร (planner/production)
alter table public.pm_plans add column if not exists deferred_by       text;        -- ผู้บันทึกการเลื่อน
alter table public.pm_plans add column if not exists deferred_at       timestamptz; -- เวลาที่บันทึกการเลื่อน
alter table public.pm_plans add column if not exists defer_count       int default 0; -- จำนวนครั้งที่เลื่อน (สัญญาณ capacity)

-- log ประวัติการเลื่อนทุกครั้ง — ดูย้อนได้ว่าเครื่องไหนโดนเลื่อนบ่อย = ต้องจัดคิว/เพิ่มกำลัง
create table if not exists public.pm_plan_deferrals (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid,
  checklist_id uuid,
  from_due     date,          -- วันครบกำหนดเดิม
  to_due       date,          -- เลื่อนไปวันไหน
  reason       text,
  agreed_with  text,          -- planner/production ที่ตกลงด้วย
  by_name      text,
  by_uid       text,
  created_at   timestamptz default now()
);
alter table public.pm_plan_deferrals enable row level security;
do $$ begin
  create policy pm_plan_deferrals_all on public.pm_plan_deferrals for all using (true) with check (true);
exception when duplicate_object then null; end $$;
grant all on public.pm_plan_deferrals to anon, authenticated;
create index if not exists idx_pm_plan_deferrals_plan on public.pm_plan_deferrals(plan_id);
