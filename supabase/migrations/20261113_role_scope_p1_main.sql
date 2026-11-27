-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🔐 role ↔ scope — P1 ของ audit 13/11 (docs/ROLE-SCOPE-AUDIT-2026-11-13.md)
-- project: MAIN (ชื่อในจอ Supabase "MAIN" · ewhdfqwfwofivojtsizn)   2026-11-13
--
-- กฎจาก user (ใช้ตัดสินทุกข้อ):
--   · role = ชุดสิทธิ์ใช้ระบบ ไม่ใช่ตำแหน่ง · "manager ไม่ได้แปลว่าแก้ข้ามแผนกได้"
--   · ความกว้างของ "การแก้" มาจากขอบเขต**รายคน**เท่านั้น: profiles.section (บ้าน) · resp_cost_centers ·
--     org_assignments · และใบผ่านข้ามหน่วย **รายคน** — ห้ามมาจากชื่อ role หรือชื่อคีย์
--
-- ⚠️ apply พร้อม deploy โค้ดชุดเดียวกันเท่านั้น (จอเก่าอ่าน `scope:all_units` จาก role_permissions —
--    ลงฐานก่อน deploy = 37 บัญชีเสียใบผ่านทันทีทั้งที่จอยังไม่มีช่องใหม่)
--
-- ทำอะไร (เรียงตามไฟล์):
--   §1 profiles.all_units (ใบผ่านข้ามหน่วย รายคน) + trigger protect_profile_role กันคนตั้งให้ตัวเอง
--   §2 app_all_units() · app_write_units() · app_cc_covers() · app_can_write_unit() · app_can_write_line()
--      = แหล่งเดียวของ "แก้หน่วยไหนได้" ฝั่ง DB (ตรรกะเดียวกับ src/utils/writeScope.js)
--   §3 สำรอง + ถอด `scope:all_units` และ `employees:edit_all_sections` ออกจาก role_permissions/catalog
--      + ตั้ง all_units=true ให้ 12 บัญชีที่ user เคาะ 13/11 + ปลด role `dept_scope` (0 คนถือ)
--   §4 policy: four_m_logs (เลิก ALL=true) · employees UPDATE (+ด่านหน่วย · เลิก edit_all_sections) ·
--      storage emp_signature_* · document_controls (เลิก hardcode role) · skill_definitions (+skills:delete) ·
--      workstations/station_requirements (+line_setup:delete)
--   §5 fn_can_manage_display() ใช้ขอบเขตการแก้ (ไม่ใช่ที่เห็น) · fn_weekly_skill_update ใช้ has_perm
--   §6 คงความกว้างการแก้วันนี้ของ 2 บัญชี mtn ที่พึ่ง `sections` อยู่ → ย้ายเป็น resp_cost_centers (การตั้งค่า ไม่ใช่โค้ด)
--
-- ย้อนกลับ (ลำดับ): revert โค้ดก่อน → รัน §R ท้ายไฟล์ (คืนแถวจาก archive.bk_role_scope_20261113 · policy เดิม)
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ── §1 ใบผ่านข้ามหน่วย รายคน ─────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists all_units boolean not null default false;
comment on column public.profiles.all_units is
  'ใบผ่านข้ามหน่วย (ชั้นสิทธิ์ ③) ตั้งรายคนที่ /add-user — แทนคีย์ scope:all_units ที่เคยแจกราย role (13/11) · admin ไม่ต้องตั้ง';

create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_is_admin boolean;
begin
  if auth.uid() is null then return new; end if;
  v_is_admin := current_user_role() is not distinct from 'admin'::user_role;
  if v_is_admin then return new; end if;
  if new.id is distinct from auth.uid() then raise exception 'Only admin can edit another user profile'; end if;
  if new.role is distinct from old.role then raise exception 'Only admin can change a user role'; end if;
  if new.is_dept_admin is distinct from old.is_dept_admin then raise exception 'Only admin can change dept-admin flag'; end if;
  if new.sections is distinct from old.sections then raise exception 'Only admin can change section scope'; end if;
  if new.section is distinct from old.section then raise exception 'Only admin can change section'; end if;
  if new.line_id is distinct from old.line_id then raise exception 'Only admin can change line scope'; end if;
  if new.team is distinct from old.team then raise exception 'Only admin can change team'; end if;
  if new.mtn_teams is distinct from old.mtn_teams then raise exception 'Only admin can change maintenance teams'; end if;
  if new.employee_id is distinct from old.employee_id then raise exception 'Only admin can link a profile to an employee'; end if;
  if new.scope_depth is distinct from old.scope_depth then raise exception 'Only admin can change scope depth'; end if;
  if new.scope_depth_src is distinct from old.scope_depth_src then raise exception 'Only admin can change scope-depth source'; end if;
  if new.account_kind is distinct from old.account_kind then raise exception 'Only admin can change account kind'; end if;
  if new.org_node_id is distinct from old.org_node_id then raise exception 'Only admin can change org affiliation'; end if;
  if new.resp_cost_centers is distinct from old.resp_cost_centers then raise exception 'Only admin can change responsible cost centers'; end if;
  if new.all_units is distinct from old.all_units then raise exception 'Only admin can change cross-unit pass'; end if;
  return new;
