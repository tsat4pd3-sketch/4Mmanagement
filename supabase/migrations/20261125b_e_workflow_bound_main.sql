-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🧩 e-Workflow — โหมด "ผูกเอกสาร" (bound) + รอบการเซ็น · project: MAIN (ewhdfqwfwofivojtsizn · จอ Supabase "MAIN")
-- 2026-11-25 · คำสั่ง user: "ทุกเอกสารในระบบ เรื่อง issued/checked/approved ควรคุมด้วย e-workflow"
--   + "ความถี่ในการเซ็นอนุมัติ/รับทราบ แต่ละเอกสารต่างกัน" + "ตั้งในหน้าจอได้ (ทะเบียนกลาง)"
-- ออกแบบ: docs/E-WORKFLOW-DESIGN.md §7.5 · โมดูล docs/modules/e-workflow.md §โหมดผูกเอกสาร
--
-- แนวคิด:
--   · การผูก = `wf_versions.flow_schema.binding` = { subject, period, perShift } — อยู่ในเวอร์ชัน ⇒ แช่แข็งตอนเผยแพร่
--     ตั้ง/แก้ที่หน้า /workflow-designer (key user ส่งขอ → admin เผยแพร่ เหมือนใบอื่น)
--   · 1 ใบ workflow = 1 "รอบ" ของเอกสาร (เช่น Poka-Yoke · Line 60 · กะเช้า · 25/11) · unique ต่อ (นิยาม, รอบ)
--   · ใบรอบเปิดโดยระบบ (`created_by` ว่าง) — ผู้ที่กดเปิดถูกบันทึกใน wf_actions เท่านั้น
--     (ไม่งั้นกฎ "ผู้เปิดอนุมัติใบตัวเองไม่ได้" จะตัด leader ที่บันทึกผลออกจากขั้นรับทราบของตัวเอง)
--   · กฎหาผู้เซ็นใหม่ `perm_in_line` (match: line = คนที่ผูกไลน์นี้/ไลน์แม่ · section = ทั้งส่วนงานของไลน์)
--   · เซ็นครบ (approved) = ล็อกผลตรวจในรอบนั้น (trigger ฝั่งตารางเอกสาร) · แก้ = เพิกถอน (`wf_revoke` · ต้องมีเหตุผล) แล้วเปิดรอบใหม่
--   · รอบ > 1 วัน อนุมัติได้หลังจบรอบเท่านั้น (กันเซ็นก่อนข้อมูลครบ)
--   · ตัวเอกสารที่ผูกได้ = ลงทะเบียนโดยโปรแกรมเมอร์ใน `wf_bound_subjects()` (ตอนนี้: pokayoke)
--
-- ✅ backward-compatible: คอลัมน์ใหม่ nullable · ใบ e-workflow แบบฟอร์มเดิมทำงานเหมือนเดิม (binding ว่าง)
-- ↩️ ROLLBACK (ย้อนโค้ดก่อน แล้วรันใน SQL Editor MAIN):
--   select cron.unschedule('wf-bound-scan');
--   drop trigger if exists trg_pokayoke_checks_wf_lock on public.pokayoke_checks;
--   drop function if exists public.pokayoke_checks_wf_lock(), public.wf_bound_scan(integer), public.wf_bound_ensure(text, text, date, text),
--     public.wf_bound_open(uuid, text, date, text, uuid), public.wf_revoke(uuid, text), public.wf_bound_locked(text, text, date, text),
--     public.wf_line_candidates(text, text, text), public.wf_period_range(text, date), public.wf_bound_subjects();
--   update public.wf_defs set status = 'retired' where key in ('pokayoke_daily', 'pokayoke_weekly');
--   (wf_resolve / wf_act / wf_request_publish / wf_can_see: รัน migration 20261113b ส่วนฟังก์ชันนั้นซ้ำเพื่อคืนของเดิม)
-- ═══════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 1) คอลัมน์ "รอบ" ของใบ ──────────────────────────────────────────────────────────
alter table public.wf_instances
  add column if not exists subject_kind text,
  add column if not exists subject_key  text,
  add column if not exists line_name    text,
  add column if not exists period_from  date,
  add column if not exists period_to    date,
  add column if not exists shift        text;

