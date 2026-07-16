-- ══════════════════════════════════════════════════════════════════════════
-- Skill EXP farming — ย้ายฝั่ง server ทั้งหมด + ปิดช่อง farm (Main project)
-- 2026-07-13
--
-- ปัญหาที่แก้ (ดู CLAUDE.md "Employee Skills & EXP Farming"):
--   1. Daily farming (+1) เดิมอยู่ใน Checkin.jsx ฝั่ง client — กดบันทึกซ้ำ = +1 ซ้ำ
--      ไม่จำกัด, เหมาพนักงานทุกไลน์ทั้งโรงงาน, ข้ามเพดานขั้น 25/50/75 โดยไม่ผ่านอนุมัติ
--   2. fn_weekly_skill_update เปิด EXECUTE ให้ anon/PUBLIC และเรียกซ้ำ = +2/-2 ซ้ำ
--   3. cron weekly ตั้ง '5 8 * * 1' (UTC) = จันทร์ 15:05 ไทย — ตั้งใจให้เป็น 08:05 ไทย
--   4. employee_skills RLS = auth_all (authenticated เขียนคะแนนใครก็ได้เป็นเท่าไหร่ก็ได้)
--
-- Rollback (เรียงลำดับปลอดภัย — revert โค้ดก่อนเสมอ):
--   1) git revert โค้ด (คืน farming ใน Checkin.jsx)
--   2) คืน RLS เดิม: drop 2 policies ใหม่ของ employee_skills แล้ว
--      create policy auth_all on employee_skills for all to authenticated using(true) with check(true);
--      grant all on employee_skills to anon;  -- (สถานะก่อนหน้า)
--   3) unschedule 'daily-skill-farm' · คืน schedule weekly เป็น '5 8 * * 1' (ถ้าต้องการจริงๆ)
--   4) คอลัมน์ last_daily_farm_date / ตาราง skill_update_runs เป็น additive — ทิ้งไว้ได้ ไม่กระทบโค้ดเก่า
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. dedup ต่อวันของ daily farm (additive, ไม่กระทบโค้ดเดิม) ──────────────
alter table public.employee_skills
  add column if not exists last_daily_farm_date date;

-- ── 2. บันทึกการรันของ job (กันรันซ้ำ + audit) ─────────────────────────────
create table if not exists public.skill_update_runs (
  run_kind     text        not null,   -- 'daily' | 'weekly'
  period_start date        not null,   -- work_date (daily) / วันจันทร์ต้นสัปดาห์ (weekly)
  ran_at       timestamptz not null default now(),
  result       text,
  primary key (run_kind, period_start)
);

alter table public.skill_update_runs enable row level security;

create policy skill_update_runs_select_authenticated
  on public.skill_update_runs
  for select
  to authenticated
  using (true);
-- ไม่มี INSERT/UPDATE/DELETE policy — เขียนได้เฉพาะจากฟังก์ชัน SECURITY DEFINER (bypass RLS)

revoke all on public.skill_update_runs from anon;

-- ── 3. Daily farm ฝั่ง server: +1 EXP/วัน สำหรับคนที่ทำงานจริงที่สถานี min_score ≥ 70 ──
-- กติกา (คงเจตนาเดิมของ daily farming แต่ปิดช่องโหว่):
--   · +1 ต่อ (พนักงาน, สกิล) ต่อ work date — dedup ด้วย last_daily_farm_date
--   · เฉพาะสถานีที่มี station_requirements.min_score >= 70 (เหมือนเดิม)
--   · cap 3 ชั้น: min_score ของสถานี, เพดานขั้น 24/49/74/99 (ห้ามข้ามด่านอนุมัติ
--     level up 25/50/75/100 — เดิม client ข้ามได้), และหยุดเมื่อมี pending_level ค้างอนุมัติ
--   · default work date = เมื่อวานตามเวลาไทย (cron รัน 08:20 ไทย หลังจบกรอบวันงาน 08:00)
create or replace function public.fn_daily_skill_farm(p_work_date date default null)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_date   date;
  v_farmed integer := 0;
  v_result text;
