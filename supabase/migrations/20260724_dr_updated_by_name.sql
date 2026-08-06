-- เฟส DR actor — ให้ audit ฝั่ง DR รู้ "ใครแก้" (2026-07-24)
-- DR เป็น anon (ไม่มี auth.uid) → app ต้อง stamp ชื่อผู้แก้ลง updated_by_name เอง
-- (ทำ centralized ที่ supabaseClient.js — wrap supabaseDR.from ให้ฝัง updated_by_name อัตโนมัติ)
-- fn_audit อ่าน updated_by_name เป็น actor อยู่แล้ว (migration 20260724_audit_log_dr.sql)

do $$
declare t text;
  tbls text[] := array[
    'dr_products','kanban_standards','checklists','jig_checkpoints','jigs','pm_plans','machines',
    'dr_defect_types','dr_downtime_types','machine_types','process_types','container_types',
    'mtn_technicians','mtn_spare_parts','mtn_problem_types','mtn_repair_types','mtn_labor_rates','mtn_item_types',
    'pm_daily_line_targets','pm_facility_areas','pm_checking_methods','pm_checkpoint_categories',
    'ship_to_plants','shipping_workflow_steps','dt_alert_config','stock_inflow_rules','lot_post_configs',
    'kanban_calc_settings','kanban_targets','product_packaging','scrap_defect_types'
  ];
begin
  foreach t in array tbls loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists updated_by_name text', t);
  end loop;
end $$;

-- ปรับ fn_audit: ไม่นับ updated_at/updated_by_name เป็น "การเปลี่ยนแปลง" (กัน log ที่มีแต่ตัว stamp เอง)
create or replace function public.fn_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_changed text[];
begin
  begin
    v_actor := nullif(current_setting('app.actor', true), '');
    if v_actor is null then
      v_actor := coalesce(to_jsonb(NEW)->>'updated_by_name', to_jsonb(NEW)->>'last_edited_by');
    end if;
    if TG_OP = 'UPDATE' then
      select array_agg(key) into v_changed
      from jsonb_each(to_jsonb(NEW))
      where to_jsonb(NEW)->key is distinct from to_jsonb(OLD)->key
        and key not in ('updated_at','updated_by_name');
      if v_changed is null then return NEW; end if;
      insert into public.audit_log(table_name,row_pk,action,actor,changed_fields,old_data,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'UPDATE', v_actor, v_changed, to_jsonb(OLD), to_jsonb(NEW));
    elsif TG_OP = 'DELETE' then
      insert into public.audit_log(table_name,row_pk,action,actor,old_data)
      values (TG_TABLE_NAME, to_jsonb(OLD)->>'id', 'DELETE', v_actor, to_jsonb(OLD));
    else
      insert into public.audit_log(table_name,row_pk,action,actor,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'INSERT', v_actor, to_jsonb(NEW));
    end if;
  exception when others then null; end;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;
