-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🧩 e-Workflow ขั้น 2 — "ตารางตรวจ (คน × วัน)" ที่ออกแบบได้ในหน้าออกแบบใบงาน
-- project: MAIN (ewhdfqwfwofivojtsizn · จอ Supabase "MAIN") · 2026-11-26
-- คำสั่ง user: "สร้างใบตรวจแบบตารางได้ทุกแบบ" · "เริ่มตารางใหม่ 1 ธ.ค." ·
--   "พอขึ้นตารางใหม่ค่อยย้าย data เก่ามาใส่ย้อนหลังให้ แล้วลบตารางเดิมทิ้ง" (= ขั้นถัดไป · ไม่อยู่ในไฟล์นี้)
--
-- แนวคิด:
--   · ใบตรวจแบบตาราง = ใบงาน e-workflow ที่ผูกเอกสาร `binding.subject = 'grid'` + ช่องชนิด `checkgrid` 1 ช่องในฟอร์ม
--     (สัญลักษณ์ · หัวข้อ · สิทธิ์บันทึก · ทะเบียนเอกสาร · ตัวเติมอัตโนมัติ · แจ้งเตือน = ตั้งในหน้าออกแบบ · แช่แข็งตอนเผยแพร่)
--   · ข้อมูลอยู่ตารางกลาง 3 ตัว (ใช้ร่วมทุกใบตรวจแบบตาราง แยกด้วย def_key):
--       wf_grid_sheets (ใบ = ใบงาน × ไลน์ × รอบ) · wf_grid_cells (คน × วัน) · wf_grid_row_notes (หมายเหตุท้ายแถว)
--   · สายเซ็น = ขั้นของใบงานเดียวกัน (ใบรอบ wf_instances) · เซ็นขั้นแรกแล้ว = ล็อก (trigger · เหมือน BBS เดิม)
--   · BBS ตั้งแต่ ธ.ค. 2569 ใช้ใบงาน `bbs_grid` · ต.ค.–พ.ย. ยังอยู่ตาราง bbs_* เดิมจนกว่าจะย้าย
--
-- ✅ backward-compatible: ตารางใหม่ล้วน · ฟังก์ชันที่แทนที่ (wf_bound_subjects/ensure/scan/request_publish) คงพฤติกรรมเดิมของ pokayoke/bbs
-- ↩️ ROLLBACK (ย้อนโค้ดก่อน แล้วรันใน SQL Editor MAIN):
--   update public.wf_defs set status = 'retired' where key = 'bbs_grid';
--   drop table if exists public.wf_grid_row_notes, public.wf_grid_cells, public.wf_grid_sheets;
--   drop function if exists public.wf_grid_lock(), public.wf_grid_locked(text, text, date), public.wf_grid_record_perm(text), public.wf_grid_can_write(text);
--   (wf_bound_subjects / wf_bound_ensure / wf_bound_scan / wf_request_publish: รันส่วนนั้นของ 20261125c / 20261125b ซ้ำ)
-- ═══════════════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 1) ตาราง ───────────────────────────────────────────────────────────────────────────
create table if not exists public.wf_grid_sheets (
  id uuid primary key default gen_random_uuid(),
  def_key text not null,
  line_name text not null,
  section text,
  period_from date not null,
  period_to date not null,
  header jsonb not null default '{}'::jsonb,
  updated_by_uid uuid default auth.uid(),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (def_key, line_name, period_from)
);
create table if not exists public.wf_grid_cells (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.wf_grid_sheets(id) on delete cascade,
  row_key text not null,                         -- คน (employees.id) · ตามแหล่งแถวของช่อง
  col int not null check (col between 1 and 31), -- วันที่ในรอบ
  mark text not null,                            -- คีย์สัญลักษณ์ตามฟอร์ม (ok/ng/fixed/na ของ BBS)
  item_seq int,                                  -- เลขหัวข้อ (สัญลักษณ์ที่ต้องระบุข้อ)
  note text,
  source text not null default 'manual',         -- manual | <ตัวเติมอัตโนมัติ เช่น ppe>
  updated_by_uid uuid default auth.uid(),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sheet_id, row_key, col)
);
create table if not exists public.wf_grid_row_notes (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.wf_grid_sheets(id) on delete cascade,
  row_key text not null,
  note text,
  updated_by_uid uuid default auth.uid(),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sheet_id, row_key)
);
create index if not exists wf_grid_cells_sheet_idx on public.wf_grid_cells (sheet_id);
create index if not exists wf_grid_sheets_def_period_idx on public.wf_grid_sheets (def_key, period_from);

