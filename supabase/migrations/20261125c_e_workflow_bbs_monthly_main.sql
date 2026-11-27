-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🦺 BBS เข้า e-Workflow (นำร่องเอกสารแรกที่ "สายเซ็นทั้งใบ" คุมด้วย e-workflow)
-- project: MAIN (ewhdfqwfwofivojtsizn · จอ Supabase "MAIN") · 2026-11-25
-- คำสั่ง user: "ลองทำจาก BBS ก่อน แล้วค่อยทยอยเอาที่เหลือเข้า · อนาคตทุกเอกสารผ่าน e-workflow เพื่อคุมเอกสาร"
--   + สายเซ็น "ผู้ตรวจ → Supervisor → Manager" · เซ็นบนใบ BBS เอง ไม่ต้องออกใบ e-workflow แยก
--
-- สิ่งที่เปลี่ยน:
--   1) `wf_bound_subjects()` เพิ่ม bbs (+ `doc_key` = แถวในทะเบียนเอกสาร /doc-forms ที่ใบนี้ผูก)
--   2) `wf_bound_locked()` ล็อกตั้งแต่ "มีคนเซ็นแล้ว 1 ขั้น" (เดิม: เฉพาะเซ็นครบ)
--      — เอกสารหลายขั้น: ผู้ตรวจเซ็นออกใบแล้ว ข้อมูลต้องนิ่งให้ Supervisor/Manager ตรวจของเดียวกัน
--      · Poka-Yoke (ใบละ 1 ขั้น) ไม่เปลี่ยนพฤติกรรม: เซ็นขั้นแรก = เซ็นครบ
--   3) trigger ล็อก bbs_observations / bbs_row_notes / bbs_sheets
--   4) `wf_bound_scan()` เปิดใบรอบ BBS ของเดือนก่อนให้เอง (ใบที่มีผลสังเกต)
--   5) คีย์สิทธิ์ bbs:check (supervisor) · bbs:approve (manager) + นิยามใบ bbs_monthly (เผยแพร่แล้ว)
--   6) cron `wf-bound-scan` — ของ migration 20261125b ไม่ได้ลงจริง (ตรวจ 25/11: ไม่มี job) ⇒ ลงที่นี่
--
-- ✅ backward-compatible: ไม่มีคอลัมน์ใหม่ · ใบ BBS ที่ยังไม่มีใครเซ็น = แก้ได้เหมือนเดิม
-- ↩️ ROLLBACK (ย้อนโค้ดก่อน แล้วรันใน SQL Editor MAIN):
--   drop trigger if exists trg_bbs_obs_wf_lock on public.bbs_observations;
--   drop trigger if exists trg_bbs_notes_wf_lock on public.bbs_row_notes;
--   drop trigger if exists trg_bbs_sheets_wf_lock on public.bbs_sheets;
--   drop function if exists public.bbs_wf_lock();
--   update public.wf_defs set status = 'retired' where key = 'bbs_monthly';
--   (wf_bound_subjects / wf_bound_locked / wf_bound_scan: รันส่วนนั้นของ 20261125b ซ้ำเพื่อคืนของเดิม)
-- ═══════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 1) ทะเบียนเอกสารที่ผูกได้ (ฝั่งจอ = BOUND_SUBJECTS ใน src/utils/wfBound.js ต้องตรงกัน) ─
create or replace function public.wf_bound_subjects()
returns jsonb language sql immutable as $$
  select '{"pokayoke": {"label": "Poka-Yoke Check", "record_perm": "pokayoke:record", "link": "/daily-checker?tab=pokayoke", "doc_key": null},
           "bbs":      {"label": "BBS — สังเกตพฤติกรรมความปลอดภัย", "record_perm": "bbs:record", "link": "/daily-checker?tab=bbs", "doc_key": "bbs_observation"}}'::jsonb;
$$;

