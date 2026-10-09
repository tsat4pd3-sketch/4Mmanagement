-- ═══════════════════════════════════════════════════════════════════════════════
-- 🔗 เชื่อมทะเบียน AM รายวัน (pm_daily_line_targets) ↔ แผน AM (pm_plans)   2026-10-08
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav)
-- ที่มา: audit AM↔PM (docs/modules/am-pm-linkage-audit.md) — 2 ระบบไม่มีอะไร sync กัน:
--   · จิ๊ก 31 ตัวอยู่ในทะเบียนรายวัน ("ตรวจทุกกะ") แต่แผน AM ของมัน 24 ใบมี interval_days = null
--     และเป็น calendar ⇒ ทุกจอ PM เห็นเป็น "ไม่ตั้งรอบ"/ปกติ · migration 02/10 แปลงเป็น run_day แค่ 7 ใบ
--     (เฉพาะ interval_days = 1)
--   · checklist AM ที่สร้างใหม่หลัง 02/10 ได้ cycle_basis='calendar' เสมอ (trigger pm_checklist_sync)
--   · ติ๊ก/เอาออกจากทะเบียน ไม่แตะแผน · ย้ายทีม AM↔PM cycle_basis เดิมติดไป
--
-- กติกาที่ตั้งที่ชั้น DB (ทุก client path ได้ผลเดียวกัน ไม่ต้องพึ่งจอ):
--   R1 จิ๊กที่มี target active ในทะเบียนรายวัน ⇒ แผน AM ของจิ๊กนั้น = run_day · interval 1 · max_idle 30 · active
--   R2 checklist ของทีม AM (mtn_teams.kind='am') ที่รอบ ≤ 1 วัน ⇒ run_day ตั้งแต่สร้าง
--   R3 ย้าย checklist ไปทีม PM (kind<>'am') ⇒ กลับเป็น calendar (run_day เป็นของ AM เท่านั้น)
-- ย้อนกลับ: drop trigger trg_pm_daily_target_plan_sync + คืน pm_checklist_sync เวอร์ชัน 20260708
--   (ค่าที่ backfill ไว้ไม่ต้องย้อน — run_day สำหรับจิ๊กในทะเบียนรายวันคือความจริงของหน้างานอยู่แล้ว)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) ฟังก์ชันกลาง: ให้แผน AM ของจิ๊กตามทะเบียนรายวัน ──────────────────────────
create or replace function public.pm_am_plan_follow_registry(p_jig_id uuid)
returns void language plpgsql security definer as $$
declare
  v_registered boolean;
begin
  select exists (select 1 from public.pm_daily_line_targets t where t.jig_id = p_jig_id and t.is_active)
    into v_registered;
  if not v_registered then return; end if;   -- เอาออกจากทะเบียน = ไม่แตะแผน (คนตัดสินเองที่ PM Setup/แผน PM)

  update public.pm_plans p
     set cycle_basis   = 'run_day',
         interval_days = 1,
         max_idle_days = coalesce(p.max_idle_days, 30),
         is_active     = true,
         next_due_date = null,
         next_due_reason = 'run_day'
    from public.checklists c
   where c.id = p.checklist_id
     and c.module = 'mtn'
     and c.equipment_id = p_jig_id
     and c.department in (select key from public.mtn_teams where kind = 'am')
     and (p.cycle_basis is distinct from 'run_day' or p.interval_days is distinct from 1
          or p.is_active is distinct from true or p.next_due_date is not null);
end;
$$;

-- ── 2) trigger บนทะเบียน: ติ๊ก (insert / กลับมา active) ⇒ แผนตาม ─────────────
create or replace function public.pm_daily_target_plan_sync()
returns trigger language plpgsql security definer as $$
begin
  begin
    if (tg_op = 'INSERT' and NEW.is_active)
       or (tg_op = 'UPDATE' and NEW.is_active and (OLD.is_active is distinct from NEW.is_active or OLD.jig_id is distinct from NEW.jig_id)) then
      perform public.pm_am_plan_follow_registry(NEW.jig_id);
    end if;
  exception when others then null;   -- ทะเบียนต้องเขียนได้เสมอ แผนตามเป็น best-effort (จอ AM เขียนบอกเมื่อไม่ตรง)
  end;
  return null;
end;
$$;
drop trigger if exists trg_pm_daily_target_plan_sync on public.pm_daily_line_targets;
create trigger trg_pm_daily_target_plan_sync
  after insert or update on public.pm_daily_line_targets
  for each row execute function public.pm_daily_target_plan_sync();