end;
$function$;

-- ── §2 แหล่งเดียว "แก้หน่วยไหนได้" ฝั่ง DB ─────────────────────────────────────────────
-- 🔴 กติกาเดิมยังอยู่: **fail-open ที่ DB · fail-closed ที่จอ** (ตาข่ายชั้นสอง ห้ามเข้มกว่าจอ)
--    ผ่านเสมอเมื่อ: ไม่มี JWT · ไม่รู้หน่วย/ไลน์ของแถว · บัญชีไม่มีบ้านและไม่มี CC · ผังไม่รู้จักชื่อ

/* ใบผ่านข้ามหน่วยของคนที่ล็อกอิน = admin · profiles.all_units · มอบหมาย scope_depth='all' ที่มีผลวันนี้
   (วันมีผล = ตรรกะเดียวกับ isGranting() ใน src/utils/orgAssignments.js · วันทำงานไทย) */
create or replace function public.app_all_units()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'admin'::user_role
        or coalesce(p.all_units, false)
        or exists (
          select 1 from public.org_assignments a
          where a.profile_id = p.id and a.org_node_id is not null and a.scope_depth = 'all'
            and (a.starts_on is null or a.starts_on <= (now() at time zone 'Asia/Bangkok')::date)
            and (a.ends_on   is null or a.ends_on   >= (now() at time zone 'Asia/Bangkok')::date))
    from public.profiles p where p.id = auth.uid()), false);
$$;

/* ส่วนงานของโหนด = section บนสุดของสาย (หยุดที่ชั้นบน company_group/spg/company/plant) — เท่า sectionKeyOf() ใน assignmentOverlay.js */
create or replace function public.app_section_key_of(p_node uuid)
returns text language sql stable security definer set search_path = public as $$
  with recursive up as (
    select n.id, n.parent_id, n.kind, n.code, n.name, 0 as d from public.org_nodes n where n.id = p_node
    union all
    select n.id, n.parent_id, n.kind, n.code, n.name, up.d + 1
    from public.org_nodes n join up on n.id = up.parent_id
    where up.kind <> 'section' and up.d < 20
      and n.kind not in ('company_group','spg','company','plant')
  )
  select coalesce(nullif(trim(code), ''), nullif(trim(name), ''))
  from up order by (kind = 'section') desc, d desc limit 1;
$$;

/* หน่วย (ข้อความ) ที่คนนี้แก้ได้ = บ้าน (profiles.section) ∪ ส่วนงานของหน่วยที่ได้รับมอบหมายที่มีผล — **ไม่ใช่ `sections`** (= ขอบเขตที่เห็น) */
create or replace function public.app_write_units()
returns text[] language sql stable security definer set search_path = public as $$
  select array(
    select distinct u from (
      select nullif(trim(p.section), '') as u from public.profiles p where p.id = auth.uid()
      union all
      select public.app_section_key_of(a.org_node_id)
      from public.org_assignments a
      where a.profile_id = auth.uid() and a.org_node_id is not null and coalesce(a.scope_depth, '') <> 'all'
        and (a.starts_on is null or a.starts_on <= (now() at time zone 'Asia/Bangkok')::date)
        and (a.ends_on   is null or a.ends_on   >= (now() at time zone 'Asia/Bangkok')::date)
    ) s where u is not null);
$$;