alter table public.wf_instances drop constraint if exists wf_instances_status_check;
alter table public.wf_instances add constraint wf_instances_status_check
  check (status in ('in_progress','returned','approved','rejected','cancelled','revoked'));
alter table public.wf_actions drop constraint if exists wf_actions_action_check;
alter table public.wf_actions add constraint wf_actions_action_check
  check (action in ('submit','approve','reject','return','resubmit','cancel','revoke'));

-- รอบเดียวกันของนิยามเดียวกัน มีใบที่ "ยังมีผล" ได้ใบเดียว (ตีกลับ/ยกเลิก/เพิกถอน = เปิดรอบใหม่ได้)
create unique index if not exists wf_instances_bound_active_uq on public.wf_instances (def_id, subject_key)
  where subject_key is not null and status in ('in_progress','returned','approved');
create index if not exists wf_instances_subject_idx on public.wf_instances (subject_kind, line_name, period_from);

-- ─── 2) ทะเบียนเอกสารที่ผูกได้ (โปรแกรมเมอร์ลงทะเบียน · ฝั่งจอ = BOUND_SUBJECTS ใน wfSchema.js ต้องตรงกัน) ─
create or replace function public.wf_bound_subjects()
returns jsonb language sql immutable as $$
  select '{"pokayoke": {"label": "Poka-Yoke Check", "record_perm": "pokayoke:record", "link": "/daily-checker?tab=pokayoke"}}'::jsonb;
$$;

-- ช่วงวันของรอบ — week = บล็อกสัปดาห์ของใบโรงงาน (1-7 / 8-14 / 15-21 / 22-สิ้นเดือน · ตรงกับ lpaPeriodRange()/weekOfDay)
create or replace function public.wf_period_range(p_period text, p_date date, out pfrom date, out pto date)
language plpgsql immutable as $$
declare d int := extract(day from p_date)::int; m date := date_trunc('month', p_date)::date; w int;
begin
  if p_period = 'day' then pfrom := p_date; pto := p_date;
  elsif p_period = 'week' then
    w := least(4, ceil(d / 7.0)::int);
    pfrom := m + (w - 1) * 7;
    pto := case when w = 4 then (m + interval '1 month' - interval '1 day')::date else m + w * 7 - 1 end;
  elsif p_period = 'month' then pfrom := m; pto := (m + interval '1 month' - interval '1 day')::date;
  elsif p_period = 'quarter' then
    pfrom := date_trunc('quarter', p_date)::date; pto := (date_trunc('quarter', p_date) + interval '3 month' - interval '1 day')::date;
  else raise exception 'ความถี่ไม่รู้จัก: %', coalesce(p_period, '(ว่าง)');
  end if;
end $$;

-- คนที่ถือคีย์ + ดูแลไลน์นี้ — match 'line' = ผูกไลน์นี้หรือไลน์แม่ (ไม่เจอ = ถอยไปทั้งส่วนงาน) · 'section' = ส่วนงานของไลน์
create or replace function public.wf_line_candidates(p_line text, p_perm text, p_match text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare l record; v_uids uuid[]; v_via text;
begin
  select pl.id, pl.section, (select x.id from production_lines x where x.name = pl.parent_line_name limit 1) as parent_id
    into l from production_lines pl where pl.name = p_line limit 1;
  if l.id is null then return jsonb_build_object('uids', '[]'::jsonb, 'reason', format('ไม่พบไลน์ "%s" ในทะเบียนไลน์', p_line)); end if;
  if coalesce(p_match, 'line') = 'line' then
    select array_agg(p.id order by p.full_name) into v_uids from profiles p
     where p.line_id in (l.id, l.parent_id) and coalesce(p.account_kind, '') <> 'shared' and wf_profile_has_perm(p.id, p_perm);
    v_via := 'line';
  end if;
  if v_uids is null then
    if nullif(btrim(coalesce(l.section, '')), '') is null then
      return jsonb_build_object('uids', '[]'::jsonb, 'reason', format('ไลน์ %s ยังไม่ได้ตั้งส่วนงาน', p_line));
    end if;
    select array_agg(p.id order by p.full_name) into v_uids from profiles p
     where btrim(coalesce(p.section, '')) = btrim(l.section) and coalesce(p.account_kind, '') <> 'shared' and wf_profile_has_perm(p.id, p_perm);
    v_via := 'section';
  end if;
  if v_uids is null then
    return jsonb_build_object('uids', '[]'::jsonb, 'reason', format('ไม่มีใครในไลน์/ส่วนงานของ %s ถือสิทธิ์ %s', p_line, p_perm));
  end if;
  return jsonb_build_object('uids', to_jsonb(v_uids), 'via', v_via);
end $$;

-- ─── 3) ตัวหาผู้อนุมัติ — เพิ่มกฎ perm_in_line (ที่เหลือเหมือน 20261113b เป๊ะ) ─────────────
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
  v_res    jsonb;