-- ─── 2) สิทธิ์: คีย์บันทึกอ่านจากฟอร์มของใบงาน (ตั้งที่หน้าออกแบบ) · ไม่มีใบงาน/ไม่มีคีย์ = เขียนไม่ได้ (fail-closed) ─
create or replace function public.wf_grid_record_perm(p_def_key text)
returns text language sql stable security definer set search_path to 'public' as $$
  select nullif(f->>'recordPerm', '')
    from wf_defs d join wf_versions v on v.id = d.current_version_id,
         jsonb_array_elements(coalesce(v.form_schema->'fields', '[]'::jsonb)) f
   where d.key = p_def_key and d.status = 'active' and f->>'type' = 'checkgrid'
   limit 1;
$$;
create or replace function public.wf_grid_can_write(p_def_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(has_perm(wf_grid_record_perm(p_def_key)), false);
$$;

alter table public.wf_grid_sheets enable row level security;
alter table public.wf_grid_cells enable row level security;
alter table public.wf_grid_row_notes enable row level security;
drop policy if exists wf_grid_sheets_read on public.wf_grid_sheets;
drop policy if exists wf_grid_sheets_write on public.wf_grid_sheets;
create policy wf_grid_sheets_read on public.wf_grid_sheets for select to authenticated using (true);
create policy wf_grid_sheets_write on public.wf_grid_sheets for all to authenticated
  using (wf_grid_can_write(def_key)) with check (wf_grid_can_write(def_key));
drop policy if exists wf_grid_cells_read on public.wf_grid_cells;
drop policy if exists wf_grid_cells_write on public.wf_grid_cells;
create policy wf_grid_cells_read on public.wf_grid_cells for select to authenticated using (true);
create policy wf_grid_cells_write on public.wf_grid_cells for all to authenticated
  using (exists (select 1 from wf_grid_sheets s where s.id = sheet_id and wf_grid_can_write(s.def_key)))
  with check (exists (select 1 from wf_grid_sheets s where s.id = sheet_id and wf_grid_can_write(s.def_key)));
drop policy if exists wf_grid_notes_read on public.wf_grid_row_notes;
drop policy if exists wf_grid_notes_write on public.wf_grid_row_notes;
create policy wf_grid_notes_read on public.wf_grid_row_notes for select to authenticated using (true);
create policy wf_grid_notes_write on public.wf_grid_row_notes for all to authenticated
  using (exists (select 1 from wf_grid_sheets s where s.id = sheet_id and wf_grid_can_write(s.def_key)))
  with check (exists (select 1 from wf_grid_sheets s where s.id = sheet_id and wf_grid_can_write(s.def_key)));
grant select, insert, update, delete on public.wf_grid_sheets, public.wf_grid_cells, public.wf_grid_row_notes to authenticated;
revoke all on public.wf_grid_sheets, public.wf_grid_cells, public.wf_grid_row_notes from anon;

-- ─── 3) ล็อก: มีคนเซ็นแล้ว (ใบรอบของใบงานเดียวกัน · ไลน์ · รอบ) = แก้ไม่ได้ ─────────────────
create or replace function public.wf_grid_locked(p_def_key text, p_line text, p_from date)
returns text language sql stable security definer set search_path to 'public' as $$
  select i.doc_no || ' (' || coalesce(i.title, '') || ')' from wf_instances i join wf_defs d on d.id = i.def_id
   where d.key = p_def_key and i.subject_kind = 'grid' and i.line_name = p_line and i.period_from = p_from
     and (i.status = 'approved'
          or (i.status = 'in_progress' and exists (select 1 from wf_actions a where a.instance_id = i.id and a.action = 'approve')))
   limit 1;
