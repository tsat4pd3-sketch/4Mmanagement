-- 🔧 weekly skill: หยุด decay สกิลที่ "ไม่ผูกจุดงานเลย" (QC audit 2026-08-20 · T1-8)
--
-- ปัญหา: fn_weekly_skill_update วน employees × skill_definitions ทุกคู่ แล้วตัดสิน
--        "ทำงานสกิลนี้ไหม" จาก station_requirements เท่านั้น → สกิลที่ไม่ผูกจุดงานใดเลย
--        v_worked = false ตลอดกาล → ทุกคนที่คะแนน 26-99 โดน −2 ทุกสัปดาห์
--        ลงถึงพื้น 25 ภายใน ~37 สัปดาห์ · คะแนนที่หัวหน้าตั้งเองหายไปเงียบๆ
--
-- ⚠️ ขัดกฎเหล็กของโปรเจค: เอา "ไม่รู้" ไปตัดสินว่า "ไม่ได้ใช้"
--
-- ข้อมูลจริง ณ วันแก้: สกิลทั้งหมด 44 · ไม่มี station_requirements เลย 8 สกิล
--                      แถวคะแนน 26-99 ของสกิลกลุ่มนั้น = 46 แถว กำลังถูกลดทุกสัปดาห์
--
-- ⚠️ ไม่แตะเงื่อนไข "ประจำสถานีเดิม ≥3 วัน" (group by dpl.assigned_line)
--    user ยืนยัน 2026-08-20 ว่าเป็นเจตนาที่ถูกต้อง — สกิลเฉพาะต้องอยู่สถานีเดิม
-- ⚠️ ตัวฟังก์ชันคัดลอกจาก 20260713_skill_farming_server_side.sql ทั้งดุ้น
--    แก้เฉพาะบล็อก `and exists (...)` ที่เพิ่มเข้ามา — ที่เหลือเหมือนเดิมทุกตัวอักษร
--    (เคยลองเขียนใหม่จากความจำแล้วผิด ~10 จุด: ชื่อคอลัมน์ skill_update_runs, join ของ
--     station_requirements, การเขียน result กลับ — ห้ามเขียนใหม่ ให้ patch จากต้นฉบับเสมอ)
--
-- rollback: rerun ส่วน fn_weekly_skill_update ใน 20260713_skill_farming_server_side.sql

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
      -- ⭐ ข้ามสกิลที่ "ไม่มีจุดงานไหนต้องการเลย" — ระบบไม่มีทางรู้ว่าเขาใช้สกิลนั้นหรือไม่
      --    เดิม v_worked = false ตลอดกาล → คะแนน 26-99 โดน −2 ทุกสัปดาห์จนถึงพื้น 25
      --    = เอา "ไม่รู้" ไปตัดสินว่า "ไม่ได้ใช้" (QC audit 2026-08-20 · T1-8)
      and exists (select 1 from station_requirements sr2 where sr2.skill_name = sd.name)
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
