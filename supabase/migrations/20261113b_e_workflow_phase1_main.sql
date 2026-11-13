-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🧩 e-Workflow เฟส 1 — ใบงานที่ user สร้างเอง (Main · ewhdfqwfwofivojtsizn · จอ Supabase "MAIN")
-- 2026-11-13 · ออกแบบ docs/E-WORKFLOW-DESIGN.md · โมดูล docs/modules/e-workflow.md
--
-- เฟส 1 ทำ: นิยาม+เวอร์ชัน (แช่แข็งตอนเผยแพร่) · key user ส่งขอเผยแพร่ → admin อนุมัติ ·
--           ขั้นเส้นตรง approve/ack · หาผู้อนุมัติ 4 แบบ · อนุมัติ/ตีกลับ/ส่งกลับแก้/ยกเลิก
-- 🔴 client เขียนตาราง wf_* ตรงไม่ได้เลย (ไม่มี policy INSERT/UPDATE/DELETE) — ผ่าน RPC เท่านั้น
-- 🔴 ไม่แตะตารางเดิมใดๆ (ใบ 4M จริงยังเดินแบบเดิม)
--
-- ROLLBACK (ย้อนได้ทั้งก้อน · ไม่มีตารางเดิมผูก):
--   drop function if exists public.wf_save_draft(jsonb), public.wf_request_publish(uuid),
--     public.wf_review_publish(uuid, boolean, text), public.wf_set_def_status(uuid, text),
--     public.wf_start(text, text, jsonb), public.wf_act(uuid, text, text, integer),
--     public.wf_resubmit(uuid, jsonb, integer), public.wf_cancel(uuid, text),
--     public.wf_resolve(uuid, jsonb), public.wf_open_step(uuid), public.wf_profile_has_perm(uuid, text),
--     public.wf_can_see(uuid), public.wf_check_data(jsonb, jsonb), public.wf_can_own(text);
--   drop table if exists public.wf_actions, public.wf_tasks, public.wf_instances, public.wf_versions, public.wf_defs cascade;
--   delete from public.role_permissions where permission_key like 'wf:%' or permission_key in ('page:/workflows','page:/workflow-designer');
--   delete from public.permission_catalog where resource = 'wf' or (resource = 'page' and action in ('/workflows','/workflow-designer'));
--   delete from public.notification_rules where event_key like 'wf.%';
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ─── 1) ตาราง ────────────────────────────────────────────────────────────────────────
create table if not exists public.wf_defs (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null unique check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name               text not null,
  description        text,
  owner_section      text not null,          -- หน่วยเจ้าของนิยาม (= profiles.section · ใช้ตัดสินว่าใครแก้นิยามได้)
  number_prefix      text,                   -- คำนำหน้าเลขที่ใบ (ว่าง = KEY ตัวใหญ่)
  status             text not null default 'draft' check (status in ('draft','active','retired')),
  current_version_id uuid,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.wf_versions (
  id            uuid primary key default gen_random_uuid(),
  def_id        uuid not null references public.wf_defs(id) on delete cascade,
  version_no    integer not null,
  form_schema   jsonb not null default '{"fields":[]}'::jsonb,
  flow_schema   jsonb not null default '{"steps":[]}'::jsonb,
  start_roles   text[] not null default '{}',
  status        text not null default 'draft' check (status in ('draft','pending_publish','published')),
  review_note   text,
  submitted_by  uuid references public.profiles(id) on delete set null,
  submitted_at  timestamptz,
  published_by  uuid references public.profiles(id) on delete set null,
  published_at  timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (def_id, version_no)
);

do $$ begin
  alter table public.wf_defs add constraint wf_defs_current_version_fk
    foreign key (current_version_id) references public.wf_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.wf_instances (
  id             uuid primary key default gen_random_uuid(),
  def_id         uuid not null references public.wf_defs(id),
  version_id     uuid not null references public.wf_versions(id),
  doc_no         text not null unique,
  title          text,
  data           jsonb not null default '{}'::jsonb,
  status         text not null check (status in ('in_progress','returned','approved','rejected','cancelled')),
  current_step   integer,                     -- index ขั้นปัจจุบัน (null = จบ)
  step_rev       integer not null default 0,  -- เพิ่มทุกครั้งที่ใบเปลี่ยน (compare-and-swap กันกดซ้อน)
  blocked_reason text,                        -- หาผู้อนุมัติไม่เจอ (fail-closed) — โชว์แดงบนจอ
  section        text,                        -- หน่วยของใบ = ส่วนงานบ้านของผู้เปิด ณ ตอนเปิด
  created_by     uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists wf_instances_created_by_idx on public.wf_instances (created_by, created_at desc);
create index if not exists wf_instances_def_idx on public.wf_instances (def_id, created_at desc);

create table if not exists public.wf_tasks (
  id           uuid primary key default gen_random_uuid(),
  instance_id  uuid not null references public.wf_instances(id) on delete cascade,
  step_index   integer not null,
  step_key     text not null,
  assignee_id  uuid not null references public.profiles(id) on delete cascade,
  via          text,                          -- ที่มาของผู้รับ (head / acting / perm / person / creator)
  status       text not null default 'open' check (status in ('open','done','cancelled')),
  created_at   timestamptz not null default now(),
  done_at      timestamptz
);
create index if not exists wf_tasks_assignee_open_idx on public.wf_tasks (assignee_id) where status = 'open';
create index if not exists wf_tasks_instance_idx on public.wf_tasks (instance_id);

create table if not exists public.wf_actions (
  id           bigint generated always as identity primary key,
  instance_id  uuid not null references public.wf_instances(id) on delete cascade,
  step_index   integer,
  step_key     text,
  action       text not null check (action in ('submit','approve','reject','return','resubmit','cancel')),
  comment      text,
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_name   text,
  acted_at     timestamptz not null default now()
);
create index if not exists wf_actions_instance_idx on public.wf_actions (instance_id, acted_at);

-- ─── 2) helper ───────────────────────────────────────────────────────────────────────
-- สิทธิ์ของ "โปรไฟล์ใดก็ได้" (ตรรกะเดียวกับ has_perm แต่รับ uid) — ใช้หาผู้อนุมัติ
create or replace function public.wf_profile_has_perm(p_uid uuid, p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select case when p.account_kind = 'shared' and p_key like '%:delete' then false
           else p.role = 'admin'::user_role
             or exists (select 1 from role_permissions rp where rp.role = p.role and rp.permission_key = p_key and rp.allowed)
             or (coalesce(p.is_dept_admin, false) and p_key not like 'page:%'
                 and exists (select 1 from role_permissions rp where rp.role = 'dept_admin'::user_role and rp.permission_key = p_key and rp.allowed))
           end
    from profiles p where p.id = p_uid), false);