begin
  select * into i from wf_instances where id = p_instance;
  if v_rule = 'creator' then
    if v_kind = 'approve' then return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'ขั้นอนุมัติให้ผู้เปิดใบอนุมัติเองไม่ได้'); end if;
    if i.created_by is null then return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'ใบนี้ระบบเปิด — ไม่มีผู้เปิดใบ'); end if;
    return jsonb_build_object('uids', to_jsonb(array[i.created_by]), 'via', 'creator');
  elsif v_rule = 'person' then
    select array_agg(p.id) into v_uids from profiles p
     where p.id = nullif(r->>'profile_id', '')::uuid and coalesce(p.account_kind, '') <> 'shared'
       and (v_kind <> 'approve' or p.id is distinct from i.created_by);
    if v_uids is null then return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'ไม่พบบัญชีผู้อนุมัติที่ระบุ (หรือเป็นผู้เปิดใบเอง)'); end if;
    return jsonb_build_object('uids', to_jsonb(v_uids), 'via', 'person');
  elsif v_rule = 'perm_in_line' then
    if nullif(btrim(coalesce(i.line_name, '')), '') is null then
      return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'กฎ "ตามไลน์" ใช้ได้เฉพาะใบที่ผูกไลน์ (ใบรอบเอกสาร)');
    end if;
    v_res := wf_line_candidates(i.line_name, r->>'perm', coalesce(r->>'match', 'line'));
    if i.created_by is not null and v_kind = 'approve' then
      select array_agg(x::uuid) into v_uids from jsonb_array_elements_text(v_res->'uids') x where x::uuid <> i.created_by;
      if v_uids is null then return jsonb_build_object('uids', '[]'::jsonb, 'reason', coalesce(v_res->>'reason', 'มีแต่ผู้เปิดใบเองที่ถือสิทธิ์')); end if;
      return jsonb_build_object('uids', to_jsonb(v_uids), 'via', v_res->>'via');
    end if;
    return v_res;
  elsif v_rule = 'perm_in_unit' then
    v_unit := case when coalesce(r->>'unit', 'instance') = 'instance' then i.section else r->>'unit' end;
    if nullif(btrim(coalesce(v_unit, '')), '') is null then
      return jsonb_build_object('uids', '[]'::jsonb, 'reason', 'ใบนี้ไม่มีส่วนงาน (บัญชีผู้เปิดไม่ได้ตั้งส่วนงาน)');
    end if;
    select array_agg(p.id order by p.full_name) into v_uids from (
      select p.id, p.full_name from profiles p
       where btrim(coalesce(p.section, '')) = btrim(v_unit)
         and coalesce(p.account_kind, '') <> 'shared'
         and p.id is distinct from i.created_by
         and wf_profile_has_perm(p.id, r->>'perm')
       order by p.full_name) p;
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

-- ─── 4) เห็นใบ: ใบรอบเอกสารเห็นได้ทุกคนที่ login (สถานะการเซ็นของใบตรวจไม่ใช่ความลับ) ───────
create or replace function public.wf_can_see(p_instance uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from wf_instances i join wf_defs d on d.id = i.def_id
    where i.id = p_instance and (
      i.subject_kind is not null
      or i.created_by = auth.uid()
      or exists (select 1 from wf_tasks t where t.instance_id = i.id and t.assignee_id = auth.uid())
      or exists (select 1 from wf_actions a where a.instance_id = i.id and a.actor_id = auth.uid())
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'::user_role)
      or (has_perm('wf:view_all:' || d.key) and wf_can_own(i.section))
    ));
$$;