/* แกน Cost Center: โหนดเป้าหมายอยู่ใต้ (หรือเป็น) หน่วยที่ถือ CC ไหม · คืน 'yes' / 'no' /
   'unknown' (ไม่มี CC ทั้งสายและไม่มี CC ใต้เป้า = ตัดสินไม่ได้ → ผู้เรียก fail-open)
   · 'yes' รวมเคส "ถือ CC ชั้นแผนกแล้วเป้าคือส่วนงานแม่" (= partial_unit ของ ccScope.js — ห้ามบล็อก) */
create or replace function public.app_cc_covers(p_node uuid, p_ccs text[])
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_anc uuid[];
  v_has_cc boolean;
begin
  if p_node is null or coalesce(array_length(p_ccs, 1), 0) = 0 then return 'unknown'; end if;
  with recursive up as (
    select n.id, n.parent_id, n.cost_center, 0 as d from public.org_nodes n where n.id = p_node
    union all
    select n.id, n.parent_id, n.cost_center, up.d + 1 from public.org_nodes n join up on n.id = up.parent_id where up.d < 20
  )
  select array_agg(id), bool_or(nullif(trim(cost_center), '') is not null) into v_anc, v_has_cc from up;
  -- ถือ CC ของตัวเป้าหรือของแม่ขึ้นไป
  if exists (select 1 from public.org_nodes n where n.id = any(v_anc) and n.cost_center = any(p_ccs)) then return 'yes'; end if;
  -- ถือ CC ของหน่วยที่อยู่ใต้เป้า (ละเอียดกว่า) = partial_unit → ok
  if exists (
    with recursive down as (
      select n.id, 0 as d from public.org_nodes n where n.id = p_node
      union all
      select n.id, down.d + 1 from public.org_nodes n join down on n.parent_id = down.id where down.d < 20
    )
    select 1 from down join public.org_nodes n on n.id = down.id where n.cost_center = any(p_ccs)
  ) then return 'yes'; end if;
  if not coalesce(v_has_cc, false) then return 'unknown'; end if;
  return 'no';
end;
$$;

