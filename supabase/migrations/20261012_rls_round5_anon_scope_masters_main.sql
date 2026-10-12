-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn) — QC audit รอบ 5 (2026-10-12)
-- ต่อจาก 20261006_rls_tighten_open_write_main.sql + 20261008_rls_tighten_pe_lpa_notify_main.sql
--
-- 🔴 สิ่งที่วัดได้จริงก่อนลงมือ (ไม่ใช่รายการค้างเดิมที่เขียนว่า "12 ตาราง"):
--    policy ที่มี `using(true)`/`with check(true)` ใน schema public ของ MAIN = **231 policy**
--    แยกเป็น 3 ชั้นที่ความเสี่ยงไม่เท่ากัน — ห้ามเหมารวม:
--      ก. **PUBLIC (รวม `anon`)** 5 policy / 5 ตาราง ← รอบนี้ปิด
--      ข. **เขียนได้ทุกคนที่ล็อกอิน** 71 policy / 42 ตาราง ← รอบนี้เก็บ 3 ตาราง (ที่เหลือเป็นงานต่อ)
--      ค. **อ่านได้ทุกคนที่ล็อกอิน (SELECT)** 115 policy / 115 ตาราง
--         → ตั้งใจเป็นแบบนี้สำหรับระบบภายในโรงงาน **ห้ามรัดเหมา** (จอทั้งระบบพึ่งการอ่าน master)
--
-- ── A. ชั้น ก. — ปิด `anon` ออกจาก 5 ตาราง KPI ────────────────────────────
-- วัดจริงก่อนแก้ (`set local role anon` แล้ว count): anon อ่านได้
--   kpi_standard_items **318 แถว** · kpi_month_notes **74** · kpi_board_layouts **3**
--   (kpi_month_plans / kpi_base_inputs = 0 เพราะตารางว่าง policy ก็ยังเปิด)
-- ทั้ง 5 ตารางถูกอ่าน/เขียนด้วย client `supabase` (Main · authenticated) **ที่เดียว**
--   (KpiStandardModal · KpiMonthly · ObeyaKpiBoard · KpiMonthNoteModal · costCenterRefs)
--   ไม่มี edge function และไม่มี `supabaseDR` แตะ ⇒ **รัดเป็น authenticated = พฤติกรรมแอปเท่าเดิมเป๊ะ**
-- 🔴 ต้องรัด policy `_write` ด้วย ไม่ใช่แค่ `_read` — `_write` เป็น `for all` ⇒ `using` ของมัน
--    ถูกใช้กับ SELECT ด้วย ถ้าปล่อยเป็น PUBLIC อยู่ anon จะไปโดน `has_perm()` ที่ตัวเองไม่มีสิทธิ์เรียก
--    แล้วได้ **error 42501 แทน "0 แถว"** (ข้อมูลไม่รั่ว แต่จอ/log สกปรกและสืบยาก)
alter policy kpi_standard_items_read  on public.kpi_standard_items  to authenticated;
alter policy kpi_standard_items_write on public.kpi_standard_items  to authenticated;
alter policy kpi_month_notes_read     on public.kpi_month_notes     to authenticated;
alter policy kpi_month_notes_write    on public.kpi_month_notes     to authenticated;
alter policy kpi_board_layouts_read   on public.kpi_board_layouts   to authenticated;
alter policy kpi_board_layouts_write  on public.kpi_board_layouts   to authenticated;
alter policy kpi_month_plans_read     on public.kpi_month_plans     to authenticated;
alter policy kpi_month_plans_write    on public.kpi_month_plans     to authenticated;
alter policy kpi_base_inputs_read     on public.kpi_base_inputs     to authenticated;
alter policy kpi_base_inputs_write    on public.kpi_base_inputs     to authenticated;

