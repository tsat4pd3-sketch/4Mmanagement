-- ══════════════════════════════════════════════════════════════════════════
-- รอบ PM/AM ที่นับจาก "วันที่เครื่องเดินจริง"  (cycle_basis = run_day)   2026-10-02
-- Project: DR / "Product DB" (eyhclzkifitbhbljgoav)   ← ห้ามรันบน MAIN
--
-- คำสั่ง user: *"AM link กับการใช้งานของเครื่องจักรที่ผลิต ถ้าไม่ผลิตไม่มี order
-- ไปผูกเครื่องนั้นก็ไม่จำเป็นต้องตรวจ — ตอนนี้ถ้าเลือกตรวจรายวันมันจะนับว่าต้องตรวจ
-- ทุกวันแม้ไม่ได้ผลิต"*
--
-- วัดก่อนแก้ (60 วันล่าสุด · แผน AM รายวัน 7 ตัว · ทุกแผนในระบบเป็น plan_type='time' 147/147):
--   RB-128/RB-55/RB-56/RB-57/AUTOLOAD-03 (HDF1)  ไลน์เดินจริง 38/60 วัน → ค้างปลอม 37%
--   RB-04 (TSRA-1)                               ไลน์เดินจริง  4/60 วัน → ค้างปลอม 93%
--   PF-H101 (HYDROFORM)                          ทะเบียนอยู่ไลน์แม่ ใบผลิตอยู่ไลน์ลูก
--
-- ── สิ่งที่ migration นี้ทำ ────────────────────────────────────────────────
--   1. `pm_plans.cycle_basis`   = ฐานการนับรอบ: calendar (เดิม) / run_day / usage
--   2. `pm_plans.max_idle_days` = จอดเกินกี่วันแล้วต้องตรวจก่อนเริ่มเดินใหม่ (null = ไม่บังคับ)
--   3. `pm_refresh_plan` — แผน run_day **ไม่เขียน next_due_date แบบปฏิทิน** (เขียน null +
--      reason='run_day') เพราะวันครบกำหนดของมันเป็น *เงื่อนไข* ไม่ใช่วันที่
--   4. seed แผน AM รายวันของฝ่ายผลิต 7 ตัว → run_day + max_idle_days 30
--
-- ⚠️ backward-compatible: คอลัมน์ใหม่มี default · แผนเดิมทุกตัวเป็น 'calendar' = พฤติกรรมเดิมเป๊ะ
-- ⚠️ การตัดสิน "วันนี้ต้องตรวจไหม" ของแผน run_day อยู่ฝั่ง client ที่ `src/utils/pmRunDay.js`
--    **ไม่ได้อยู่ใน SQL** เพราะต้องกางครอบครัวไลน์จาก `production_lines` ซึ่งอยู่ MAIN คนละฐาน
--    (เหตุผลเดียวกับที่ RPC `pm_usage_daily` คืนยอดรายไลน์แล้วให้ client รวมครอบครัวเอง)
-- ⚠️ ผลข้างเคียงที่ตั้งใจ: แผน run_day จะไม่มี next_due_date ⇒ **cron เตือนล่วงหน้า
--    (pm_plan_reminders) จะไม่ยิงให้แผนกลุ่มนี้** — ของพวกนี้เตือนที่หน้างานผ่านจอ AM รายวัน
--    ซึ่งรู้เรื่องการเปิดใบผลิตอยู่แล้ว (`pm_daily_line_targets` + `computeDailyPmStatus`)
-- ══════════════════════════════════════════════════════════════════════════