$$;
create or replace function public.wf_grid_lock()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record; why text;
begin
  if tg_table_name = 'wf_grid_sheets' then
    for r in select x.def_key, x.line_name, x.period_from from (
               select new.def_key, new.line_name, new.period_from where tg_op in ('INSERT', 'UPDATE')
               union all select old.def_key, old.line_name, old.period_from where tg_op in ('UPDATE', 'DELETE')) x loop
      why := wf_grid_locked(r.def_key, r.line_name, r.period_from);
      if why is not null then raise exception 'ใบนี้เซ็นแล้ว (%) — ให้ผู้เซ็นตีกลับ/เพิกถอนก่อนแก้', why using errcode = 'P0001'; end if;
    end loop;
  else
    for r in select s.def_key, s.line_name, s.period_from from wf_grid_sheets s
              where s.id in (select new.sheet_id where tg_op in ('INSERT', 'UPDATE')
                             union all select old.sheet_id where tg_op in ('UPDATE', 'DELETE')) loop
      why := wf_grid_locked(r.def_key, r.line_name, r.period_from);
      if why is not null then raise exception 'ใบนี้เซ็นแล้ว (%) — ให้ผู้เซ็นตีกลับ/เพิกถอนก่อนแก้', why using errcode = 'P0001'; end if;
    end loop;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.wf_grid_lock() from public, anon, authenticated;
drop trigger if exists trg_wf_grid_sheets_lock on public.wf_grid_sheets;
create trigger trg_wf_grid_sheets_lock before insert or update or delete on public.wf_grid_sheets for each row execute function public.wf_grid_lock();
drop trigger if exists trg_wf_grid_cells_lock on public.wf_grid_cells;
create trigger trg_wf_grid_cells_lock before insert or update or delete on public.wf_grid_cells for each row execute function public.wf_grid_lock();
drop trigger if exists trg_wf_grid_notes_lock on public.wf_grid_row_notes;
create trigger trg_wf_grid_notes_lock before insert or update or delete on public.wf_grid_row_notes for each row execute function public.wf_grid_lock();

-- ─── 4) ทะเบียนเอกสารที่ผูกได้ + grid (ฝั่งจอ = BOUND_SUBJECTS ใน src/utils/wfBound.js) ───────
create or replace function public.wf_bound_subjects()
returns jsonb language sql immutable as $$
  select '{"pokayoke": {"label": "Poka-Yoke Check", "record_perm": "pokayoke:record", "link": "/daily-checker?tab=pokayoke", "doc_key": null},
           "bbs":      {"label": "BBS — สังเกตพฤติกรรมความปลอดภัย", "record_perm": "bbs:record", "link": "/daily-checker?tab=bbs", "doc_key": "bbs_observation"},
           "grid":     {"label": "ใบตรวจแบบตาราง (ออกแบบในใบงานนี้)", "record_perm": null, "link": null, "doc_key": null}}'::jsonb;
$$;