$$;

-- แก้นิยามของหน่วยนี้ได้ไหม — admin หรือ ส่วนงานบ้านจริง (profiles.section) ตรงกัน
-- 🔴 ไม่ใช้ sections (ขอบเขตที่ "เห็น") · ไม่ใช้ scope:all_units (ยังแจกราย role · docs/ROLE-SCOPE-AUDIT-2026-11-13.md P1-1)
create or replace function public.wf_can_own(p_section text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select p.role = 'admin'::user_role
                       or (nullif(btrim(p.section), '') is not null and btrim(p.section) = btrim(coalesce(p_section, '')))
                   from profiles p where p.id = auth.uid()), false);
$$;

-- ใครเห็นใบนี้: ผู้เปิด · คนที่มี/เคยมีงานในใบ · admin · ถือ wf:view_all:<key> และใบอยู่ส่วนงานบ้านเดียวกัน
create or replace function public.wf_can_see(p_instance uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from wf_instances i join wf_defs d on d.id = i.def_id
    where i.id = p_instance and (
      i.created_by = auth.uid()
      or exists (select 1 from wf_tasks t where t.instance_id = i.id and t.assignee_id = auth.uid())
      or exists (select 1 from wf_actions a where a.instance_id = i.id and a.actor_id = auth.uid())
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'::user_role)
      or (has_perm('wf:view_all:' || d.key) and wf_can_own(i.section))
    ));
$$;

-- ตรวจคำตอบตาม form_schema (ช่องบังคับ · ตัวเลข · ตัวเลือก) → คืนข้อความผิดข้อแรก หรือ null
create or replace function public.wf_check_data(p_form jsonb, p_data jsonb)
returns text language plpgsql immutable as $$
declare f jsonb; v text; t text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return 'ข้อมูลฟอร์มไม่ถูกต้อง'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_form->'fields', '[]'::jsonb)) loop
    t := f->>'type';
    if t in ('heading','note') then continue; end if;
    v := nullif(btrim(coalesce(p_data->>(f->>'key'), '')), '');
    if coalesce((f->>'required')::boolean, false) and v is null then
      return 'กรุณากรอก: ' || coalesce(f->>'label', f->>'key');
    end if;
    if v is not null and t = 'number' and v !~ '^-?[0-9]+(\.[0-9]+)?$' then
      return 'ต้องเป็นตัวเลข: ' || coalesce(f->>'label', f->>'key');
    end if;
    if v is not null and t = 'select' and not (coalesce(f->'options', '[]'::jsonb) ? v) then
      return 'ค่าที่เลือกไม่อยู่ในตัวเลือก: ' || coalesce(f->>'label', f->>'key');
    end if;
  end loop;
  return null;
end $$;