-- ─── 5) เปิด "ใบรอบ" (ภายใน · ใช้ทั้ง RPC และตัวสแกน) ─────────────────────────────────────
create or replace function public.wf_bound_open(p_def uuid, p_line text, p_date date, p_shift text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d wf_defs%rowtype; v wf_versions%rowtype; b jsonb; rng record; v_shift text; skey text; ex wf_instances%rowtype;
        pre text; ym text; seq int; no text; iid uuid; uids uuid[]; v_today date := (now() at time zone 'Asia/Bangkok')::date;
        actor_name text; sec text; ptxt text;
begin
  select * into d from wf_defs where id = p_def;
  if not found or d.status <> 'active' or d.current_version_id is null then raise exception 'ใบงานนี้ยังไม่เปิดใช้'; end if;
  select * into v from wf_versions where id = d.current_version_id;
  b := v.flow_schema->'binding';
  if b is null then raise exception 'ใบงาน % ไม่ได้ผูกเอกสาร', d.key; end if;
  if nullif(btrim(coalesce(p_line, '')), '') is null or p_date is null then raise exception 'ต้องระบุไลน์และวันที่'; end if;
  select * into rng from wf_period_range(b->>'period', p_date);
  v_shift := case when coalesce((b->>'perShift')::boolean, false) then nullif(btrim(coalesce(p_shift, '')), '') else null end;
  if coalesce((b->>'perShift')::boolean, false) and v_shift is null then raise exception 'ใบนี้แยกกะ — ต้องระบุกะ'; end if;
  skey := btrim(p_line) || '|' || rng.pfrom || '|' || coalesce(v_shift, '');
  select * into ex from wf_instances where def_id = d.id and subject_key = skey and status in ('in_progress','returned','approved') limit 1;
  if found then return jsonb_build_object('id', ex.id, 'status', ex.status, 'created', false, 'from', rng.pfrom, 'to', rng.pto); end if;
  -- รอบหลายวัน เปิดได้เมื่อจบรอบแล้ว (เซ็นก่อนข้อมูลครบ = ลายเซ็นรับรองของที่ยังไม่เกิด)
  if b->>'period' <> 'day' and rng.pto >= v_today then
    return jsonb_build_object('id', null, 'status', 'period_open', 'created', false, 'from', rng.pfrom, 'to', rng.pto);
  end if;
  select section into sec from production_lines where name = btrim(p_line) limit 1;
  select full_name into actor_name from profiles where id = p_actor;
  pre := upper(coalesce(d.number_prefix, d.key));
  ym := to_char(now() at time zone 'Asia/Bangkok', 'YYMM');
  perform pg_advisory_xact_lock(hashtext('wf_doc_no:' || pre || ym));
  select coalesce(max(nullif(regexp_replace(doc_no, '^.*-', ''), '')::int), 0) + 1 into seq
    from wf_instances where doc_no like pre || '-' || ym || '-%' and doc_no ~ '-[0-9]+$';
  no := pre || '-' || ym || '-' || lpad(seq::text, 3, '0');
  ptxt := case when rng.pfrom = rng.pto then to_char(rng.pfrom, 'DD/MM/YYYY') else to_char(rng.pfrom, 'DD/MM') || '–' || to_char(rng.pto, 'DD/MM/YYYY') end;
  begin
    insert into wf_instances (def_id, version_id, doc_no, title, data, status, current_step, section, created_by, created_by_name,
                              subject_kind, subject_key, line_name, period_from, period_to, shift)
    values (d.id, v.id, no, d.name || ' · ' || btrim(p_line) || ' · ' || ptxt || coalesce(' · ' || case v_shift when 'night' then 'กะดึก' when 'day' then 'กะเช้า' else v_shift end, ''),
            jsonb_build_object('line', btrim(p_line), 'from', rng.pfrom, 'to', rng.pto, 'shift', v_shift),
            'in_progress', 0, sec, null, 'ระบบ (เปิดรอบอัตโนมัติ)',
            b->>'subject', skey, btrim(p_line), rng.pfrom, rng.pto, v_shift)
    returning id into iid;
  exception when unique_violation then
    select * into ex from wf_instances where def_id = d.id and subject_key = skey and status in ('in_progress','returned','approved') limit 1;
    return jsonb_build_object('id', ex.id, 'status', ex.status, 'created', false, 'from', rng.pfrom, 'to', rng.pto);
  end;
  insert into wf_actions (instance_id, step_index, action, actor_id, actor_name, comment)
  values (iid, null, 'submit', p_actor, coalesce(actor_name, 'ระบบ'), 'เปิดรอบอัตโนมัติ');
  uids := wf_open_step(iid);
  return jsonb_build_object('id', iid, 'status', 'in_progress', 'created', true, 'from', rng.pfrom, 'to', rng.pto, 'assignees', coalesce(array_length(uids, 1), 0));
end $$;

-- RPC: จอเอกสารขอ "ใบรอบของวันนี้/สัปดาห์นี้" (มีแล้ว = คืนใบเดิม · ไม่สร้างซ้ำ)
create or replace function public.wf_bound_ensure(p_key text, p_line text, p_date date, p_shift text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d wf_defs%rowtype; v wf_versions%rowtype; subj jsonb; st jsonb; ok boolean;
begin
  select * into d from wf_defs where key = p_key;
  if not found or d.status <> 'active' or d.current_version_id is null then
    return jsonb_build_object('id', null, 'status', 'not_active');
  end if;
  select * into v from wf_versions where id = d.current_version_id;
  subj := wf_bound_subjects()->(v.flow_schema->'binding'->>'subject');
  if subj is null then raise exception 'ใบงาน % ผูกเอกสารที่ระบบไม่รู้จัก', p_key; end if;
  ok := has_perm(subj->>'record_perm');
  if not ok then
    for st in select * from jsonb_array_elements(coalesce(v.flow_schema->'steps', '[]'::jsonb)) loop
      if nullif(st->'assignee'->>'perm', '') is not null and has_perm(st->'assignee'->>'perm') then ok := true; end if;
    end loop;
  end if;
  if not ok then raise exception 'ไม่มีสิทธิ์เปิดรอบเซ็นของ %', d.name; end if;
  return wf_bound_open(d.id, p_line, p_date, p_shift, auth.uid());
end $$;

-- ─── 6) อนุมัติ/ตีกลับ — เพิ่มกติกาใบรอบ (ที่เหลือเหมือน 20261113b เป๊ะ) ─────────────────
create or replace function public.wf_act(p_task uuid, p_action text, p_comment text, p_expected_rev integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare t wf_tasks%rowtype; i wf_instances%rowtype; v wf_versions%rowtype; d wf_defs%rowtype; st jsonb; me profiles%rowtype; n int; uids uuid[]; notify jsonb := '[]'::jsonb;
        b jsonb; v_today date := (now() at time zone 'Asia/Bangkok')::date;
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
  b := v.flow_schema->'binding';
  if b is not null and i.subject_key is not null then
    if p_action = 'return' then raise exception 'ใบรอบเอกสารส่งกลับแก้ไม่ได้ — ตีกลับพร้อมเหตุผลแทน (ผู้บันทึกแก้แล้วรอบใหม่จะเปิดเอง)'; end if;
    if p_action = 'approve' and coalesce(b->>'period', 'day') <> 'day' and i.period_to >= v_today then
      raise exception 'ยังไม่จบรอบ (ถึง %) — อนุมัติได้หลังจบรอบ', to_char(i.period_to, 'DD/MM/YYYY');
    end if;
  end if;
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

-- ─── 7) เพิกถอนลายเซ็นของใบรอบ (ปลดล็อกให้แก้) — คนที่ถือสิทธิ์ของขั้นสุดท้าย + ดูแลไลน์นี้ · ต้องมีเหตุผล ──
create or replace function public.wf_revoke(p_instance uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare i wf_instances%rowtype; v wf_versions%rowtype; st jsonb; res jsonb;
begin
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'ต้องใส่เหตุผลที่เพิกถอน (อย่างน้อย 5 ตัวอักษร)'; end if;
  select * into i from wf_instances where id = p_instance for update;
  if not found or i.subject_key is null then raise exception 'เพิกถอนได้เฉพาะใบรอบเอกสาร'; end if;
  if i.status <> 'approved' then raise exception 'ใบนี้ยังไม่ได้เซ็นครบ — ไม่มีอะไรให้เพิกถอน'; end if;
  select * into v from wf_versions where id = i.version_id;
  st := v.flow_schema->'steps'->(jsonb_array_length(v.flow_schema->'steps') - 1);
  res := wf_line_candidates(i.line_name, st->'assignee'->>'perm', coalesce(st->'assignee'->>'match', 'line'));
  if not (res->'uids' ? auth.uid()::text) and not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'::user_role) then
    raise exception 'เพิกถอนได้เฉพาะคนที่มีสิทธิ์เซ็นขั้นสุดท้ายของไลน์นี้';
  end if;
  update wf_instances set status = 'revoked', closed_at = now(), step_rev = step_rev + 1, updated_at = now() where id = i.id;
  insert into wf_actions (instance_id, step_index, action, comment, actor_id, actor_name)
  select i.id, null, 'revoke', btrim(p_reason), p.id, p.full_name from profiles p where p.id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- ─── 8) ตัวสแกนรายวัน: เปิดใบรอบของ "เมื่อวาน" ให้เองเมื่อมีข้อมูลแต่ยังไม่มีใครเปิด ─────────
create or replace function public.wf_bound_scan(p_days integer default 1)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d record; c record; n int := 0; v_today date := (now() at time zone 'Asia/Bangkok')::date; res jsonb;
begin
  for d in select df.id, df.key, vv.flow_schema->'binding' as b from wf_defs df join wf_versions vv on vv.id = df.current_version_id
            where df.status = 'active' and vv.flow_schema ? 'binding' loop
    if d.b->>'subject' = 'pokayoke' then
      for c in select distinct dv.line_name, k.check_date, k.shift from pokayoke_checks k join pokayoke_devices dv on dv.id = k.device_id
                where k.check_date >= v_today - p_days and k.check_date < v_today loop
        begin
          res := wf_bound_open(d.id, c.line_name, c.check_date, c.shift, null);
          if coalesce((res->>'created')::boolean, false) then n := n + 1; end if;
        exception when others then
          raise warning 'wf_bound_scan %/%: %', d.key, c.line_name, sqlerrm;   -- ไลน์เดียวล้ม ห้ามลากทั้งรอบ
        end;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('opened', n, 'day', v_today);
end $$;

-- ─── 9) ล็อกผลตรวจที่เซ็นแล้ว (Poka-Yoke) ────────────────────────────────────────────────
create or replace function public.wf_bound_locked(p_kind text, p_line text, p_date date, p_shift text)
returns text language sql stable security definer set search_path to 'public' as $$
  select i.doc_no || ' (' || coalesce(i.title, '') || ')' from wf_instances i
   where i.subject_kind = p_kind and i.line_name = p_line and i.status = 'approved'
     and p_date between i.period_from and i.period_to and (i.shift is null or i.shift = p_shift)
   order by i.period_from limit 1;