alter table public.pm_plans
  add column if not exists cycle_basis   text not null default 'calendar',
  add column if not exists max_idle_days integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pm_plans_cycle_basis_check') then
    alter table public.pm_plans
      add constraint pm_plans_cycle_basis_check
      check (cycle_basis in ('calendar','run_day','usage'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pm_plans_max_idle_days_check') then
    alter table public.pm_plans
      add constraint pm_plans_max_idle_days_check
      check (max_idle_days is null or (max_idle_days between 1 and 3650));
  end if;
end $$;

comment on column public.pm_plans.cycle_basis is
  'ฐานการนับรอบ PM: calendar = วันปฏิทิน (เดิม) · run_day = เฉพาะวันที่ไลน์นั้นเปิดใบผลิตจริง · usage = ยอดผลิตสะสม. run_day ตัดสินฝั่ง client ที่ src/utils/pmRunDay.js (ต้องกางครอบครัวไลน์จาก MAIN)';
comment on column public.pm_plans.max_idle_days is
  'จอดเกินกี่วันปฏิทินแล้วบังคับตรวจรอบแรกที่กลับมาเดิน (null = ไม่บังคับ). ใช้กับ cycle_basis=run_day — เครื่องจอดนานต้องตรวจมากกว่าปกติ ไม่ใช่น้อยกว่า';

-- ── 3) pm_refresh_plan: แผน run_day ห้ามเขียนวันครบกำหนดแบบปฏิทิน ─────────────
-- ของเดิมทั้งหมดคงไว้เป๊ะ (time / usage / hybrid) เพิ่มเฉพาะทางแยกของ run_day ที่ต้นฟังก์ชัน
create or replace function public.pm_refresh_plan(p_checklist_id uuid)
returns void language plpgsql security definer as $$
declare
  v_type       text;
  v_basis      text;
  v_interval   int;
  v_threshold  numeric;
  v_line       text;
  v_last       timestamptz;
  v_last_id    uuid;
  v_last_date  date;
  v_time_due   date;
  v_usage_due  date;
  v_produced   numeric;
  v_days_since numeric;
  v_rate       numeric;
  v_health     numeric;
  v_next       date;
  v_reason     text;
begin
  select plan_type, cycle_basis, interval_days, usage_threshold, usage_source_line
    into v_type, v_basis, v_interval, v_threshold, v_line
    from public.pm_plans where checklist_id = p_checklist_id;
  if not found then return; end if;

  select inspected_at, id into v_last, v_last_id
    from public.inspections
    where checklist_id = p_checklist_id
      and approval_status is distinct from 'rejected'
    order by inspected_at desc
    limit 1;
  v_last_date := case when v_last is not null then (v_last at time zone 'Asia/Bangkok')::date end;

  -- 🔴 run_day: "ครบกำหนด" เป็นเงื่อนไข (เดินครบ N วัน) ไม่ใช่วันที่ ⇒ เขียน null ไว้
  --    เขียนวันปฏิทินไว้ = จอที่ยังไม่รู้จัก basis จะอ่านว่าค้าง ทั้งที่เครื่องไม่ได้เดิน
  if v_basis = 'run_day' then
    update public.pm_plans
       set last_done_at       = v_last,
           last_inspection_id = v_last_id,
           next_due_date      = null,
           next_due_reason    = 'run_day',
           health_score       = null
     where checklist_id = p_checklist_id;
    return;
  end if;

  -- Time component (Preventive)
  if v_interval is not null and v_last_date is not null then
    v_time_due := v_last_date + v_interval;
  end if;

  -- Usage component (Predictive) — only for usage/hybrid plans with a threshold + line
  if v_type in ('usage','hybrid') and v_threshold is not null and v_threshold > 0 and v_line is not null then
    select coalesce(sum(po.qty), 0) into v_produced
      from public.prod_orders po
      join public.production_sessions ps on ps.id = po.session_id
      where ps.line_name = v_line
        and po.confirmed_at is not null
        and (v_last is null or po.confirmed_at > v_last);

    v_health := greatest(0, least(100, round(100 * (1 - v_produced / v_threshold))));

    if v_last_date is not null and v_produced > 0 then
      v_days_since := greatest(1, ((now() at time zone 'Asia/Bangkok')::date - v_last_date));
      v_rate := v_produced / v_days_since;
      v_usage_due := v_last_date + ceil(v_threshold / v_rate)::int;
    end if;
  end if;

  if v_type = 'usage' then
    v_next := v_usage_due; v_reason := 'usage';
  elsif v_type = 'hybrid' then
    if v_time_due is not null and v_usage_due is not null then
      if v_usage_due <= v_time_due then v_next := v_usage_due; v_reason := 'usage';
      else v_next := v_time_due; v_reason := 'time'; end if;
    else
      v_next   := coalesce(v_usage_due, v_time_due);
      v_reason := case when v_usage_due is not null then 'usage' else 'time' end;
    end if;
  else
    v_next := v_time_due; v_reason := 'time';
  end if;

  -- ⚠️ ท่อนนี้คัดมาจากฟังก์ชันตัวจริงใน DB แบบคำต่อคำ (pg_get_functiondef 02/10)
  --    `last_inspection_id` ไม่ใช่ `last_inspection` · `health_score = v_health` ไม่ใช่ coalesce
  --    · ไม่แตะ `updated_at` — ห้ามแก้ให้ "ดูดีขึ้น" ตรงนี้ มันคือพฤติกรรมเดิมที่ต้องคงไว้
  update public.pm_plans set
    last_done_at = v_last, last_inspection_id = v_last_id,
    next_due_date = coalesce(v_next, next_due_date),
    next_due_reason = coalesce(v_reason, next_due_reason),
    health_score = v_health
  where checklist_id = p_checklist_id;
end $$;

-- ── 4) seed: แผน AM รายวันของฝ่ายผลิต = run_day + เพดานจอด 30 วัน ──────────────
-- ตรงกับปัญหาที่ user แจ้งพอดี (7 แผน) · แผนอื่นทั้งหมดไม่ถูกแตะ
update public.pm_plans p
   set cycle_basis   = 'run_day',
       max_idle_days = coalesce(p.max_idle_days, 30),
       updated_at    = now()
  from public.checklists c
 where c.id = p.checklist_id
   and c.department = 'production'
   and p.interval_days = 1
   and p.cycle_basis = 'calendar';

-- ล้างวันครบกำหนดแบบปฏิทินที่ค้างจากกติกาเดิมของแผนที่เพิ่งเปลี่ยนเป็น run_day
update public.pm_plans
   set next_due_date = null, next_due_reason = 'run_day', updated_at = now()
 where cycle_basis = 'run_day' and next_due_date is not null;

-- ══ ตรวจผลหลังรัน (ควรได้ 7 แถว · next_due_date null ทั้งหมด) ══
--   select c.department, p.cycle_basis, p.interval_days, p.max_idle_days, p.next_due_date, p.next_due_reason
--     from public.pm_plans p join public.checklists c on c.id = p.checklist_id
--    where p.cycle_basis = 'run_day';
--   select cycle_basis, count(*) from public.pm_plans group by 1;   -- calendar 140 / run_day 7
--
-- ══ Rollback (ย้อนโค้ดก่อน แล้วค่อยรันนี่) ══
--   update public.pm_plans set cycle_basis = 'calendar', max_idle_days = null
--    where cycle_basis = 'run_day';
--   -- แล้วสั่ง pm_refresh_plan ใหม่ให้แผนกลุ่มนั้น เพื่อคืน next_due_date แบบปฏิทิน:
--   --   select public.pm_refresh_plan(checklist_id) from public.pm_plans where interval_days = 1;
--   alter table public.pm_plans drop column if exists cycle_basis, drop column if exists max_idle_days;
--   -- (ฟังก์ชัน pm_refresh_plan เวอร์ชันเดิมอยู่ใน 20260709_pm_plans_usage_phase2.sql)