begin
  -- caller guard ฝั่ง server: pg_cron/service (ไม่มี JWT) หรือ admin/manager เท่านั้น
  if auth.uid() is not null and not exists (
       select 1 from profiles p
       where p.id = auth.uid()
         and p.role = any (array['admin','manager']::user_role[])
     ) then
    raise exception 'permission denied: daily skill farm requires admin/manager';
  end if;

  v_date := coalesce(p_work_date, (now() at time zone 'Asia/Bangkok')::date - 1);

  with cand as (
    -- คนที่มาทำงานจริง (is_present) และมีจุดงานที่ต้องการสกิล >= 70
    select dpl.employee_id, sr.skill_name, max(sr.min_score) as min_score
    from daily_production_logs dpl
    join station_requirements sr
      on sr.station_id::text = dpl.assigned_line::text
     and sr.min_score >= 70
    where dpl.work_date = v_date
      and dpl.is_present = true
      and dpl.assigned_line is not null
    group by dpl.employee_id, sr.skill_name
  ),
  calc as (
    select c.employee_id, c.skill_name,
           coalesce(es.score, 0)     as cur_score,
           es.pending_level,
           es.last_daily_farm_date,
           least(
             coalesce(es.score, 0) + 1,
             c.min_score,
             case when coalesce(es.score, 0) < 25 then 24
                  when coalesce(es.score, 0) < 50 then 49
                  when coalesce(es.score, 0) < 75 then 74
                  else 99 end
           ) as new_score
    from cand c
    left join employee_skills es
      on es.employee_id = c.employee_id and es.skill_name = c.skill_name
  ),
  farmed as (
    insert into employee_skills (employee_id, skill_name, score, last_daily_farm_date, updated_at)
    select employee_id, skill_name, new_score, v_date, now()
    from calc
    where pending_level is null                                        -- ค้างอนุมัติ = หยุด farm
      and (last_daily_farm_date is null or last_daily_farm_date < v_date)  -- วันละครั้ง
      and new_score > cur_score
    on conflict (employee_id, skill_name)
    do update set score                = excluded.score,
                  last_daily_farm_date = excluded.last_daily_farm_date,
                  updated_at           = now()
    returning 1
  )
  select count(*) into v_farmed from farmed;

  v_result := format('Daily farm %s: +1 EXP ให้ %s รายการ (พนักงาน×สกิล)', v_date, v_farmed);

  insert into skill_update_runs (run_kind, period_start, result)
  values ('daily', v_date, v_result)
  on conflict (run_kind, period_start)
  do update set ran_at = now(), result = excluded.result;  -- daily รันซ้ำได้ (dedup รายแถวกันไว้แล้ว)

  return v_result;
end;
$function$;

-- ── 4. Weekly update: แก้ให้ idempotent + guard สิทธิ์ + ใช้วันที่ไทย ─────────
-- พฤติกรรมคะแนนเดิมคงไว้ทั้งหมด: ทำงาน >= 3 วัน/สัปดาห์ที่สถานีที่ต้องการสกิล → +2
-- (cap เพดานขั้น) · ชนเพดาน → สร้างคำขอ level up + ตั้ง pending_level ·
-- ไม่ได้ทำงานเลย → decay -2 (floor 25)
create or replace function public.fn_weekly_skill_update(p_week_start date default null)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_week_start  date;
  v_week_end    date;
  v_dow         integer;
  v_bkk_today   date;
  rec           record;
  v_score       integer;
  v_pending     integer;
  v_new_score   integer;
  v_ceiling     integer;
  v_next_level  integer;
  v_worked      boolean;
  v_has_req     boolean;
  v_updated     integer := 0;
  v_requests    integer := 0;
  v_result      text;