-- หาผู้รับงานของขั้น — คืน {uids:[...], via:'...', reason:'...'} · หาไม่เจอ = uids ว่าง + reason (fail-closed)
create or replace function public.wf_resolve(p_instance uuid, p_step jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  i        wf_instances%rowtype;
  r        jsonb := coalesce(p_step->'assignee', '{}'::jsonb);
  v_rule   text := r->>'rule';
  v_kind   text := coalesce(p_step->>'kind', 'approve');
  v_node   uuid;
  v_lv     int := greatest(coalesce((r->>'levels')::int, 1), 1);
  v_hits   int := 0;
  v_heads  uuid[];
  v_uids   uuid[];
  v_unit   text;
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_guard  int := 0;
begin
  select * into i from wf_instances where id = p_instance;
  if v_rule = 'creator' then
    if v_kind = 'approve' then return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'ขั้นอนุมัติให้ผู้เปิดใบอนุมัติเองไม่ได้'); end if;
    return jsonb_build_object('uids', to_jsonb(array[i.created_by]), 'via', 'creator');
  elsif v_rule = 'person' then
    select array_agg(p.id) into v_uids from profiles p
     where p.id = nullif(r->>'profile_id', '')::uuid and coalesce(p.account_kind, '') <> 'shared'
       and (v_kind <> 'approve' or p.id <> i.created_by);
    if v_uids is null then return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'ไม่พบบัญชีผู้อนุมัติที่ระบุ (หรือเป็นผู้เปิดใบเอง)'); end if;
    return jsonb_build_object('uids', to_jsonb(v_uids), 'via', 'person');
  elsif v_rule = 'perm_in_unit' then
    v_unit := case when coalesce(r->>'unit', 'instance') = 'instance' then i.section else r->>'unit' end;
    if nullif(btrim(coalesce(v_unit, '')), '') is null then
      return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'ใบนี้ไม่มีส่วนงาน (บัญชีผู้เปิดไม่ได้ตั้งส่วนงาน)');
    end if;
    select array_agg(p.id order by p.full_name) into v_uids from (
      select p.id, p.full_name from profiles p
       where btrim(coalesce(p.section, '')) = btrim(v_unit)
         and coalesce(p.account_kind, '') <> 'shared'
         and p.id <> i.created_by
         and wf_profile_has_perm(p.id, r->>'perm')
       order by p.full_name) p;   -- 🔴 ไม่ตัดจำนวน (ตัดเงียบ = คนที่มีสิทธิ์หายจากคิว) · ตัวยิงแจ้งเตือนจำกัด 20 เอง
    if v_uids is null then
      return jsonb_build_object('uids', '[]'::jsonb, 'reason', format('ไม่มีใครในส่วนงาน %s ถือสิทธิ์ %s', v_unit, r->>'perm'));
    end if;
    return jsonb_build_object('uids', to_jsonb(v_uids), 'via', 'perm');
  elsif v_rule = 'creator_head' then
    select p.org_node_id into v_node from profiles p where p.id = i.created_by;
    if v_node is null then return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'บัญชีผู้เปิดใบไม่ได้ผูกหน่วยในผังองค์กร'); end if;
    while v_node is not null and v_guard < 20 loop
      v_guard := v_guard + 1;
      select array_agg(distinct a.profile_id) into v_heads from org_assignments a join profiles p on p.id = a.profile_id
       where a.org_node_id = v_node and a.profile_id <> i.created_by and coalesce(p.account_kind, '') <> 'shared'
         and a.kind in ('head', 'acting')
         and (a.starts_on is null or a.starts_on <= v_today)
         and (a.ends_on is null or a.ends_on >= v_today);
      if v_heads is not null then
        v_hits := v_hits + 1;
        if v_hits >= v_lv then return jsonb_build_object('uids', to_jsonb(v_heads), 'via', 'head'); end if;
      end if;
      select n.parent_id into v_node from org_nodes n where n.id = v_node;
    end loop;
    return jsonb_build_object('uids', '[]'::jsonb, 'reason', format('ไล่ผังองค์กรขึ้นไปไม่พบหัวหน้าชั้นที่ %s (ตั้งหัวหน้าที่ /org-setup)', v_lv));
  end if;
  return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'กฎหาผู้อนุมัติไม่รู้จัก: ' || coalesce(v_rule, '(ว่าง)'));
end $$;

-- เปิดขั้นปัจจุบัน: สร้าง task ให้ผู้รับทุกคน (คนใดคนหนึ่งกดได้) · หาไม่เจอ = blocked_reason
create or replace function public.wf_open_step(p_instance uuid)
returns uuid[] language plpgsql security definer set search_path to 'public' as $$
declare i wf_instances%rowtype; st jsonb; res jsonb; uids uuid[];
begin
  select * into i from wf_instances where id = p_instance;
  select v.flow_schema->'steps'->i.current_step into st from wf_versions v where v.id = i.version_id;
  res := wf_resolve(p_instance, st);
  select array_agg(x::uuid) into uids from jsonb_array_elements_text(res->'uids') x;
  if uids is null then
    update wf_instances set blocked_reason = coalesce(res->>'reason', 'หาผู้อนุมัติไม่ได้') where id = p_instance;
    return '{}';
  end if;
  insert into wf_tasks (instance_id, step_index, step_key, assignee_id, via)
  select p_instance, i.current_step, coalesce(st->>'key', 's' || i.current_step), u, res->>'via' from unnest(uids) u;
  update wf_instances set blocked_reason = null where id = p_instance;
  return uids;
end $$;