/* "แก้ข้อมูลของหน่วย p_unit (ชื่อส่วนงาน/แผนก/ไลน์/ทีม เป็นข้อความ) ได้ไหม" */
create or replace function public.app_can_write_unit(p_unit text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_ccs  text[];
  v_node uuid;
  v_cc   text;
  v_units text[];
begin
  if auth.uid() is null then return true; end if;                       -- edge/service = ไม่ตัดสิน
  if public.app_all_units() then return true; end if;
  if coalesce(trim(p_unit), '') = '' then return true; end if;           -- แถวไม่ผูกหน่วย = ตัดสินไม่ได้
  select resp_cost_centers into v_ccs from public.profiles where id = auth.uid();
  if coalesce(array_length(v_ccs, 1), 0) > 0 then
    select n.id into v_node from public.org_nodes n
    where n.is_active and n.kind in ('section','department','line','team')
      and (lower(trim(n.code)) = lower(trim(p_unit)) or lower(trim(n.name)) = lower(trim(p_unit)))
    order by array_position(array['section','department','line','team'], n.kind) limit 1;
    if v_node is not null then
      v_cc := public.app_cc_covers(v_node, v_ccs);
      if v_cc = 'yes' then return true; end if;
      if v_cc = 'no'  then return false; end if;
      return true;                                                       -- unknown = ตัดสินไม่ได้
    end if;
    -- ผังไม่รู้จักชื่อนี้ → ถอยไปแกนข้อความ (เท่า ccDecide() คืน null)
  end if;
  v_units := public.app_write_units();
  if coalesce(array_length(v_units, 1), 0) = 0 then return true; end if; -- ไม่มีบ้าน = ตัดสินไม่ได้ (fail-open ที่ DB)
  return exists (select 1 from unnest(v_units) u where lower(trim(u)) = lower(trim(p_unit)));
end;
$$;

/* รุ่นไลน์ — ตัดสินที่ตัวไลน์ก่อน (CC ของไลน์/แม่) แล้วค่อยถอยไปส่วนงานของไลน์ (เท่า canWriteLine()) */
create or replace function public.app_can_write_line(p_line text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_line public.production_lines%rowtype;
  v_ccs  text[];
  v_node uuid;
  v_cc   text;
begin
  if auth.uid() is null then return true; end if;
  if public.app_all_units() then return true; end if;
  if coalesce(trim(p_line), '') = '' then return true; end if;
  select * into v_line from public.production_lines l where l.name = p_line limit 1;
  if not found then return true; end if;                                 -- ไลน์ไม่อยู่ในทะเบียน = ไม่รู้เจ้าของ
  select resp_cost_centers into v_ccs from public.profiles where id = auth.uid();
  if coalesce(array_length(v_ccs, 1), 0) > 0 then
    select n.id into v_node from public.org_nodes n
    where n.is_active and n.kind in ('line','team') and (n.ref_line_id = v_line.id or lower(trim(n.name)) = lower(trim(p_line)))
    order by (n.ref_line_id = v_line.id) desc limit 1;
    if v_node is not null then
      v_cc := public.app_cc_covers(v_node, v_ccs);
      if v_cc = 'yes' then return true; end if;
      if v_cc = 'no'  then return false; end if;
    end if;
  end if;
  return public.app_can_write_unit(v_line.section);
end;
$$;

revoke all on function public.app_all_units() from public, anon;
revoke all on function public.app_section_key_of(uuid) from public, anon;
revoke all on function public.app_write_units() from public, anon;
revoke all on function public.app_cc_covers(uuid, text[]) from public, anon;
revoke all on function public.app_can_write_unit(text) from public, anon;
grant execute on function public.app_all_units(), public.app_write_units(), public.app_can_write_unit(text), public.app_can_write_line(text) to authenticated;
grant execute on function public.app_section_key_of(uuid), public.app_cc_covers(uuid, text[]) to authenticated;

comment on function public.app_can_write_line(text) is
  'ชั้นสิทธิ์ ③ ฝั่ง DB (ตาข่ายชั้นสอง · fail-open) — ใบผ่านรายคน (app_all_units) → CC ของไลน์/แม่ → ส่วนงานของไลน์ เทียบ app_write_units() · กฎจริง src/utils/writeScope.js (13/11)';
comment on function public.app_can_write_unit(text) is
  'ชั้นสิทธิ์ ③ ฝั่ง DB สำหรับแถวที่ผูก "หน่วย" เป็นข้อความ (section/department/ทีม) · ตรรกะเดียวกับ canWriteUnit() (13/11)';

-- ── §3 ย้ายใบผ่านจาก role → รายคน · ถอดคีย์ที่ชื่อฝังขอบเขต · ปลด dept_scope ───────────────
create schema if not exists archive;
create table if not exists archive.bk_role_scope_20261113 as
  select rp.*, now() as backed_up_at from public.role_permissions rp
  where rp.permission_key in ('scope:all_units', 'employees:edit_all_sections') or rp.role::text = 'dept_scope';
create table if not exists archive.bk_permission_catalog_20261113 as
  select c.*, now() as backed_up_at from public.permission_catalog c
  where (c.resource, c.action) in (('scope','all_units'), ('employees','edit_all_sections'));

-- 12 บัญชีที่ user เคาะ 13/11 ("โอเคตามตาราง ชัยยุทธให้ทั้งโรงงาน"): warehouse_delivery 6 · planner_store 3 · engineer · engineer_nm · ชัยยุทธ (manager)
update public.profiles set all_units = true where id in (
  '8243b184-984d-4f83-864a-70baafcae80d', -- engineer · processengineering
  '5ce4e61e-1288-4c7e-b788-a2dd88c6e2bc', -- engineer_nm
  '334856e6-25e0-4ea6-be47-fac35c3b2184', -- manager · ชัยยุทธ (ไม่มีบ้าน/CC)
  '33001c34-63ac-4732-93f9-2adc43525d6a', -- planner_store · planningstore
  '17bb867b-1b33-40a8-a5ae-1c3b3c0f4bcc', -- planner_store
  '3a757fc2-131c-496e-ad62-92da6bf281fa', -- planner_store
  'ff302a36-04da-4ddb-a133-56ae481c8fce', -- warehouse_delivery · billing
  '32c2968a-c802-4afe-87cb-a4a4150002fa', -- warehouse_delivery · delivery1
  'a286bc81-79de-455f-bcaa-0e6885bd948d', -- warehouse_delivery · delivery2
  '7a197ca9-3a52-4cd7-91e2-22025bf191e7', -- warehouse_delivery · warehouse1
  'c5d5ffac-44c8-4b3b-9feb-232563e0ba09', -- warehouse_delivery · warehouse2
  '315b1c1c-1ae6-483b-8524-445c0de998a4'  -- warehouse_delivery
);

delete from public.role_permissions where permission_key in ('scope:all_units', 'employees:edit_all_sections');
delete from public.permission_catalog where (resource, action) in (('scope','all_units'), ('employees','edit_all_sections'));
delete from public.role_permissions where role::text = 'dept_scope';   -- 0 คนถือ · enum ลบไม่ได้ คงค่าไว้ (ห้ามตั้งให้ user)

-- ── §4 policy ─────────────────────────────────────────────────────────────────────────
-- four_m_logs: เลิก "ใครล็อกอินก็เขียนได้ทั้งตาราง"
drop policy if exists "Allow authenticated full access four_m" on public.four_m_logs;
create policy four_m_select on public.four_m_logs for select to authenticated using (true);
-- สร้างใบ: งานหน้างานหลาย role (เช็คชื่อ/จัดกะ/QA check sheet/ใบ 4M มือ) ⇒ ไม่ผูกคีย์ action · ด่าน = หน่วยของไลน์ (fail-open ตามกติกา DB)
create policy four_m_insert on public.four_m_logs for insert to authenticated
  with check (public.app_can_write_line(line_name));
-- แก้ใบ: อนุมัติขั้น SV ต้องเป็นไลน์ในขอบเขต · QA/เอกสาร/reset เป็นงานทั้งโรงงาน (คีย์ของมันเอง)
create policy four_m_update on public.four_m_logs for update to authenticated
  using (
    ((select public.has_perm('four_m:approve_sv')) and public.app_can_write_line(line_name))
    or (select public.has_perm('four_m:approve_qa'))
    or (select public.has_perm('four_m:manage_docs'))
    or (select public.has_perm('four_m:reset'))
    or (created_by = auth.uid() and status = 'pending')              -- เจ้าของใบแก้ใบตัวเองที่ยังไม่ถูกอนุมัติ
  );
create policy four_m_delete on public.four_m_logs for delete to authenticated
  using ((select public.has_perm('four_m:reset')));                 -- คู่กับ restrictive four_m_logs_delete_guard เดิม

-- employees UPDATE: เลิก edit_all_sections · งานแก้/ปิดพนักงานต้องอยู่ในหน่วยที่แก้ได้ · ทางอื่น (ผังไลน์/ผัง org/storage maintain) คงเดิม
drop policy if exists "Allow authenticated to update employees" on public.employees;
create policy "Allow authenticated to update employees" on public.employees for update to authenticated
  using (
    (((select public.has_perm('employees:edit')) or (select public.has_perm('employees:deactivate'))) and public.app_can_write_unit(section))
    or (select public.has_perm('line_setup:edit'))
    or (select public.has_perm('org:manage_divisions'))
    or (select public.has_perm('org:manage_own_unit'))
    or (select public.has_perm('storage_maintain:run'))
  );
drop policy if exists "Allow authenticated to delete employees" on public.employees;
create policy "Allow authenticated to delete employees" on public.employees for delete to authenticated
  using ((select public.has_perm('employees:deactivate')) and public.app_can_write_unit(section));

drop policy if exists emp_signature_insert on storage.objects;
create policy emp_signature_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = 'emp' and (select public.has_perm('employees:edit')));
drop policy if exists emp_signature_update on storage.objects;
create policy emp_signature_update on storage.objects for update to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = 'emp' and (select public.has_perm('employees:edit')));
drop policy if exists emp_signature_delete on storage.objects;
create policy emp_signature_delete on storage.objects for delete to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = 'emp' and (select public.has_perm('employees:edit')));

