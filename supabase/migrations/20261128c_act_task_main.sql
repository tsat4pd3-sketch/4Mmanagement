-- ══ 📅 แผนงานกิจกรรม (ทุกกิจกรรม) · 2026-11-28 · loop smf01 ══════════════════════════════════════════════════════════
-- project: MAIN (ewhdfqwfwofivojtsizn) · คำสั่ง user 28/11 "สร้างแผนงาน (Gantt) · กิจกรรมอื่นจะต้องมีด้วย"
--   · act_task = แผนงานรายปีของกิจกรรมที่ยังไม่มีตารางแผนของตัวเอง (100P · KYT · Kaizen · QCC · Lean · CFO · CFP) — แยกด้วย `activity`
--     (5S ใช้ act02_task · Smart Factory ใช้ act03_task เหมือนเดิม) · 2 ชั้น ข้อหลัก/ข้อย่อย · กติกาวันที่เหมือน act03_task
--   · act02_task + owner_name (ชื่อผู้รับผิดชอบ snapshot ให้ Gantt โชว์ได้ — เดิมมีแค่รหัส)
--   · เขียน act_task = has_perm('act_5s:manage') ชั่วคราว (ชุดเดียวกับ act_strategy) จนกว่ากิจกรรมนั้นมีคีย์ของตัวเอง
-- ย้อนกลับ: drop table public.act_task; alter table public.act02_task drop column owner_name;

create table if not exists public.act_task (
  act_task        uuid primary key default gen_random_uuid(),
  activity        text not null references public.act_activity (code) on update cascade,
  year            int  not null check (year between 2000 and 2100),
  parent_id       uuid references public.act_task (act_task) on delete cascade,
  sort_no         int  not null default 1,
  title           text not null check (char_length(title) between 1 and 200),
  start_date      date,
  end_date        date,
  progress        int  not null default 0 check (progress between 0 and 100),
  owner_code      text,
  owner_name      text,
  note            text,
  done_on         date,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  updated_by_name text,
  constraint act_task_dates check ((start_date is null) = (end_date is null) and (end_date is null or end_date >= start_date)),
  constraint act_task_sub_has_dates check (parent_id is null or start_date is not null)
);
create index if not exists act_task_activity_year_idx on public.act_task (activity, year);

alter table public.act02_task add column if not exists owner_name text;

alter table public.act_task enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'act_task' and policyname = 'act_task_select') then
    create policy act_task_select on public.act_task for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'act_task' and policyname = 'act_task_write') then
    create policy act_task_write on public.act_task for all to authenticated using ((select public.has_perm('act_5s:manage'))) with check ((select public.has_perm('act_5s:manage')));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_task'::regclass and tgname = 'trg_audit') then
    create trigger trg_audit after insert or update or delete on public.act_task for each row execute function public.fn_audit();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_task'::regclass and tgname = 'trg_set_updated_at') then
    create trigger trg_set_updated_at before update on public.act_task for each row execute function public.fn_set_updated_at();
  end if;
end $$;
grant select, insert, update, delete on public.act_task to authenticated;
grant all on public.act_task to service_role;

notify pgrst, 'reload schema';
-- ✅ ลงแล้ว 2026-11-28 ผ่าน MCP · ย้ายแผนงาน 5S จากเว็บเดิม 31 ข้อเข้า act02_task (ผลรวม % 1380 · ข้อย่อย 26 ตรงต้นทาง)