-- เปิดรอบ: grid อ่านคีย์บันทึกจากช่อง checkgrid ของฟอร์ม (ที่เหลือเหมือน 20261125b เป๊ะ)
create or replace function public.wf_bound_ensure(p_key text, p_line text, p_date date, p_shift text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d wf_defs%rowtype; v wf_versions%rowtype; subj jsonb; st jsonb; ok boolean; rp text;
begin
  select * into d from wf_defs where key = p_key;
  if not found or d.status <> 'active' or d.current_version_id is null then
    return jsonb_build_object('id', null, 'status', 'not_active');
  end if;
  select * into v from wf_versions where id = d.current_version_id;
  subj := wf_bound_subjects()->(v.flow_schema->'binding'->>'subject');
  if subj is null then raise exception 'ใบงาน % ผูกเอกสารที่ระบบไม่รู้จัก', p_key; end if;
  rp := coalesce(subj->>'record_perm', wf_grid_record_perm(d.key));
  ok := rp is not null and has_perm(rp);
  if not ok then
    for st in select * from jsonb_array_elements(coalesce(v.flow_schema->'steps', '[]'::jsonb)) loop
      if nullif(st->'assignee'->>'perm', '') is not null and has_perm(st->'assignee'->>'perm') then ok := true; end if;
    end loop;
  end if;
  if not ok then raise exception 'ไม่มีสิทธิ์เปิดรอบเซ็นของ %', d.name; end if;
  return wf_bound_open(d.id, p_line, p_date, p_shift, auth.uid());
end $$;
revoke all on function public.wf_bound_ensure(text, text, date, text) from public, anon;
grant execute on function public.wf_bound_ensure(text, text, date, text) to authenticated;

-- ตัวสแกน: + grid (ใบที่มีข้อมูล · รอบจบแล้วภายใน 40 วัน) · ส่วน pokayoke/bbs เหมือน 20261125c เป๊ะ
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
          raise warning 'wf_bound_scan %/%: %', d.key, c.line_name, sqlerrm;
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
    elsif d.b->>'subject' = 'grid' then
      for c in select s.line_name, s.period_from from wf_grid_sheets s
                where s.def_key = d.key and s.period_to < v_today and s.period_to >= v_today - 40
                  and exists (select 1 from wf_grid_cells x where x.sheet_id = s.id) loop
        begin
          res := wf_bound_open(d.id, c.line_name, c.period_from, null, null);
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

-- ส่งขอเผยแพร่: + ด่านใบตรวจแบบตาราง (ต้องมีช่อง checkgrid 1 ช่องที่ตั้งคีย์บันทึก · ไม่แยกกะ) · ที่เหลือเหมือน 20261125b เป๊ะ
create or replace function public.wf_request_publish(p_version uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v wf_versions%rowtype; d wf_defs%rowtype; st jsonb; n int; admins uuid[]; b jsonb; ng int;
begin
  if not has_perm('wf:design') then raise exception 'ไม่มีสิทธิ์ออกแบบใบงาน (wf:design)'; end if;
  select * into v from wf_versions where id = p_version for update;
  if not found or v.status <> 'draft' then raise exception 'ส่งได้เฉพาะเวอร์ชันร่าง'; end if;
  select * into d from wf_defs where id = v.def_id;
  if not wf_can_own(d.owner_section) then raise exception 'ใบงานนี้เป็นของส่วนงาน % — คุณส่งไม่ได้', d.owner_section; end if;
  b := v.flow_schema->'binding';
  n := jsonb_array_length(coalesce(v.flow_schema->'steps', '[]'::jsonb));
  if n = 0 then raise exception 'ต้องมีอย่างน้อย 1 ขั้น'; end if;
  select count(*) into ng from jsonb_array_elements(coalesce(v.form_schema->'fields', '[]'::jsonb)) f where f->>'type' = 'checkgrid';
  if b is not null then
    if wf_bound_subjects()->(b->>'subject') is null then raise exception 'เอกสารที่ผูก "%" ระบบไม่รู้จัก', b->>'subject'; end if;
    if coalesce(b->>'period', '') not in ('day','week','month','quarter') then raise exception 'ยังไม่ได้เลือกความถี่การเซ็น'; end if;
    if b->>'subject' = 'grid' then
      if ng <> 1 then raise exception 'ใบตรวจแบบตารางต้องมีช่อง "ตารางตรวจ" 1 ช่องพอดี (ตอนนี้ % ช่อง)', ng; end if;
      if not exists (select 1 from jsonb_array_elements(v.form_schema->'fields') f where f->>'type' = 'checkgrid' and nullif(f->>'recordPerm', '') is not null) then
        raise exception 'ช่อง "ตารางตรวจ" ยังไม่ได้เลือกคีย์สิทธิ์บันทึก';
      end if;
      if coalesce((b->>'perShift')::boolean, false) then raise exception 'ใบตรวจแบบตารางยังไม่รองรับแยกกะ'; end if;
    end if;
  end if;
  if ng > 0 and coalesce(b->>'subject', '') <> 'grid' then raise exception 'ช่อง "ตารางตรวจ" ใช้ได้เฉพาะใบที่ผูกเอกสาร "ใบตรวจแบบตาราง"'; end if;
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

revoke all on function public.wf_grid_record_perm(text) from public, anon;
revoke all on function public.wf_grid_can_write(text) from public, anon;
revoke all on function public.wf_grid_locked(text, text, date) from public, anon;
grant execute on function public.wf_grid_record_perm(text), public.wf_grid_can_write(text), public.wf_grid_locked(text, text, date) to authenticated;

-- ─── 5) ใบงาน bbs_grid — BBS ตั้งแต่ ธ.ค. 2569 (ฟอร์ม = ตารางตรวจ · หัวข้อ 13 ข้อยกจาก bbs_agreements ณ วันนี้) ──
do $$
declare d1 uuid; v1 uuid; items jsonb;
begin
  if not exists (select 1 from wf_defs where key = 'bbs_grid') then
    select coalesce(jsonb_agg(jsonb_build_object('seq', seq, 'text', text, 'auto', auto_source) order by seq), '[]'::jsonb)
      into items from bbs_agreements where is_active;
    insert into wf_defs (key, name, description, owner_section, number_prefix, status)
    values ('bbs_grid', 'BBS · สังเกตพฤติกรรมความปลอดภัย', 'ใบตรวจแบบตาราง (คน × วัน) รายเดือนต่อไลน์ · ผู้ตรวจออกใบ → Supervisor ตรวจสอบ → Manager อนุมัติ · ใช้ตั้งแต่ ธ.ค. 2569', 'PD3', 'BBS', 'draft')
    returning id into d1;
    insert into wf_versions (def_id, version_no, form_schema, flow_schema, start_roles, status, published_at, review_note)
    values (d1, 1,
      jsonb_build_object('fields', jsonb_build_array(jsonb_build_object(
        'key', 'grid', 'type', 'checkgrid', 'label', 'ผลสังเกตพฤติกรรมความปลอดภัย',
        'rows', 'line_employees', 'recordPerm', 'bbs:record', 'docKey', 'bbs_observation',
        'autofill', 'ppe_daily', 'alertEvent', 'bbs_unsafe', 'rowNote', true,
        'marks', '[{"key":"ok","glyph":"✓","label":"พฤติกรรมเหมาะสม","color":"green"},
                   {"key":"ng","glyph":"#","label":"ไม่เหมาะสม (ใส่เลขข้อที่ผิด)","color":"red","needsItem":true,"alert":true},
                   {"key":"fixed","glyph":"m","label":"ปรับแก้แล้วหลังผู้ตรวจแนะนำ","color":"blue"},
                   {"key":"na","glyph":"✗","label":"ไม่ได้ตรวจ (ไม่มาทำงาน/งานนอกบริษัท)","color":"muted"}]'::jsonb,
        'items', items,
        'itemsTitle', 'ข้อตกลงด้านความปลอดภัยในการปฏิบัติงาน (สิ่งที่ควรทำ)'))),
      '{"binding":{"subject":"grid","period":"month","perShift":false},"onReturn":"first",
        "steps":[
          {"key":"issue","label":"ผู้ตรวจ ยืนยันออกใบ","sig_label":"ออกโดย (ผู้ตรวจ)","kind":"ack","assignee":{"rule":"perm_in_line","perm":"bbs:record","match":"line"}},
          {"key":"check","label":"Supervisor ตรวจสอบ","sig_label":"ตรวจสอบโดย","kind":"approve","assignee":{"rule":"perm_in_line","perm":"bbs:check","match":"section"}},
          {"key":"approve","label":"Manager อนุมัติ","sig_label":"อนุมัติโดย","kind":"approve","assignee":{"rule":"perm_in_line","perm":"bbs:approve","match":"section"}}]}'::jsonb,
      '{}', 'published', now(), 'ตั้งต้นโดย migration 20261126 (คำสั่ง user 26/11)')
    returning id into v1;
    update wf_defs set current_version_id = v1, status = 'active' where id = d1;
  end if;
end $$;

commit;

-- ── ตรวจผล ──
-- select key, status from wf_defs where key = 'bbs_grid';
-- select wf_grid_record_perm('bbs_grid');   -- bbs:record
-- select jsonb_array_length(v.form_schema->'fields'->0->'items') from wf_defs d join wf_versions v on v.id = d.current_version_id where d.key = 'bbs_grid';   -- 13
-- select tablename, cmd from pg_policies where tablename like 'wf_grid_%';