-- document_controls: ตารางเก่า (ย้ายไป doc_forms แล้ว 2026-07-30 · เหลือ 1 แถว · ไม่มีจอเขียน) — เลิก hardcode role
drop policy if exists document_controls_write_admin_manager on public.document_controls;
create policy document_controls_write on public.document_controls for all to authenticated
  using ((select public.has_perm('doc_forms:manage'))) with check ((select public.has_perm('doc_forms:manage')));

-- skill_definitions: ถือ skills:delete อย่างเดียวต้องลบนิยามได้ (เดิมลบลูกได้แต่แม่ไม่ได้ = ค้างครึ่งเดียว)
drop policy if exists auth_all on public.skill_definitions;
create policy skill_definitions_write on public.skill_definitions for all to authenticated
  using ((select public.has_perm('skills:edit')) or (select public.has_perm('skills:delete')))
  with check ((select public.has_perm('skills:edit')) or (select public.has_perm('skills:delete')));
-- workstations / station_requirements / line_layouts: ถือ line_setup:delete อย่างเดียวต้องลบของไลน์ได้
drop policy if exists "Allow All on workstations" on public.workstations;
create policy workstations_write on public.workstations for all to authenticated
  using ((select public.has_perm('line_setup:edit')) or (select public.has_perm('line_setup:delete')))
  with check ((select public.has_perm('line_setup:edit')));