-- ─── 2) ล็อกตั้งแต่มีคนเซ็นแล้ว (เซ็นครบ หรือ กำลังเดินแต่มีลายเซ็นอย่างน้อย 1 ขั้น) ─────────
create or replace function public.wf_bound_locked(p_kind text, p_line text, p_date date, p_shift text)
returns text language sql stable security definer set search_path to 'public' as $$
  select i.doc_no || ' (' || coalesce(i.title, '') || ')' from wf_instances i
   where i.subject_kind = p_kind and i.line_name = p_line
     and (i.status = 'approved'
          or (i.status = 'in_progress' and exists (select 1 from wf_actions a where a.instance_id = i.id and a.action = 'approve')))
     and p_date between i.period_from and i.period_to and (i.shift is null or i.shift = p_shift)
   order by i.period_from limit 1;
$$;

-- ─── 3) ล็อกผล BBS ของเดือนที่เริ่มเซ็นแล้ว ─────────────────────────────────────────────
create or replace function public.bbs_wf_lock()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record; why text;
begin
  if tg_table_name = 'bbs_sheets' then
    for r in select x.month_key, x.line_name from (
               select new.month_key, new.line_name where tg_op in ('INSERT', 'UPDATE')
               union all select old.month_key, old.line_name where tg_op in ('UPDATE', 'DELETE')) x loop
      why := wf_bound_locked('bbs', r.line_name, (r.month_key || '-01')::date, null);
      if why is not null then raise exception 'ใบ BBS เดือนนี้เซ็นแล้ว (%) — ให้ผู้เซ็นตีกลับ/เพิกถอนก่อนแก้', why using errcode = 'P0001'; end if;
    end loop;
  else
    for r in select s.month_key, s.line_name from bbs_sheets s
              where s.id in (select new.sheet_id where tg_op in ('INSERT', 'UPDATE')
                             union all select old.sheet_id where tg_op in ('UPDATE', 'DELETE')) loop
      why := wf_bound_locked('bbs', r.line_name, (r.month_key || '-01')::date, null);
      if why is not null then raise exception 'ใบ BBS เดือนนี้เซ็นแล้ว (%) — ให้ผู้เซ็นตีกลับ/เพิกถอนก่อนแก้', why using errcode = 'P0001'; end if;
    end loop;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.bbs_wf_lock() from public, anon, authenticated;

drop trigger if exists trg_bbs_obs_wf_lock on public.bbs_observations;
create trigger trg_bbs_obs_wf_lock before insert or update or delete on public.bbs_observations
  for each row execute function public.bbs_wf_lock();
drop trigger if exists trg_bbs_notes_wf_lock on public.bbs_row_notes;
create trigger trg_bbs_notes_wf_lock before insert or update or delete on public.bbs_row_notes
  for each row execute function public.bbs_wf_lock();
drop trigger if exists trg_bbs_sheets_wf_lock on public.bbs_sheets;
create trigger trg_bbs_sheets_wf_lock before insert or update or delete on public.bbs_sheets
  for each row execute function public.bbs_wf_lock();

-- ─── 4) ตัวสแกนรายวัน — เพิ่ม BBS (เดือนก่อนที่มีผลสังเกต) · ส่วน Poka-Yoke เหมือน 20261125b เป๊ะ ──
create or replace function public.wf_bound_scan(p_days integer default 1)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d record; c record; n int := 0; v_today date := (now() at time zone 'Asia/Bangkok')::date; res jsonb;
        v_prev text := to_char((now() at time zone 'Asia/Bangkok')::date - interval '1 month', 'YYYY-MM');
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
    elsif d.b->>'subject' = 'bbs' then
      for c in select s.line_name, (s.month_key || '-01')::date as d0 from bbs_sheets s
                where s.month_key = v_prev and exists (select 1 from bbs_observations o where o.sheet_id = s.id) loop
        begin
          res := wf_bound_open(d.id, c.line_name, c.d0, null, null);
          if coalesce((res->>'created')::boolean, false) then n := n + 1; end if;
        exception when others then
          raise warning 'wf_bound_scan %/%: %', d.key, c.line_name, sqlerrm;
        end;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('opened', n, 'day', v_today);