-- ─── 3) RPC ฝั่งออกแบบ ───────────────────────────────────────────────────────────────
-- บันทึกร่าง (สร้างนิยามใหม่ / แก้ร่าง / เปิดเวอร์ชันใหม่จากที่เผยแพร่แล้ว)
create or replace function public.wf_save_draft(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d wf_defs%rowtype; v wf_versions%rowtype; new_owner text := btrim(coalesce(p->>'owner_section', ''));
begin
  if not has_perm('wf:design') then raise exception 'ไม่มีสิทธิ์ออกแบบใบงาน (wf:design)'; end if;
  if new_owner = '' then raise exception 'ต้องระบุส่วนงานเจ้าของใบ'; end if;
  if not wf_can_own(new_owner) then raise exception 'ตั้งเจ้าของเป็นส่วนงาน % ไม่ได้ — ได้เฉพาะส่วนงานของคุณเอง', new_owner; end if;
  if nullif(p->>'def_id', '') is not null then
    select * into d from wf_defs where id = (p->>'def_id')::uuid for update;
    if not found then raise exception 'ไม่พบใบงานนี้'; end if;
    if not wf_can_own(d.owner_section) then raise exception 'ใบงานนี้เป็นของส่วนงาน % — คุณแก้ไม่ได้', d.owner_section; end if;
    if d.key <> coalesce(p->>'key', d.key) and d.current_version_id is not null then
      raise exception 'รหัสใบงาน (key) เปลี่ยนไม่ได้หลังเผยแพร่แล้ว';
    end if;
    update wf_defs set key = coalesce(nullif(p->>'key', ''), key), name = coalesce(nullif(btrim(p->>'name'), ''), name),
           description = p->>'description', owner_section = new_owner, number_prefix = nullif(btrim(p->>'number_prefix'), ''), updated_at = now()
     where id = d.id returning * into d;
  else
    insert into wf_defs (key, name, description, owner_section, number_prefix, created_by)
    values (p->>'key', btrim(p->>'name'), p->>'description', new_owner, nullif(btrim(p->>'number_prefix'), ''), auth.uid())
    returning * into d;
  end if;
  select * into v from wf_versions where def_id = d.id order by version_no desc limit 1 for update;
  if found and v.status = 'pending_publish' then raise exception 'เวอร์ชันนี้รอ admin เผยแพร่อยู่ — แก้ไม่ได้จนกว่าจะได้ผล'; end if;
  if found and v.status = 'draft' then
    update wf_versions set form_schema = coalesce(p->'form_schema', form_schema), flow_schema = coalesce(p->'flow_schema', flow_schema),
           start_roles = case when p ? 'start_roles' then array(select jsonb_array_elements_text(p->'start_roles')) else start_roles end, updated_at = now()
     where id = v.id returning * into v;
  else
    insert into wf_versions (def_id, version_no, form_schema, flow_schema, start_roles, created_by)
    values (d.id, coalesce(v.version_no, 0) + 1, coalesce(p->'form_schema', '{"fields":[]}'), coalesce(p->'flow_schema', '{"steps":[]}'),
            coalesce(array(select jsonb_array_elements_text(p->'start_roles')), '{}'), auth.uid())
    returning * into v;
  end if;
  return jsonb_build_object('def_id', d.id, 'version_id', v.id, 'version_no', v.version_no);
end $$;

-- key user ส่งขอเผยแพร่ → แจ้ง admin
create or replace function public.wf_request_publish(p_version uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v wf_versions%rowtype; d wf_defs%rowtype; st jsonb; n int; admins uuid[];
begin
  if not has_perm('wf:design') then raise exception 'ไม่มีสิทธิ์ออกแบบใบงาน (wf:design)'; end if;
  select * into v from wf_versions where id = p_version for update;
  if not found or v.status <> 'draft' then raise exception 'ส่งได้เฉพาะเวอร์ชันร่าง'; end if;
  select * into d from wf_defs where id = v.def_id;
  if not wf_can_own(d.owner_section) then raise exception 'ใบงานนี้เป็นของส่วนงาน % — คุณส่งไม่ได้', d.owner_section; end if;
  n := jsonb_array_length(coalesce(v.flow_schema->'steps', '[]'::jsonb));
  if n = 0 then raise exception 'ต้องมีอย่างน้อย 1 ขั้น'; end if;
  for st in select * from jsonb_array_elements(v.flow_schema->'steps') loop
    if coalesce(st->'assignee'->>'rule', '') not in ('creator_head','perm_in_unit','person','creator') then
      raise exception 'ขั้น "%" ยังไม่ได้ตั้งผู้อนุมัติ', coalesce(st->>'label', st->>'key');
    end if;
    if st->'assignee'->>'rule' = 'creator' and coalesce(st->>'kind', 'approve') = 'approve' then
      raise exception 'ขั้น "%" เป็นขั้นอนุมัติ — ให้ผู้เปิดใบอนุมัติเองไม่ได้', coalesce(st->>'label', st->>'key');
    end if;
  end loop;
  if coalesce(array_length(v.start_roles, 1), 0) = 0 then raise exception 'ยังไม่ได้เลือกว่า role ไหนเปิดใบได้'; end if;
  if jsonb_array_length(coalesce(v.form_schema->'fields', '[]'::jsonb)) = 0 then raise exception 'ฟอร์มยังไม่มีช่องกรอก'; end if;
  update wf_versions set status = 'pending_publish', submitted_by = auth.uid(), submitted_at = now(), review_note = null, updated_at = now() where id = v.id;
  select array_agg(id) into admins from (select id from profiles where role = 'admin'::user_role and coalesce(account_kind,'') <> 'shared' limit 20) a;
  return jsonb_build_object('notify', jsonb_build_array(jsonb_build_object('event', 'wf.publish_requested', 'users', to_jsonb(coalesce(admins, '{}')),
    'text', format('ขอเผยแพร่ใบงาน "%s" (v%s)', d.name, v.version_no))));
end $$;

-- admin อนุมัติเผยแพร่ / ส่งกลับ
create or replace function public.wf_review_publish(p_version uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v wf_versions%rowtype; d wf_defs%rowtype; r text; k text;
begin
  if not has_perm('wf:publish') then raise exception 'ไม่มีสิทธิ์เผยแพร่ใบงาน (wf:publish)'; end if;
  select * into v from wf_versions where id = p_version for update;
  if not found or v.status <> 'pending_publish' then raise exception 'เวอร์ชันนี้ไม่ได้รอเผยแพร่'; end if;
  select * into d from wf_defs where id = v.def_id for update;
  if not p_approve then
    if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'ส่งกลับต้องใส่เหตุผล'; end if;
    update wf_versions set status = 'draft', review_note = p_note, updated_at = now() where id = v.id;
    return jsonb_build_object('notify', jsonb_build_array(jsonb_build_object('event', 'wf.publish_reviewed', 'users', to_jsonb(array_remove(array[v.submitted_by], null)),
      'text', format('ใบงาน "%s" ถูกส่งกลับ: %s', d.name, p_note))));
  end if;
  foreach r in array v.start_roles loop
    if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'user_role' and e.enumlabel = r) then
      raise exception 'role "%" ไม่มีในระบบ', r;
    end if;
  end loop;
  update wf_versions set status = 'published', published_by = auth.uid(), published_at = now(), review_note = p_note, updated_at = now() where id = v.id;
  update wf_defs set current_version_id = v.id, status = 'active', updated_at = now() where id = d.id;
  -- สิทธิ์เปิดใบ = wf:start:<key> ตาม role ที่เลือก (role ที่ไม่ได้เลือก = allowed false)
  k := 'wf:start:' || d.key;
  insert into permission_catalog (resource, action, label, group_name, sort)
  values ('wf', 'start:' || d.key, 'e-Workflow: เปิดใบ ' || d.name, 'ตั้งค่าโปรแกรม,ฐานข้อมูล', 960)
  on conflict (resource, action) do update set label = excluded.label;
  update role_permissions set allowed = (role::text = any(v.start_roles)) where permission_key = k;
  insert into role_permissions (role, permission_key, allowed)
  select r2::user_role, k, true from unnest(v.start_roles) r2
  where not exists (select 1 from role_permissions rp where rp.role = r2::user_role and rp.permission_key = k);
  return jsonb_build_object('notify', jsonb_build_array(jsonb_build_object('event', 'wf.publish_reviewed', 'users', to_jsonb(array_remove(array[v.submitted_by], null)),
    'text', format('ใบงาน "%s" v%s เผยแพร่แล้ว', d.name, v.version_no))));
end $$;

-- admin เลิกใช้/เปิดใช้นิยาม (เลิกใช้ = ห้ามเปิดใบใหม่ · ใบเก่าเดินต่อจนจบ)
create or replace function public.wf_set_def_status(p_def uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_perm('wf:publish') then raise exception 'ไม่มีสิทธิ์ (wf:publish)'; end if;
  if p_status not in ('active', 'retired') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  update wf_defs set status = p_status, updated_at = now() where id = p_def and current_version_id is not null;
  if not found then raise exception 'ใบงานนี้ยังไม่เคยเผยแพร่'; end if;
end $$;

-- ─── 4) RPC ฝั่งใช้งาน ──────────────────────────────────────────────────────────────
create or replace function public.wf_start(p_key text, p_title text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d wf_defs%rowtype; v wf_versions%rowtype; me profiles%rowtype; err text; pre text; ym text; seq int; no text; iid uuid; uids uuid[];
begin
  select * into d from wf_defs where key = p_key;
  if not found or d.status <> 'active' or d.current_version_id is null then raise exception 'ใบงานนี้ยังไม่เปิดใช้'; end if;
  if not has_perm('wf:start:' || d.key) then raise exception 'คุณไม่มีสิทธิ์เปิดใบ "%"', d.name; end if;
  select * into v from wf_versions where id = d.current_version_id;
  err := wf_check_data(v.form_schema, p_data);
  if err is not null then raise exception '%', err; end if;
  select * into me from profiles where id = auth.uid();
  pre := upper(coalesce(d.number_prefix, d.key));
  ym := to_char(now() at time zone 'Asia/Bangkok', 'YYMM');
  perform pg_advisory_xact_lock(hashtext('wf_doc_no:' || pre || ym));
  select coalesce(max(nullif(regexp_replace(doc_no, '^.*-', ''), '')::int), 0) + 1 into seq
    from wf_instances where doc_no like pre || '-' || ym || '-%' and doc_no ~ '-[0-9]+$';
  no := pre || '-' || ym || '-' || lpad(seq::text, 3, '0');
  insert into wf_instances (def_id, version_id, doc_no, title, data, status, current_step, section, created_by, created_by_name)
  values (d.id, v.id, no, nullif(btrim(p_title), ''), p_data, 'in_progress', 0, nullif(btrim(me.section), ''), me.id, me.full_name)
  returning id into iid;
  insert into wf_actions (instance_id, step_index, action, actor_id, actor_name) values (iid, null, 'submit', me.id, me.full_name);
  uids := wf_open_step(iid);
  return jsonb_build_object('id', iid, 'doc_no', no,
    'notify', jsonb_build_array(jsonb_build_object('event', 'wf.task_assigned', 'users', to_jsonb(uids), 'text', format('%s %s รอคุณ', d.name, no))));
end $$;

create or replace function public.wf_act(p_task uuid, p_action text, p_comment text, p_expected_rev integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare t wf_tasks%rowtype; i wf_instances%rowtype; v wf_versions%rowtype; d wf_defs%rowtype; st jsonb; me profiles%rowtype; n int; uids uuid[]; notify jsonb := '[]'::jsonb;
begin
  if p_action not in ('approve', 'reject', 'return') then raise exception 'การกระทำไม่ถูกต้อง'; end if;
  select * into t from wf_tasks where id = p_task for update;
  if not found or t.status <> 'open' then raise exception 'งานนี้ปิดไปแล้ว — โหลดใหม่'; end if;
  if t.assignee_id <> auth.uid() then raise exception 'งานนี้ไม่ได้มอบให้คุณ'; end if;
  select * into i from wf_instances where id = t.instance_id for update;
  if i.step_rev <> p_expected_rev or i.status <> 'in_progress' or i.current_step is distinct from t.step_index then
    raise exception 'ใบนี้เปลี่ยนไปแล้ว (มีคนกดก่อน) — โหลดใหม่';
  end if;
  select * into v from wf_versions where id = i.version_id;
  select * into d from wf_defs where id = i.def_id;
  st := v.flow_schema->'steps'->t.step_index;
  n := jsonb_array_length(v.flow_schema->'steps');
  if p_action in ('reject', 'return') then
    if coalesce(st->>'kind', 'approve') = 'ack' then raise exception 'ขั้นรับทราบ ตีกลับ/ส่งกลับไม่ได้'; end if;
    if nullif(btrim(coalesce(p_comment, '')), '') is null then raise exception 'ต้องใส่เหตุผล'; end if;
  end if;
  select * into me from profiles where id = auth.uid();
  update wf_tasks set status = 'done', done_at = now() where id = t.id;
  update wf_tasks set status = 'cancelled', done_at = now() where instance_id = i.id and status = 'open' and id <> t.id;
  insert into wf_actions (instance_id, step_index, step_key, action, comment, actor_id, actor_name)
  values (i.id, t.step_index, t.step_key, p_action, nullif(btrim(p_comment), ''), me.id, me.full_name);
  if p_action = 'approve' then
    if t.step_index + 1 >= n then
      update wf_instances set status = 'approved', current_step = null, closed_at = now(), step_rev = step_rev + 1, updated_at = now() where id = i.id;
      notify := jsonb_build_array(jsonb_build_object('event', 'wf.closed', 'users', to_jsonb(array_remove(array[i.created_by], null)), 'text', format('%s %s อนุมัติครบแล้ว', d.name, i.doc_no)));
    else
      update wf_instances set current_step = t.step_index + 1, step_rev = step_rev + 1, updated_at = now() where id = i.id;
      uids := wf_open_step(i.id);
      notify := jsonb_build_array(jsonb_build_object('event', 'wf.task_assigned', 'users', to_jsonb(uids), 'text', format('%s %s รอคุณ', d.name, i.doc_no)));
    end if;
  elsif p_action = 'reject' then
    update wf_instances set status = 'rejected', closed_at = now(), step_rev = step_rev + 1, updated_at = now() where id = i.id;
    notify := jsonb_build_array(jsonb_build_object('event', 'wf.closed', 'users', to_jsonb(array_remove(array[i.created_by], null)), 'text', format('%s %s ถูกตีกลับ: %s', d.name, i.doc_no, p_comment)));
  else
    update wf_instances set status = 'returned', step_rev = step_rev + 1, updated_at = now() where id = i.id;
    notify := jsonb_build_array(jsonb_build_object('event', 'wf.returned', 'users', to_jsonb(array_remove(array[i.created_by], null)), 'text', format('%s %s ส่งกลับให้แก้: %s', d.name, i.doc_no, p_comment)));
  end if;
  return jsonb_build_object('ok', true, 'notify', notify);
end $$;

-- ผู้เปิดแก้แล้วส่งใหม่ (หลังถูกส่งกลับ) · เริ่มขั้นไหน = flow_schema.onReturn ('first' ค่าเริ่มต้น | 'same')
create or replace function public.wf_resubmit(p_instance uuid, p_data jsonb, p_expected_rev integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare i wf_instances%rowtype; v wf_versions%rowtype; d wf_defs%rowtype; err text; uids uuid[];
begin
  select * into i from wf_instances where id = p_instance for update;
  if not found or i.created_by <> auth.uid() then raise exception 'แก้ได้เฉพาะผู้เปิดใบ'; end if;
  if i.status <> 'returned' or i.step_rev <> p_expected_rev then raise exception 'ใบนี้เปลี่ยนไปแล้ว — โหลดใหม่'; end if;
  select * into v from wf_versions where id = i.version_id;
  select * into d from wf_defs where id = i.def_id;
  err := wf_check_data(v.form_schema, p_data);
  if err is not null then raise exception '%', err; end if;
  update wf_instances set data = p_data, status = 'in_progress', step_rev = step_rev + 1, updated_at = now(),
         current_step = case when v.flow_schema->>'onReturn' = 'same' then current_step else 0 end
   where id = i.id;
  insert into wf_actions (instance_id, step_index, action, actor_id, actor_name)
  select i.id, i.current_step, 'resubmit', p.id, p.full_name from profiles p where p.id = auth.uid();
  uids := wf_open_step(i.id);
  return jsonb_build_object('ok', true, 'notify', jsonb_build_array(jsonb_build_object('event', 'wf.task_assigned', 'users', to_jsonb(uids), 'text', format('%s %s (ส่งใหม่) รอคุณ', d.name, i.doc_no))));
end $$;

-- ยกเลิก: ผู้เปิดใบ (ก่อนมีคนอนุมัติขั้นใดเลย) หรือ admin · ต้องมีเหตุผล · ไม่ลบใบ
create or replace function public.wf_cancel(p_instance uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare i wf_instances%rowtype; is_admin boolean;
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'ต้องใส่เหตุผลที่ยกเลิก'; end if;
  select * into i from wf_instances where id = p_instance for update;
  if not found or i.status not in ('in_progress', 'returned') then raise exception 'ใบนี้ยกเลิกไม่ได้แล้ว'; end if;
  select p.role = 'admin'::user_role into is_admin from profiles p where p.id = auth.uid();
  if not coalesce(is_admin, false) then
    if i.created_by <> auth.uid() then raise exception 'ยกเลิกได้เฉพาะผู้เปิดใบ'; end if;
    if exists (select 1 from wf_actions a where a.instance_id = i.id and a.action = 'approve') then
      raise exception 'มีคนอนุมัติไปแล้ว — ยกเลิกเองไม่ได้ ให้ผู้อนุมัติตีกลับ';
    end if;
  end if;
  update wf_tasks set status = 'cancelled', done_at = now() where instance_id = i.id and status = 'open';
  update wf_instances set status = 'cancelled', closed_at = now(), step_rev = step_rev + 1, updated_at = now() where id = i.id;
  insert into wf_actions (instance_id, step_index, action, comment, actor_id, actor_name)
  select i.id, i.current_step, 'cancel', p_reason, p.id, p.full_name from profiles p where p.id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- ─── 5) RLS + GRANT (อ่านอย่างเดียว · เขียนผ่าน RPC) ────────────────────────────────
alter table public.wf_defs      enable row level security;
alter table public.wf_versions  enable row level security;
alter table public.wf_instances enable row level security;
alter table public.wf_tasks     enable row level security;
alter table public.wf_actions   enable row level security;

drop policy if exists wf_defs_select on public.wf_defs;
create policy wf_defs_select on public.wf_defs for select to authenticated using (true);
drop policy if exists wf_versions_select on public.wf_versions;
create policy wf_versions_select on public.wf_versions for select to authenticated using (true);
drop policy if exists wf_instances_select on public.wf_instances;
create policy wf_instances_select on public.wf_instances for select to authenticated using ((select public.wf_can_see(id)));
drop policy if exists wf_tasks_select on public.wf_tasks;
create policy wf_tasks_select on public.wf_tasks for select to authenticated using (assignee_id = (select auth.uid()) or (select public.wf_can_see(instance_id)));
drop policy if exists wf_actions_select on public.wf_actions;
create policy wf_actions_select on public.wf_actions for select to authenticated using ((select public.wf_can_see(instance_id)));

revoke all on public.wf_defs, public.wf_versions, public.wf_instances, public.wf_tasks, public.wf_actions from anon, authenticated;
grant select on public.wf_defs, public.wf_versions, public.wf_instances, public.wf_tasks, public.wf_actions to authenticated;

do $$
declare f text;
begin
  foreach f in array array['wf_save_draft(jsonb)','wf_request_publish(uuid)','wf_review_publish(uuid, boolean, text)',
    'wf_set_def_status(uuid, text)','wf_start(text, text, jsonb)','wf_act(uuid, text, text, integer)',
    'wf_resubmit(uuid, jsonb, integer)','wf_cancel(uuid, text)','wf_can_see(uuid)','wf_can_own(text)',
    'wf_profile_has_perm(uuid, text)','wf_resolve(uuid, jsonb)','wf_open_step(uuid)','wf_check_data(jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  foreach f in array array['wf_save_draft(jsonb)','wf_request_publish(uuid)','wf_review_publish(uuid, boolean, text)',
    'wf_set_def_status(uuid, text)','wf_start(text, text, jsonb)','wf_act(uuid, text, text, integer)',
    'wf_resubmit(uuid, jsonb, integer)','wf_cancel(uuid, text)','wf_can_see(uuid)','wf_can_own(text)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- updated_at + audit (กฎ traceability)
do $$
declare t text;
begin
  foreach t in array array['wf_defs','wf_versions','wf_instances'] loop
    if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
      execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
      execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    end if;
  end loop;
  foreach t in array array['wf_defs','wf_versions','wf_instances','wf_tasks'] loop
    if exists (select 1 from pg_proc where proname = 'fn_audit') then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
    end if;
  end loop;
end $$;

-- 🔴 เวอร์ชันที่เผยแพร่แล้วห้ามแก้ฟอร์ม/ขั้น (แก้ = เวอร์ชันใหม่)
create or replace function public.wf_versions_freeze()
returns trigger language plpgsql as $$
begin
  if old.status = 'published' and (new.form_schema is distinct from old.form_schema or new.flow_schema is distinct from old.flow_schema
     or new.start_roles is distinct from old.start_roles or new.status <> 'published') then
    raise exception 'เวอร์ชันที่เผยแพร่แล้วแก้ไม่ได้ — สร้างเวอร์ชันใหม่';
  end if;
  return new;
end $$;
drop trigger if exists trg_wf_versions_freeze on public.wf_versions;
create trigger trg_wf_versions_freeze before update on public.wf_versions for each row execute function public.wf_versions_freeze();

-- ─── 6) สิทธิ์ (role ระบุชัด ห้าม enum_range) ───────────────────────────────────────
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('wf', 'design',  'e-Workflow: ออกแบบใบงาน (ร่าง/ส่งขอเผยแพร่) — ใบของส่วนงานตัวเอง', 'ตั้งค่าโปรแกรม,ฐานข้อมูล', 947),
  ('wf', 'publish', 'e-Workflow: อนุมัติเผยแพร่ / เลิกใช้ใบงาน',                         'ตั้งค่าโปรแกรม,ฐานข้อมูล', 948)
on conflict (resource, action) do nothing;

-- เข้าหน้าใบงาน (เปิดใบ/อนุมัติ) — ทุก role ที่เป็นคน (ไม่ให้ display/viewer)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'page:/workflows', true
from (values ('admin'::user_role),('manager'::user_role),('supervisor'::user_role),('leader'::user_role),('qa'::user_role),
             ('mtn'::user_role),('engineer'::user_role),('planner_store'::user_role),('document_control'::user_role),
             ('marketing'::user_role),('warehouse_delivery'::user_role),('engineer_nm'::user_role),('sale'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = 'page:/workflows');

insert into public.role_permissions (role, permission_key, allowed)
select r.role, k.key, true
from (values ('admin'::user_role)) as r(role)
cross join (values ('page:/workflow-designer'),('wf:design'),('wf:publish')) as k(key)
where not exists (select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = k.key);

-- Key User = bucket dept_admin (E-WORKFLOW-DESIGN §9.4) — ออกแบบได้ · เผยแพร่ไม่ได้ (admin เท่านั้น)
insert into public.role_permissions (role, permission_key, allowed)
select 'dept_admin'::user_role, 'wf:design', true
where not exists (select 1 from public.role_permissions rp where rp.role = 'dept_admin'::user_role and rp.permission_key = 'wf:design');

-- ─── 7) แจ้งเตือน (ในแอปเท่านั้น · ผู้รับ = เจ้าของงานตรง extra_user_ids · inapp_roles ว่าง) ─────
insert into public.notification_rules (event_key, label, category, is_enabled, sort_order, inapp_roles, can_mute, link) values
  ('wf.task_assigned',    'e-Workflow: มีใบรอคุณอนุมัติ',          'workflow', true, 10, '{}', false, '/workflows?tab=inbox'),
  ('wf.returned',         'e-Workflow: ใบของคุณถูกส่งกลับให้แก้',  'workflow', true, 20, '{}', false, '/workflows?tab=mine'),
  ('wf.closed',           'e-Workflow: ใบของคุณจบแล้ว (อนุมัติ/ตีกลับ)', 'workflow', true, 30, '{}', true, '/workflows?tab=mine'),
  ('wf.publish_requested','e-Workflow: มีใบงานขอเผยแพร่',           'workflow', true, 40, '{}', false, '/workflow-designer?tab=review'),
  ('wf.publish_reviewed', 'e-Workflow: ผลการขอเผยแพร่ใบงาน',       'workflow', true, 50, '{}', true, '/workflow-designer')
on conflict (event_key) do nothing;

-- ── ตรวจผล ────────────────────────────────────────────────────────────────────────────
-- select tablename, count(*) from pg_policies where tablename like 'wf\_%' group by 1;            -- 5 ตาราง × 1 (select)
-- select grantee, privilege_type, table_name from information_schema.role_table_grants where table_name like 'wf\_%' and grantee in ('anon','authenticated');  -- authenticated SELECT อย่างเดียว
-- select role, permission_key from role_permissions where permission_key like 'wf:%' or permission_key like 'page:/workflow%' order by 2,1;
-- select event_key, can_mute from notification_rules where event_key like 'wf.%';