-- ── B. `protect_profile_role()` — เติมคอลัมน์ขอบเขตที่เพิ่มมาหลังเขียน trigger ──
-- 🔴 `scope_depth` เป็น **ตัวตัดสินขอบเขตตัวจริง** ตั้งแต่ 25/09 (`effectiveSections()`)
--    แต่ trigger ที่ตั้งใจกัน "แก้ขอบเขตตัวเอง" ไม่มีคอลัมน์นี้ ⇒ ตั้งเป็น 'all' เองได้
--    (policy UPDATE ของ profiles เป็น `using(true) with check(true)` — ด่านจริงคือ trigger ตัวนี้)
-- ทั้ง 4 คอลัมน์เขียนจาก `/add-user` (จอ admin) ที่เดียว · self-service มีแค่ลายเซ็น/รูป
--    ผ่าน RPC `set_my_signature`/`set_my_avatar` ⇒ **ไม่มี flow ไหนพัง**
-- ⚠️ ขอบเขตของผลที่ได้: ทุกวันนี้ชั้น ค. ยังอ่านเปิด ⇒ การรัดนี้คือ **defense-in-depth**
--    (กันยกระดับ "ขอบเขตบนจอ") ไม่ใช่การอุดรูอ่านข้อมูล — รูอ่านต้องแก้ที่ชั้น ค. ซึ่งยังไม่ทำ
create or replace function public.protect_profile_role()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_is_admin boolean;
begin
  -- ไม่มี JWT = service role / pg_cron / migration (edge function create-user, delete-user)
  if auth.uid() is null then
    return new;
  end if;

  v_is_admin := current_user_role() is not distinct from 'admin'::user_role;
  if v_is_admin then
    return new;
  end if;

  -- ① แก้โปรไฟล์ของ "คนอื่น" = admin เท่านั้น
  if new.id is distinct from auth.uid() then
    raise exception 'Only admin can edit another user profile';
  end if;

  -- ② คอลัมน์ที่ให้สิทธิ์/ขอบเขต — เจ้าของแถวก็แก้เองไม่ได้
  if new.role is distinct from old.role then
    raise exception 'Only admin can change a user role';
  end if;
  if new.is_dept_admin is distinct from old.is_dept_admin then
    raise exception 'Only admin can change dept-admin flag';
  end if;
  if new.sections is distinct from old.sections then
    raise exception 'Only admin can change section scope';
  end if;
  if new.section is distinct from old.section then
    raise exception 'Only admin can change section';
  end if;
  if new.line_id is distinct from old.line_id then
    raise exception 'Only admin can change line scope';
  end if;
  if new.team is distinct from old.team then
    raise exception 'Only admin can change team';
  end if;
  if new.mtn_teams is distinct from old.mtn_teams then
    raise exception 'Only admin can change maintenance teams';
  end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception 'Only admin can link a profile to an employee';
  end if;

  -- ③ เพิ่ม 2026-10-12 (QC audit รอบ 5) — คอลัมน์ที่เพิ่มทีหลังแล้วไม่มีใครเติมเข้ารายการ
  if new.scope_depth is distinct from old.scope_depth then
    raise exception 'Only admin can change scope depth';
  end if;
  if new.scope_depth_src is distinct from old.scope_depth_src then
    raise exception 'Only admin can change scope-depth source';
  end if;
  if new.account_kind is distinct from old.account_kind then
    raise exception 'Only admin can change account kind';
  end if;
  if new.org_node_id is distinct from old.org_node_id then
    raise exception 'Only admin can change org affiliation';
  end if;

  return new;
end;
$function$;

-- ── C. ชั้น ข. — รัดทะเบียนหลัก 3 ตาราง ──────────────────────────────────
-- 🔴 กฎที่ยึด (เหมือนรอบ 06/10 · 08/10): **predicate ห้ามแคบกว่าคีย์ที่เปิดปุ่มบนจอ**
--    แคบกว่า = "กดแล้วปุ่มเขียวแต่ไม่บันทึก" (RLS ปฏิเสธ UPDATE/DELETE = 0 แถว ไม่มี error)
--    ไล่จากโค้ดจริง — แต่ละตารางมี **จอเจ้าของจอเดียว** (grep ทั้ง src/ + supabase/functions/):
--      production_lines  → LineSetup.jsx       canEdit=`line_setup:edit`
--                                             canDel=canDelete('line_setup','edit')
--                                             ⇒ `line_setup:delete` ถูก seed แล้ว จึงใช้ OR ทั้งสองคีย์
--                                               (OR = ไม่แคบกว่าปุ่มแน่นอน)
--      company_calendar  → CompanyCalendar.jsx canEdit=`company_calendar:edit`
--                                             ⚠️ หน้านี้ใช้ **upsert** ⇒ ต้องมีทั้ง INSERT และ UPDATE
--      skill_definitions → operator.jsx        canEditSkills=`skills:edit`
--    ใครถือคีย์ (วัดจาก role_permissions จริง 12/10):
--      line_setup:edit / :delete = admin · dept_admin · manager · supervisor
--      company_calendar:edit     = admin · dept_admin · document_control
--      skills:edit               = admin · dept_admin · leader · manager · mtn ·
--                                  planner_store · sale · supervisor · warehouse_delivery
alter policy production_lines_insert on public.production_lines
  with check ((select public.has_perm('line_setup:edit')));