end $$;
revoke all on function public.wf_bound_scan(integer) from public, anon, authenticated;

-- ─── 5) คีย์สิทธิ์ของขั้น BBS (role ระบุชัด) ─────────────────────────────────────────────
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('bbs', 'check',   'BBS — ตรวจสอบใบรายเดือน (ขั้น Supervisor ใน e-Workflow)', 'ฝ่ายผลิต', 262),
  ('bbs', 'approve', 'BBS — อนุมัติใบรายเดือน (ขั้น Manager ใน e-Workflow)',    'ฝ่ายผลิต', 263)
on conflict (resource, action) do update set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;
insert into public.role_permissions (role, permission_key, allowed)
select k.role, k.key, true
from (values ('supervisor'::user_role, 'bbs:check'), ('manager'::user_role, 'bbs:approve')) as k(role, key)
where not exists (select 1 from public.role_permissions x where x.role = k.role and x.permission_key = k.key);

-- ─── 6) นิยามใบ bbs_monthly (เผยแพร่แล้ว · แก้ต่อที่ /workflow-designer = เวอร์ชันใหม่) ────────
--   sig_label = ชื่อช่องเซ็นบนใบพิมพ์ (ออกโดย / ตรวจสอบโดย / อนุมัติโดย)
do $$
declare d1 uuid; v1 uuid;
begin
  if not exists (select 1 from wf_defs where key = 'bbs_monthly') then
    insert into wf_defs (key, name, description, owner_section, number_prefix, status)
    values ('bbs_monthly', 'BBS · ใบรายเดือน', 'ใบรอบ: ผู้ตรวจออกใบ → Supervisor ตรวจสอบ → Manager อนุมัติ · ต่อไลน์ต่อเดือน (ผูกทะเบียนเอกสาร bbs_observation)', 'PD3', 'BBS', 'draft')
    returning id into d1;
    insert into wf_versions (def_id, version_no, form_schema, flow_schema, start_roles, status, published_at, review_note)
    values (d1, 1, '{"fields":[]}'::jsonb,
      '{"binding":{"subject":"bbs","period":"month","perShift":false},"onReturn":"first",
        "steps":[
          {"key":"issue","label":"ผู้ตรวจ ยืนยันออกใบ","sig_label":"ออกโดย (ผู้ตรวจ)","kind":"ack","assignee":{"rule":"perm_in_line","perm":"bbs:record","match":"line"}},
          {"key":"check","label":"Supervisor ตรวจสอบ","sig_label":"ตรวจสอบโดย","kind":"approve","assignee":{"rule":"perm_in_line","perm":"bbs:check","match":"section"}},
          {"key":"approve","label":"Manager อนุมัติ","sig_label":"อนุมัติโดย","kind":"approve","assignee":{"rule":"perm_in_line","perm":"bbs:approve","match":"section"}}]}'::jsonb,
      '{}', 'published', now(), 'ตั้งต้นโดย migration 20261125c (คำสั่ง user 25/11)')
    returning id into v1;
    update wf_defs set current_version_id = v1, status = 'active' where id = d1;
  end if;
end $$;

commit;

-- ─── 7) cron (นอก transaction) — 08:45 ไทย = 01:45 UTC · ลงซ้ำได้ (unschedule ก่อนถ้ามี) ──
select cron.unschedule(jobid) from cron.job where jobname = 'wf-bound-scan';
select cron.schedule('wf-bound-scan', '45 1 * * *', $$ select public.wf_bound_scan(1); $$);

-- ── ตรวจผล ──
-- select key, status, current_version_id is not null from wf_defs where key = 'bbs_monthly';
-- select role, permission_key from role_permissions where permission_key in ('bbs:check','bbs:approve');
-- select jobname, schedule from cron.job where jobname = 'wf-bound-scan';
-- select tgname from pg_trigger where tgname like 'trg_bbs_%wf_lock';
