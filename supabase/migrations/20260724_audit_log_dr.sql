-- ═══ Traceability / Audit Log — DR project (2026-07-24) ═════════════════════════════════════
-- โครงเดียวกับฝั่ง Main แต่ DR client เป็น anon เสมอ (ไม่มี JWT) → auth.uid() = null
-- "ใครแก้" ดึงจาก auth ไม่ได้ → actor มาจาก (ก) current_setting('app.actor') ที่ app เซ็ต หรือ
--   (ข) คอลัมน์ updated_by_name/last_edited_by บนแถว (ถ้า app stamp มา) — best-effort
-- old→new + เวลา เก็บได้เสมอ (ตอบ "line_name เปลี่ยน X→Y เมื่อไหร่" ได้แม้ยังไม่รู้ actor)

create table if not exists public.audit_log (
  id             bigint generated always as identity primary key,
  table_name     text not null,
  row_pk         text,
  action         text not null,
  actor          text,
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb,
  changed_at     timestamptz not null default now()
);
create index if not exists idx_audit_log_table_row  on public.audit_log(table_name, row_pk, changed_at desc);
create index if not exists idx_audit_log_changed_at on public.audit_log(changed_at desc);

-- DR อ่านผ่าน anon (client ไม่มี JWT) — เปิดอ่านให้ anon เหมือนตารางอื่นฝั่ง DR (กรองสิทธิ์ในแอป)
alter table public.audit_log enable row level security;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to anon, authenticated using (true);

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
        and key <> 'updated_at';
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

create or replace function public.fn_set_updated_at() returns trigger
language plpgsql as $$ begin NEW.updated_at := now(); return NEW; end $$;

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
    execute format('alter table public.%I add column if not exists updated_at timestamptz default now()', t);
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
  end loop;
end $$;