drop policy if exists auth_all on public.station_requirements;
create policy station_requirements_write on public.station_requirements for all to authenticated
  using ((select public.has_perm('line_setup:edit')) or (select public.has_perm('line_setup:delete')) or (select public.has_perm('skills:delete')))
  with check ((select public.has_perm('line_setup:edit')) or (select public.has_perm('skills:delete')));
drop policy if exists "Allow All on line_layouts" on public.line_layouts;
create policy line_layouts_write on public.line_layouts for all to authenticated
  using ((select public.has_perm('line_setup:edit')) or (select public.has_perm('line_setup:delete')) or (select public.has_perm('storage_maintain:run')))
  with check ((select public.has_perm('line_setup:edit')) or (select public.has_perm('storage_maintain:run')));

-- ── §5 ฟังก์ชันที่ยังตัดสินด้วย "ที่เห็น" หรือด้วยชื่อ role ───────────────────────────────
create or replace function public.fn_can_manage_display(p_target uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  tg profiles%rowtype;
  my_units text[];
  tg_secs text[];
begin
  if auth.uid() is null then return false; end if;
  select * into tg from profiles where id = p_target;
  if not found or tg.role <> 'display'::user_role then return false; end if;
  if public.app_all_units() then return true; end if;
  -- ขอบเขตที่ "แก้ได้" ไม่ใช่ที่ "เห็น" (13/11): บ้าน + มอบหมาย · ไม่มีเลย = ตั้งจอไม่ได้
  my_units := array(select lower(trim(u)) from unnest(public.app_write_units()) u);
  if cardinality(my_units) = 0 then return false; end if;
  tg_secs := array(select lower(trim(s)) from unnest(coalesce(tg.sections, '{}')) s where nullif(trim(s), '') is not null);
  if cardinality(tg_secs) = 0 and nullif(trim(tg.section), '') is not null then tg_secs := array[lower(trim(tg.section))]; end if;
  if cardinality(tg_secs) = 0 then return false; end if;   -- จอทั้งโรงงาน = เฉพาะผู้ถือใบผ่าน
  return tg_secs <@ my_units;
end $$;

-- fn_weekly_skill_update: caller guard เช็คคีย์ ไม่ใช่ชื่อ role (คีย์ skills:run_weekly_update มีอยู่แล้วในทะเบียน)
-- (เปลี่ยนเฉพาะบล็อก guard ที่หัวฟังก์ชัน — เนื้อเดิมคงไว้ด้วย create or replace จากซอร์สปัจจุบัน ดู §5b ท้ายไฟล์)

-- ── §6 คงความกว้างการแก้วันนี้ของบัญชีที่พึ่ง `sections` (การตั้งค่า ไม่ใช่โค้ด) ─────────────
-- วัด 13/11: บัญชีที่ `sections` กว้างกว่าบ้านและยังไม่มี CC = qa 13 (จอคุณภาพมี qaWriteCtx ครอบอยู่แล้ว ไม่กระทบ) · mtn 2
-- mtn 2 ใบนี้ย้ายส่วนงานที่เคยเขียนได้ไปเป็น CC ของส่วนงานนั้น (Maintenance 2140456000 · Tooling MTN 2140459100)
update public.profiles p set resp_cost_centers = x.ccs
from (
  select p2.id, array(select distinct n.cost_center from unnest(p2.sections) s join public.org_nodes n
                      on n.kind = 'section' and n.is_active and lower(trim(coalesce(n.code, n.name))) = lower(trim(s))
                      where n.cost_center is not null) as ccs
  from public.profiles p2
  where p2.role = 'mtn'::user_role and coalesce(array_length(p2.resp_cost_centers, 1), 0) = 0
    and exists (select 1 from unnest(p2.sections) s where lower(trim(s)) <> lower(trim(coalesce(p2.section, ''))))
) x where x.id = p.id and coalesce(array_length(x.ccs, 1), 0) > 0;

-- ── ตรวจผล ───────────────────────────────────────────────────────────────────────────
-- select full_name, role, all_units from profiles where all_units;                      -- ต้องได้ 12 แถว
-- select count(*) from role_permissions where permission_key in ('scope:all_units','employees:edit_all_sections'); -- 0
-- select polname from pg_policy where polrelid = 'public.four_m_logs'::regclass;          -- four_m_select/insert/update/delete + guard
-- select public.app_can_write_line('<ชื่อไลน์>');                                          -- ทดสอบด้วย JWT ผู้ใช้จริง

-- ── §R ย้อนกลับ ──────────────────────────────────────────────────────────────────────
-- insert into public.role_permissions (role, permission_key, allowed) select role, permission_key, allowed from archive.bk_role_scope_20261113 on conflict (role, permission_key) do update set allowed = excluded.allowed;
-- insert into public.permission_catalog (resource, action, label, group_name, sort) select resource, action, label, group_name, sort from archive.bk_permission_catalog_20261113 on conflict (resource, action) do nothing;
-- update public.profiles set all_units = false;   (คอลัมน์ทิ้งไว้ได้ · โค้ดเก่าไม่อ่าน)
-- policy four_m_logs: drop 4 ตัวใหม่ แล้ว create policy "Allow authenticated full access four_m" on public.four_m_logs for all to authenticated using (true);
-- employees/storage/document_controls/skill_definitions/workstations/station_requirements/line_layouts: ดูนิยามเดิมใน migration ก่อนหน้า (20261012 round5 · round8 · 20261014)

-- ── §5b fn_weekly_skill_update — guard ด้วยคีย์ `skills:run_weekly_update` แทนชื่อ role (เนื้อฟังก์ชันเดิมเป๊ะ) ─────
create or replace function public.fn_weekly_skill_update(p_week_start date default null::date)
returns text language plpgsql security definer set search_path to 'public' as $function$
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
  -- caller guard ฝั่ง server: pg_cron/service (ไม่มี JWT) หรือผู้ถือคีย์ skills:run_weekly_update (13/11 — เดิมเช็คชื่อ role)
  if auth.uid() is not null and not public.has_perm('skills:run_weekly_update') then
    raise exception 'permission denied: weekly skill update requires skills:run_weekly_update';
  end if;

  if p_week_start is not null then
    v_week_start := p_week_start;
  else
    v_bkk_today := (now() at time zone 'Asia/Bangkok')::date;
    v_dow := extract(dow from v_bkk_today)::integer;
    v_week_start := v_bkk_today - (case when v_dow = 0 then 6 else v_dow - 1 end) - 7;
  end if;
  v_week_end := v_week_start + 6;

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
      and exists (select 1 from station_requirements sr2 where sr2.skill_name = sd.name)
  loop
    select score, pending_level into v_score, v_pending
      from employee_skills where employee_id = rec.emp_id and skill_name = rec.skill_name;
    if not found then v_score := 0; v_pending := null; end if;
    continue when v_score >= 100;
    continue when v_pending is not null;

    v_ceiling    := case when v_score < 25 then 24 when v_score < 50 then 49 when v_score < 75 then 74 else 99 end;
    v_next_level := v_ceiling + 1;

    select exists (
      select 1 from daily_production_logs dpl
      join station_requirements sr on sr.station_id::text = dpl.assigned_line::text
      where dpl.employee_id = rec.emp_id
        and dpl.work_date between v_week_start and v_week_end
        and dpl.is_present = true and dpl.assigned_line is not null
        and sr.skill_name = rec.skill_name
      group by dpl.assigned_line having count(distinct dpl.work_date) >= 3
    ) into v_worked;

    if v_worked then
      v_new_score := least(v_score + 2, v_ceiling);
      if v_new_score = v_ceiling then
        select exists (select 1 from skill_level_up_requests
                       where employee_id = rec.emp_id and skill_name = rec.skill_name and status = 'pending') into v_has_req;
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
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  v_result := format('Week %s – %s: updated %s, requests %s', v_week_start, v_week_end, v_updated, v_requests);
  update skill_update_runs set result = v_result where run_kind = 'weekly' and period_start = v_week_start;
  return v_result;
end;
$function$;