-- ── 3) pm_checklist_sync: ทีม AM + รอบ ≤ 1 วัน ⇒ run_day · ย้ายออกจากทีม AM ⇒ calendar ─
create or replace function public.pm_checklist_sync()
returns trigger language plpgsql security definer as $$
declare
  v_am boolean;
begin
  begin
    select exists (select 1 from public.mtn_teams where key = NEW.department and kind = 'am') into v_am;
    if (tg_op = 'INSERT') then
      insert into public.pm_plans (checklist_id, plan_type, interval_days, next_due_reason)
        values (NEW.id, 'time', public.pm_freq_to_days(NEW.frequency), 'time')
        on conflict (checklist_id) do nothing;
      if v_am and coalesce(public.pm_freq_to_days(NEW.frequency), 0) <= 1 then
        update public.pm_plans set cycle_basis = 'run_day', interval_days = 1,
               max_idle_days = coalesce(max_idle_days, 30), next_due_reason = 'run_day'
         where checklist_id = NEW.id;
      end if;
      -- จิ๊กอยู่ในทะเบียนรายวันอยู่แล้ว (ลงทะเบียนก่อนมีใบตรวจ) ⇒ ให้แผนตามทะเบียนทันที
      if v_am and NEW.equipment_id is not null then perform public.pm_am_plan_follow_registry(NEW.equipment_id); end if;
      perform public.pm_refresh_plan(NEW.id);
    elsif (tg_op = 'UPDATE') then
      if NEW.frequency is distinct from OLD.frequency then
        update public.pm_plans
          set interval_days = public.pm_freq_to_days(NEW.frequency)
          where checklist_id = NEW.id and plan_type = 'time';
      end if;
      if NEW.department is distinct from OLD.department then
        if v_am then
          -- เข้าทีม AM: รอบ ≤1 วัน หรือจิ๊กอยู่ในทะเบียนรายวัน ⇒ run_day
          update public.pm_plans set cycle_basis = 'run_day', interval_days = 1,
                 max_idle_days = coalesce(max_idle_days, 30), next_due_date = null, next_due_reason = 'run_day'
           where checklist_id = NEW.id and coalesce(interval_days, 0) <= 1;
          if NEW.equipment_id is not null then perform public.pm_am_plan_follow_registry(NEW.equipment_id); end if;
        else
          -- ออกจากทีม AM: run_day เป็นของ AM เท่านั้น ⇒ กลับเป็น calendar (วันครบกำหนดให้ pm_refresh_plan คิดใหม่)
          update public.pm_plans set cycle_basis = 'calendar', next_due_reason = 'time'
           where checklist_id = NEW.id and cycle_basis = 'run_day';
        end if;
      end if;
      if NEW.frequency is distinct from OLD.frequency or NEW.department is distinct from OLD.department then
        perform public.pm_refresh_plan(NEW.id);
      end if;
    end if;
  exception when others then null;  -- plan upkeep must never break a checklist write
  end;
  return null;
end;
$$;
-- trigger เดิม (trg_pm_checklist_sync · after insert or update) ชี้ฟังก์ชันชื่อเดิม ไม่ต้องสร้างใหม่

-- ── 4) backfill: แผน AM ของจิ๊กที่อยู่ในทะเบียนรายวัน ⇒ run_day (R1) ─────────────
do $$
declare r record;
begin
  for r in select distinct t.jig_id from public.pm_daily_line_targets t where t.is_active loop
    perform public.pm_am_plan_follow_registry(r.jig_id);
  end loop;
end $$;
-- refresh last_done/health ให้แผนที่เพิ่งเปลี่ยนฐาน
do $$
declare r record;
begin
  for r in select p.checklist_id from public.pm_plans p where p.cycle_basis = 'run_day' loop
    perform public.pm_refresh_plan(r.checklist_id);
  end loop;
end $$;

-- ── เช็คผล ──
-- select c.department, p.cycle_basis, p.interval_days, count(*) from pm_plans p join checklists c on c.id=p.checklist_id
--  where c.module='mtn' and p.is_active group by 1,2,3 order by 1,2,3;
-- คาดหวัง: production/run_day/1 ≈ 31 (จิ๊กในทะเบียน 31 ตัว) · calendar เหลือเฉพาะจิ๊ก AM ที่ไม่อยู่ในทะเบียน (2)