alter policy production_lines_update on public.production_lines
  using ((select public.has_perm('line_setup:edit')));
alter policy production_lines_delete on public.production_lines
  using ((select public.has_perm('line_setup:delete')) or (select public.has_perm('line_setup:edit')));

alter policy company_calendar_insert on public.company_calendar
  with check ((select public.has_perm('company_calendar:edit')));
alter policy company_calendar_update on public.company_calendar
  using ((select public.has_perm('company_calendar:edit')));
alter policy company_calendar_delete on public.company_calendar
  using ((select public.has_perm('company_calendar:edit')));

-- ⚠️⚠️ ลำดับสำคัญ — `skill_definitions` มี **policy เดียว** (`auth_all` = for all)
--    รัด `using` ของมันเลยโดยไม่เพิ่ม policy อ่านก่อน = **ปิดการอ่านไปด้วย หน้าสกิลดับทั้งหน้า**
--    (กับดักเดียวกับ `lpa_*` ที่บันทึกไว้รอบ 08/10) ⇒ ขั้น C1 ต้องมาก่อน C2 เสมอ
do $$
begin
  if not exists (select 1 from pg_policy
                  where polrelid = 'public.skill_definitions'::regclass
                    and polname = 'skill_definitions_read') then
    create policy skill_definitions_read on public.skill_definitions
      for select to authenticated using (true);
  end if;
end $$;
alter policy auth_all on public.skill_definitions
  using      ((select public.has_perm('skills:edit')))
  with check ((select public.has_perm('skills:edit')));

-- ════════════════════════════════════════════════════════════════════════════
-- ตรวจกลับหลังรัน (ผลที่วัดได้จริง 12/10 — ทดสอบด้วย set_config('request.jwt.claims') แล้ว rollback)
--   ① anon ต้องได้ 0 แถว **และไม่ error**:
--      set local role anon;
--      select count(*) from public.kpi_standard_items;        -- 0 (ก่อนแก้ = 318)
--   ② authenticated ต้องได้เท่าเดิม:
--      set local role authenticated;
--      select count(*) from public.kpi_standard_items;        -- 318
--   ③ non-admin ปลดขอบเขตตัวเองต้องถูกบล็อก แต่แก้ชื่อตัวเองยังได้:
--      → วัดแล้ว: 'Only admin can change scope depth' · แก้ full_name ผ่าน
--   ④ คนไม่ถือคีย์ (qa) อ่านได้ เขียนได้ 0 แถว · คนถือคีย์ (supervisor) เขียนได้ 1 แถว:
--      → วัดแล้ว: qa อ่านไลน์ 36 · สกิล 70 · ปฏิทิน 278 แถว · เขียน 0 ทุกตาราง
--                 supervisor update production_lines = 1 แถว
--
-- ROLLBACK (คืนสภาพเดิมทุกข้อ ไม่เสียข้อมูล)
-- ────────────────────────────────────────────────────────────────────────────
--   -- A: คืน PUBLIC (ใช้เฉพาะเมื่อพบว่ามี client anon ที่ต้องอ่านจริง — ยืนยันก่อน)
--   alter policy kpi_standard_items_read  on public.kpi_standard_items  to public;
--   alter policy kpi_standard_items_write on public.kpi_standard_items  to public;
--   -- (ทำซ้ำกับอีก 4 ตาราง)
--
--   -- B: ถอด 4 เงื่อนไขในข้อ ③ ออกจาก protect_profile_role() แล้ว create or replace กลับ
--
--   -- C: คืน write แบบเปิด
--   alter policy production_lines_insert on public.production_lines with check (true);
--   alter policy production_lines_update on public.production_lines using (true);
--   alter policy production_lines_delete on public.production_lines using (true);
--   alter policy company_calendar_insert on public.company_calendar with check (true);
--   alter policy company_calendar_update on public.company_calendar using (true);
--   alter policy company_calendar_delete on public.company_calendar using (true);
--   alter policy auth_all on public.skill_definitions using (true) with check (true);
--   drop policy if exists skill_definitions_read on public.skill_definitions;
-- ════════════════════════════════════════════════════════════════════════════
