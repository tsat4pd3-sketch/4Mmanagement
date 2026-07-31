-- ═══ Traceability / Audit Log — Main project (2026-07-24) ═══════════════════════════════════
-- ปัญหา: ตาราง master/config ส่วนใหญ่ track แค่ created_at — แก้ไขแล้วสืบไม่ได้ว่าใคร/เมื่อไหร่/ค่าเก่าอะไร
-- แก้: (1) ตาราง audit_log กลาง เก็บ old→new + actor + เวลา (2) generic trigger fn_audit
--      (3) updated_at + trigger ให้ตาราง master (4) ผูก trigger เฉพาะตาราง master/สำคัญ
-- ⚠️ กฎเหล็ก: การ log ต้องไม่ทำ operation หลักพังเด็ดขาด → fn_audit ห่อ insert ด้วย EXCEPTION (best-effort)
-- ⚠️ ไม่ผูกกับตาราง log ปริมาณสูง (daily_production_logs/notifications/telegram_*) — bloat + ไม่จำเป็น

create table if not exists public.audit_log (
  id             bigint generated always as identity primary key,
  table_name     text not null,
  row_pk         text,                          -- ค่า id ของแถว (ถ้ามีคอลัมน์ id)
  action         text not null,                 -- INSERT | UPDATE | DELETE
  actor          text,                          -- ชื่อ/อีเมลผู้ทำ (จาก profiles ตาม auth.uid หรือ app.actor)
  actor_uid      uuid,
  changed_fields text[],                        -- คอลัมน์ที่เปลี่ยน (เฉพาะ UPDATE)
  old_data       jsonb,
  new_data       jsonb,
  changed_at     timestamptz not null default now()
);
create index if not exists idx_audit_log_table_row  on public.audit_log(table_name, row_pk, changed_at desc);
create index if not exists idx_audit_log_changed_at on public.audit_log(changed_at desc);
create index if not exists idx_audit_log_actor      on public.audit_log(actor_uid, changed_at desc);

alter table public.audit_log enable row level security;
-- อ่านได้เฉพาะผู้ล็อกอิน (กรอง admin/สิทธิ์ในแอปอีกชั้น) · เขียนผ่าน trigger (SECURITY DEFINER) เท่านั้น
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated using (true);

-- ── generic audit trigger ────────────────────────────────────────────────────────────────────
create or replace function public.fn_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor text; v_uid uuid; v_pk text; v_changed text[];
begin
  begin
    v_uid := auth.uid();
    if v_uid is not null then
      select coalesce(full_name, email) into v_actor from public.profiles where id = v_uid;
    end if;
    if v_actor is null then v_actor := nullif(current_setting('app.actor', true), ''); end if;

    if TG_OP = 'UPDATE' then
      select array_agg(key) into v_changed
      from jsonb_each(to_jsonb(NEW))
      where to_jsonb(NEW)->key is distinct from to_jsonb(OLD)->key
        and key <> 'updated_at';
      if v_changed is null then return NEW; end if;   -- ไม่มีการเปลี่ยนจริง (นอกจาก updated_at)
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,changed_fields,old_data,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'UPDATE', v_actor, v_uid, v_changed, to_jsonb(OLD), to_jsonb(NEW));
    elsif TG_OP = 'DELETE' then
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,old_data)
      values (TG_TABLE_NAME, to_jsonb(OLD)->>'id', 'DELETE', v_actor, v_uid, to_jsonb(OLD));
    else
      insert into public.audit_log(table_name,row_pk,action,actor,actor_uid,new_data)
      values (TG_TABLE_NAME, to_jsonb(NEW)->>'id', 'INSERT', v_actor, v_uid, to_jsonb(NEW));
    end if;
  exception when others then
    null;  -- ⚠️ audit ล้มเหลวห้ามทำ write หลักพัง
  end;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

create or replace function public.fn_set_updated_at() returns trigger
language plpgsql as $$ begin NEW.updated_at := now(); return NEW; end $$;

-- ── ผูก trigger กับตาราง master/config ที่ต้องสืบประวัติการแก้ไข ─────────────────────────────
do $$
declare t text;
  tbls text[] := array[
    'production_lines','profiles','employees','org_nodes','permission_catalog','role_permissions',
    'workstations','station_requirements','oee_targets','doc_forms','skill_definitions','skill_sub_items',
    'ppe_requirements','ppe_items','qa_parts','qa_characteristics','qa_instruments','notification_rules',
    'kpi_targets','kpi_items','bus_routes','ot_task_types','lpa_questions','telegram_channels',
    'company_calendar','section_signers','part_registry'
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