begin
  -- caller guard ฝั่ง server: pg_cron/service (ไม่มี JWT) หรือ admin/manager เท่านั้น
  -- (ตรงกับสิทธิ์ปุ่ม UI: skills:run_weekly_update = admin/manager)
  if auth.uid() is not null and not exists (
       select 1 from profiles p
       where p.id = auth.uid()
         and p.role = any (array['admin','manager']::user_role[])
     ) then
    raise exception 'permission denied: weekly skill update requires admin/manager';
  end if;

  if p_week_start is not null then
    v_week_start := p_week_start;
  else
    v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;
    v_dow := extract(dow from v_bkk_today)::integer;
    v_week_start := v_bkk_today - (case when v_dow = 0 then 6 else v_dow - 1 end) - 7;
  end if;
  v_week_end := v_week_start + 6;

  -- idempotent: สัปดาห์เดียวกันประมวลผลได้ครั้งเดียว (เดิมเรียกซ้ำ = +2/-2 ซ้ำ)
  begin
    insert into skill_update_runs (run_kind, period_start) values ('weekly', v_week_start);
  exception when unique_violation then
    return format('Week %s – %s: ประมวลผลไปแล้ว (ข้าม — กันบวกคะแนนซ้ำ)', v_week_start, v_week_end);
  end;

  for rec in
    select e.id as emp_id, sd.name as skill_name
    from employees e
    cross join skill_definitions sd
    where e.is_active = true
  loop
    select score, pending_level
      into v_score, v_pending
      from employee_skills
     where employee_id = rec.emp_id and skill_name = rec.skill_name;

    if not found then
      v_score   := 0;
      v_pending := null;
    end if;

    continue when v_score >= 100;
    continue when v_pending is not null;

    v_ceiling    := case when v_score < 25 then 24
                         when v_score < 50 then 49
                         when v_score < 75 then 74
                         else 99 end;
    v_next_level := v_ceiling + 1;

    select exists (
      select 1
      from daily_production_logs dpl
      join station_requirements sr on sr.station_id::text = dpl.assigned_line::text
      where dpl.employee_id = rec.emp_id
        and dpl.work_date between v_week_start and v_week_end
        and dpl.is_present = true
        and dpl.assigned_line is not null
        and sr.skill_name = rec.skill_name
      group by dpl.assigned_line
      having count(distinct dpl.work_date) >= 3
    ) into v_worked;

    if v_worked then
      v_new_score := least(v_score + 2, v_ceiling);

      if v_new_score = v_ceiling then
        select exists (
          select 1 from skill_level_up_requests
          where employee_id = rec.emp_id and skill_name = rec.skill_name and status = 'pending'
        ) into v_has_req;

        if not v_has_req then
          insert into skill_level_up_requests (employee_id, skill_name, from_score, to_level)
          values (rec.emp_id, rec.skill_name, v_new_score, v_next_level);
          v_requests := v_requests + 1;
        end if;

        insert into employee_skills (employee_id, skill_name, score, pending_level)
        values (rec.emp_id, rec.skill_name, v_new_score, v_next_level)
        on conflict (employee_id, skill_name)
        do update set score = v_new_score, pending_level = v_next_level, updated_at = now();
        v_updated := v_updated + 1;
      elsif v_new_score > v_score then
        insert into employee_skills (employee_id, skill_name, score)
        values (rec.emp_id, rec.skill_name, v_new_score)
        on conflict (employee_id, skill_name)
        do update set score = v_new_score, updated_at = now();
        v_updated := v_updated + 1;
      end if;

    else
      if v_score > 25 then
        v_new_score := greatest(25, v_score - 2);
        insert into employee_skills (employee_id, skill_name, score)
        values (rec.emp_id, rec.skill_name, v_new_score)
        on conflict (employee_id, skill_name)
        do update set score = v_new_score, updated_at = now();
        v_updated := v_updated + 1;   -- เดิมนับเบิ้ล (นับใน else แล้วนับท้าย loop อีก)
      end if;
    end if;
  end loop;

  v_result := format('Week %s – %s: updated %s, requests %s',
                     v_week_start, v_week_end, v_updated, v_requests);

  update skill_update_runs
     set result = v_result
   where run_kind = 'weekly' and period_start = v_week_start;

  return v_result;
end;
$function$;

-- ── 5. สิทธิ์เรียก RPC: ปิด anon/PUBLIC (เดิมใครมี anon key ยิงได้โดยไม่ login) ──
revoke all on function public.fn_daily_skill_farm(date)     from public, anon;
revoke all on function public.fn_weekly_skill_update(date)  from public, anon;
grant execute on function public.fn_daily_skill_farm(date)    to authenticated, service_role;
grant execute on function public.fn_weekly_skill_update(date) to authenticated, service_role;
-- (authenticated ยังเรียกได้เพื่อให้ปุ่ม "Run Weekly Update" ใน /operator ใช้งานได้
--  แต่ตัวฟังก์ชันเช็ค role จาก profiles ฝั่ง server เอง — JS gate อย่างเดียวไม่พอ)

-- ── 6. RLS employee_skills: จาก auth_all → อ่านได้ทุกคนที่ login, เขียนเฉพาะ role ที่มีสิทธิ์จริง ──
-- write paths ในแอป (ตรวจครบ 2026-07-13): operator.jsx แก้สกิล/อนุมัติ-ปฏิเสธ level up
-- (สิทธิ์ผ่าน can(): admin/manager/supervisor + leader มี employees:edit) — read อย่างเดียว:
-- Dashboard, Management, Report, Checkin
drop policy if exists auth_all on public.employee_skills;

create policy employee_skills_select_authenticated
  on public.employee_skills
  for select
  to authenticated
  using (true);

create policy employee_skills_write_privileged
  on public.employee_skills
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

revoke all on public.employee_skills from anon;

-- ── 7. cron: weekly ให้ตรง 08:05 ไทย (pg_cron ใช้ UTC) + เพิ่ม daily 08:20 ไทย ──
do $$
declare
  v_jobid integer;
begin
  select jobid into v_jobid from cron.job where jobname = 'weekly-skill-update';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  select jobid into v_jobid from cron.job where jobname = 'daily-skill-farm';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

-- จันทร์ 01:05 UTC = 08:05 ไทย (เดิม '5 8 * * 1' = 15:05 ไทย — ผิดตามที่ UI บอกไว้)
select cron.schedule('weekly-skill-update', '5 1 * * 1', 'select public.fn_weekly_skill_update();');
-- ทุกวัน 01:20 UTC = 08:20 ไทย — farm ของ work date ที่เพิ่งจบ (เหลื่อมจาก weekly กันเขียนชนกันเช้าวันจันทร์)
select cron.schedule('daily-skill-farm', '20 1 * * *', 'select public.fn_daily_skill_farm();');