$$;

create or replace function public.pokayoke_checks_wf_lock()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record; why text;
begin
  for r in select x.device_id, x.check_date, x.shift from (
             select new.device_id, new.check_date, new.shift where tg_op in ('INSERT', 'UPDATE')
             union all select old.device_id, old.check_date, old.shift where tg_op in ('UPDATE', 'DELETE')) x loop
    select wf_bound_locked('pokayoke', dv.line_name, r.check_date, r.shift) into why from pokayoke_devices dv where dv.id = r.device_id;
    if why is not null then
      raise exception 'ผลทดสอบรอบนี้เซ็นแล้ว (%) — ให้ผู้เซ็นเพิกถอนก่อนแก้', why using errcode = 'P0001';
    end if;
  end loop;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_pokayoke_checks_wf_lock on public.pokayoke_checks;
create trigger trg_pokayoke_checks_wf_lock before insert or update or delete on public.pokayoke_checks
  for each row execute function public.pokayoke_checks_wf_lock();

-- ─── 10) ส่งขอเผยแพร่ — รับกฎ perm_in_line + ใบรอบไม่ต้องมีฟอร์ม/role เปิดใบ (ที่เหลือเหมือนเดิม) ──
create or replace function public.wf_request_publish(p_version uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v wf_versions%rowtype; d wf_defs%rowtype; st jsonb; n int; admins uuid[]; b jsonb;
begin
  if not has_perm('wf:design') then raise exception 'ไม่มีสิทธิ์ออกแบบใบงาน (wf:design)'; end if;
  select * into v from wf_versions where id = p_version for update;
  if not found or v.status <> 'draft' then raise exception 'ส่งได้เฉพาะเวอร์ชันร่าง'; end if;
  select * into d from wf_defs where id = v.def_id;
  if not wf_can_own(d.owner_section) then raise exception 'ใบงานนี้เป็นของส่วนงาน % — คุณส่งไม่ได้', d.owner_section; end if;
  b := v.flow_schema->'binding';
  n := jsonb_array_length(coalesce(v.flow_schema->'steps', '[]'::jsonb));
  if n = 0 then raise exception 'ต้องมีอย่างน้อย 1 ขั้น'; end if;
  if b is not null then
    if wf_bound_subjects()->(b->>'subject') is null then raise exception 'เอกสารที่ผูก "%" ระบบไม่รู้จัก', b->>'subject'; end if;
    if coalesce(b->>'period', '') not in ('day','week','month','quarter') then raise exception 'ยังไม่ได้เลือกความถี่การเซ็น'; end if;
  end if;
  for st in select * from jsonb_array_elements(v.flow_schema->'steps') loop
    if coalesce(st->'assignee'->>'rule', '') not in ('creator_head','perm_in_unit','perm_in_line','person','creator') then
      raise exception 'ขั้น "%" ยังไม่ได้ตั้งผู้อนุมัติ', coalesce(st->>'label', st->>'key');
    end if;
    if st->'assignee'->>'rule' = 'creator' and coalesce(st->>'kind', 'approve') = 'approve' then
      raise exception 'ขั้น "%" เป็นขั้นอนุมัติ — ให้ผู้เปิดใบอนุมัติเองไม่ได้', coalesce(st->>'label', st->>'key');
    end if;
    if st->'assignee'->>'rule' = 'perm_in_line' and b is null then
      raise exception 'ขั้น "%" ใช้กฎ "ตามไลน์" ได้เฉพาะใบที่ผูกเอกสาร', coalesce(st->>'label', st->>'key');
    end if;
    if b is not null and st->'assignee'->>'rule' in ('creator', 'creator_head') then
      raise exception 'ขั้น "%" — ใบรอบเอกสารระบบเปิดเอง ไม่มีผู้เปิดใบ ใช้กฎ "ตามไลน์"/"ตามส่วนงาน"/"ระบุคน"', coalesce(st->>'label', st->>'key');
    end if;
  end loop;
  if b is null then
    if coalesce(array_length(v.start_roles, 1), 0) = 0 then raise exception 'ยังไม่ได้เลือกว่า role ไหนเปิดใบได้'; end if;
    if jsonb_array_length(coalesce(v.form_schema->'fields', '[]'::jsonb)) = 0 then raise exception 'ฟอร์มยังไม่มีช่องกรอก'; end if;
  end if;
  update wf_versions set status = 'pending_publish', submitted_by = auth.uid(), submitted_at = now(), review_note = null, updated_at = now() where id = v.id;
  select array_agg(id) into admins from (select id from profiles where role = 'admin'::user_role and coalesce(account_kind,'') <> 'shared' limit 20) a;
  return jsonb_build_object('notify', jsonb_build_array(jsonb_build_object('event', 'wf.publish_requested', 'users', to_jsonb(coalesce(admins, '{}')),
    'text', format('ขอเผยแพร่ใบงาน "%s" (v%s)', d.name, v.version_no))));
end $$;

-- ─── 11) สิทธิ์ของฟังก์ชัน ─────────────────────────────────────────────────────────────
revoke all on function public.wf_bound_open(uuid, text, date, text, uuid) from public, anon, authenticated;
revoke all on function public.wf_bound_scan(integer) from public, anon, authenticated;
revoke all on function public.wf_line_candidates(text, text, text) from public, anon, authenticated;
revoke all on function public.pokayoke_checks_wf_lock() from public, anon, authenticated;
revoke all on function public.wf_bound_ensure(text, text, date, text) from public, anon;
revoke all on function public.wf_revoke(uuid, text) from public, anon;
revoke all on function public.wf_bound_locked(text, text, date, text) from public, anon;
grant execute on function public.wf_bound_ensure(text, text, date, text) to authenticated;
grant execute on function public.wf_revoke(uuid, text) to authenticated;
grant execute on function public.wf_bound_locked(text, text, date, text) to authenticated;
grant execute on function public.wf_bound_subjects() to authenticated;
grant execute on function public.wf_period_range(text, date) to authenticated;

-- ─── 12) คีย์สิทธิ์ของขั้น Poka-Yoke (role ระบุชัด · ห้าม enum_range) ─────────────────────
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('pokayoke', 'ack',     'Poka-Yoke: รับทราบผลทดสอบรายวัน (ขั้น Leader ใน e-Workflow)',      'ฝ่ายผลิต', 120),
  ('pokayoke', 'approve', 'Poka-Yoke: อนุมัติผลทดสอบรายสัปดาห์ (ขั้น Supervisor ใน e-Workflow)', 'ฝ่ายผลิต', 121)
on conflict (resource, action) do update set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;
insert into public.role_permissions (role, permission_key, allowed)
select k.role, k.key, true
from (values ('leader'::user_role, 'pokayoke:ack'), ('supervisor'::user_role, 'pokayoke:approve')) as k(role, key)
where not exists (select 1 from public.role_permissions x where x.role = k.role and x.permission_key = k.key);

-- ─── 13) นิยามใบนำร่อง 2 ใบ (เผยแพร่แล้ว · แก้ต่อได้ที่ /workflow-designer = เวอร์ชันใหม่) ───────
do $$
declare d1 uuid; d2 uuid; v1 uuid; v2 uuid;
begin
  if not exists (select 1 from wf_defs where key = 'pokayoke_daily') then
    insert into wf_defs (key, name, description, owner_section, number_prefix, status)
    values ('pokayoke_daily', 'Poka-Yoke · รับทราบรายวัน', 'ใบรอบ: Leader รับทราบผลทดสอบ Poka-Yoke ของไลน์ ต่อกะต่อวัน', 'PD3', 'PYD', 'draft')
    returning id into d1;
    insert into wf_versions (def_id, version_no, form_schema, flow_schema, start_roles, status, published_at, review_note)
    values (d1, 1, '{"fields":[]}'::jsonb,
      '{"binding":{"subject":"pokayoke","period":"day","perShift":true},"onReturn":"first",
        "steps":[{"key":"leader","label":"Leader รับทราบ","kind":"ack","assignee":{"rule":"perm_in_line","perm":"pokayoke:ack","match":"line"}}]}'::jsonb,
      '{}', 'published', now(), 'ตั้งต้นโดย migration 20261125b (คำสั่ง user 25/11)')
    returning id into v1;
    update wf_defs set current_version_id = v1, status = 'active' where id = d1;
  end if;
  if not exists (select 1 from wf_defs where key = 'pokayoke_weekly') then
    insert into wf_defs (key, name, description, owner_section, number_prefix, status)
    values ('pokayoke_weekly', 'Poka-Yoke · อนุมัติรายสัปดาห์', 'ใบรอบ: Supervisor อนุมัติผลทดสอบ Poka-Yoke ของไลน์ ต่อสัปดาห์ (บล็อก 1-7/8-14/15-21/22-สิ้นเดือน)', 'PD3', 'PYW', 'draft')
    returning id into d2;
    insert into wf_versions (def_id, version_no, form_schema, flow_schema, start_roles, status, published_at, review_note)
    values (d2, 1, '{"fields":[]}'::jsonb,
      '{"binding":{"subject":"pokayoke","period":"week","perShift":false},"onReturn":"first",
        "steps":[{"key":"sv","label":"Supervisor อนุมัติ","kind":"approve","assignee":{"rule":"perm_in_line","perm":"pokayoke:approve","match":"section"}}]}'::jsonb,
      '{}', 'published', now(), 'ตั้งต้นโดย migration 20261125b (คำสั่ง user 25/11)')
    returning id into v2;
    update wf_defs set current_version_id = v2, status = 'active' where id = d2;
  end if;
end $$;

commit;

-- 08:45 ไทย = 01:45 UTC — เปิดใบรอบของเมื่อวานที่มีข้อมูลแต่ยังไม่มีใครเปิด (นอก transaction: cron.schedule)
select cron.schedule('wf-bound-scan', '45 1 * * *', $$ select public.wf_bound_scan(1); $$);

-- ── ตรวจผล ──
-- select key, status, current_version_id is not null from wf_defs where key like 'pokayoke_%';
-- select role, permission_key, allowed from role_permissions where permission_key in ('pokayoke:ack','pokayoke:approve');
-- select * from wf_period_range('week', '2026-11-25');   -- 2026-11-22 .. 2026-11-30
