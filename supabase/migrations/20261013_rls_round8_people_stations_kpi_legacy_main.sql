-- RLS รอบ 8 — ทะเบียนคน + จุดงาน + KPI รุ่นเก่า (Main project · ewhdfqwfwofivojtsizn)
-- ⚠️ APPLY แล้วผ่าน MCP 2026-10-13 (ทีละ statement · 13 คำสั่ง) — ไฟล์นี้เก็บประวัติ ไม่ต้องรันซ้ำ
--
-- 🔴 บทเรียนของรอบนี้ (ซ้ำรอบ 5) — **รายการค้างชี้ผิดตัว**
--   รายการเดิมเขียนว่า "kpi_actuals/kpi_targets/kpi_raw_inputs/kpi_section_detail = เลข KPI"
--   วัดจริง: 4 ตัวนั้น **ไม่มีโค้ดอ้างถึงเลย** เขียนครั้งสุดท้าย 2026-05-25 (เลิกใช้แล้ว)
--   เลข KPI วันนี้อยู่ที่ kpi_definitions · kpi_catalog · kpi_manual_entries · kpi_month_plans ·
--   kpi_base_inputs · kpi_month_notes · kpi_board_layouts · kpi_standard_items
--   ⇒ **ทั้ง 8 ตัวถูกรัดด้วย has_perm('kpi:manage') ไว้แล้วก่อนรอบนี้** ไม่มีงานต้องทำ
--   (`kpi_monthly` = คีย์ทะเบียนเอกสาร · `kpi_mtn_rollup` = RPC ฝั่ง DR — ไม่ใช่ตาราง Main ทั้งคู่)
--
-- ⚠️ กับดักที่เจอตอนตรวจ: **คิวรีสรุปผู้ถือคีย์ต้องกรอง `allowed`**
--   `role_permissions` เก็บแถวที่ `allowed=false` ไว้ด้วย ⇒ นับแถวเปล่าๆ จะรายงานผู้ถือเกินจริง
--   (เช่น skills:delete ดูเหมือน 9 role แต่จริง 3) · ด่านจริงคือเทส ไม่ใช่คิวรีสรุป

-- ════════════════════════════════════════════════════════════════════════════
-- 1) employees — ทะเบียนตัวตนคน (314 แถว · เขียนสดทุกวัน)
--    เดิม INSERT/UPDATE/DELETE = using(true) ⇒ ใครล็อกอินก็ลบพนักงานได้
--    ผู้เขียนจริง (grep ทั้งรีโป): AddUser.jsx:238 · Register.jsx:112 · operator.jsx:593,540,551 ·
--      LineSetup.jsx:445 (ปลดคนออกจากไลน์ที่ลบ) · orgNodeRefs.js:186 (เปลี่ยนชื่อโหนดผัง) ·
--      recompressLayouts.js:253 (บีบรูป) · **ไม่มีจุดไหนลบ (delete) เลย**
alter policy "Allow supervisors to insert employees" on public.employees
  with check (
    (select public.has_perm('employees:register'))      -- Register.jsx
    or (select public.has_perm('page:/add-user'))       -- AddUser.jsx (กันด้วยสิทธิ์เข้าหน้า)
  );

-- 🔴 OR 7 คีย์ = union ของทุกปุ่มที่แก้ตารางนี้ · **ห้ามแคบกว่าปุ่ม**
--    ดูกว้าง แต่ของจริงแคบลงมาก เพราะ has_perm เช็ค `allowed` เหมือน can() บนจอเป๊ะ
--    ⇒ ของที่ได้จริง = **เพิกถอนสิทธิ์ที่ /permissions แล้วมีผลถึง DB** (เดิมเพิกถอนไปก็เขียนได้อยู่ดี)
alter policy "Allow authenticated to update employees" on public.employees
  using (
    (select public.has_perm('employees:edit'))
    or (select public.has_perm('employees:deactivate'))
    or (select public.has_perm('employees:edit_all_sections'))
    or (select public.has_perm('line_setup:edit'))
    or (select public.has_perm('org:manage_divisions'))
    or (select public.has_perm('org:manage_own_unit'))
    or (select public.has_perm('storage_maintain:run'))
  );

-- DELETE: ไม่มีจอไหนลบพนักงาน — ของจริงคือ soft-delete `is_active=false` (operator.jsx:540)
--   ⇒ รัดด้วยคีย์ของปุ่มที่ "เอาคนออก" จริง ไม่คิดคีย์ใหม่ที่ไม่มีปุ่มรองรับ
alter policy "Allow authenticated to delete employees" on public.employees
  using ((select public.has_perm('employees:deactivate')));

-- ════════════════════════════════════════════════════════════════════════════
-- 2) workstations · station_requirements · employee_home_positions
--    🔴 ทั้ง 3 ตัวมีแต่ policy `FOR ALL` ตัวเดียว ไม่มี policy อ่านแยก
--       `FOR ALL` ครอบ SELECT ด้วย ⇒ **ต้อง create policy อ่านก่อน แล้วค่อยรัด** (ลำดับนี้สลับไม่ได้
--       — สลับเมื่อไหร่จอทุกหน้าที่อ่านตารางพวกนี้มืดทันที · บทเรียนเดียวกับ shift_schedules รอบ 7)
create policy workstations_read            on public.workstations            for select to authenticated using (true);
create policy station_requirements_read    on public.station_requirements    for select to authenticated using (true);
create policy employee_home_positions_read on public.employee_home_positions for select to authenticated using (true);

alter policy "Allow All on workstations" on public.workstations
  using ((select public.has_perm('line_setup:edit')))
  with check ((select public.has_perm('line_setup:edit')));

-- OR 2 คีย์: LineSetup.jsx (line_setup:edit) + operator.jsx:748 ลบสกิลแล้วล้างแถวอ้างอิง (skills:delete)
alter policy auth_all on public.station_requirements
  using ((select public.has_perm('line_setup:edit')) or (select public.has_perm('skills:delete')))
  with check ((select public.has_perm('line_setup:edit')) or (select public.has_perm('skills:delete')));

alter policy auth_all on public.employee_home_positions
  using ((select public.has_perm('management:assign_manpower')))
  with check ((select public.has_perm('management:assign_manpower')));

-- ════════════════════════════════════════════════════════════════════════════
-- 3) KPI รุ่นเก่า 4 ตาราง — ยังมีข้อมูล (42 / 313 / 11 / 0 แถว) แต่ไม่มีใครอ่าน-เขียน
--    ไม่ใช่ "ตารางตาย" แบบ attendances (ว่างเปล่า) ⇒ ไม่ปล่อยเปิดเขียนไว้เฉยๆ
--    รัดด้วยคีย์ของโดเมนตัวเอง (เท่ากับ 8 ตาราง KPI ที่ใช้งานจริง) — เขียนไม่มีใครทำอยู่แล้ว ⇒ ไม่กระทบใคร
create policy kpi_raw_inputs_read     on public.kpi_raw_inputs     for select to authenticated using (true);
create policy kpi_section_detail_read on public.kpi_section_detail for select to authenticated using (true);

alter policy "auth write kpi_actuals" on public.kpi_actuals
  using ((select public.has_perm('kpi:manage'))) with check ((select public.has_perm('kpi:manage')));
alter policy "auth write kpi_targets" on public.kpi_targets
  using ((select public.has_perm('kpi:manage'))) with check ((select public.has_perm('kpi:manage')));
alter policy auth_rw on public.kpi_raw_inputs
  using ((select public.has_perm('kpi:manage'))) with check ((select public.has_perm('kpi:manage')));
alter policy authenticated_full_access_kpi_section_detail on public.kpi_section_detail
  using ((select public.has_perm('kpi:manage'))) with check ((select public.has_perm('kpi:manage')));

-- 📌 ข้อเสนอให้ user ตัดสิน: 4 ตารางนี้ควร **ย้ายเข้า schema `archive`** (ตามกฎ /schema)
--    หรือ drop ทิ้ง · ยังไม่ทำเพราะเป็นการตัดสินใจเรื่องข้อมูล ไม่ใช่เรื่องสิทธิ์

-- ════════════════════════════════════════════════════════════════════════════
-- ผลตรวจจริง (simulated JWT + set local role authenticated · rollback ด้วย raise exception)
--   [engineer] ไม่ถือคีย์ไหนเลย  → อ่าน emp 314 / จุดงาน 132 / ทักษะจุดงาน 539 แถว
--                                  เขียน 0 ทุกตาราง (emp · จุดงาน · ทักษะ · ตำแหน่งประจำ)   ✓
--   [mtn]      ถือ employees:edit → แก้ emp 1 · จุดงาน 0 · ทักษะ 0 · ตำแหน่งประจำ 0           ✓
--   [manager]  ถือครบ             → จุดงาน 1 · ทักษะ 1 · ตำแหน่งประจำ 1 · kpi เก่า 1           ✓
--   [supervisor] ไม่ถือ skills:delete แต่ถือ line_setup:edit → ทักษะจุดงาน 1 (OR ทำงานถูก)     ✓
--   ไม่มีแถวทดสอบค้าง
--
-- ผู้ถือคีย์จริง ณ วัน apply (กรอง allowed=true แล้ว · admin ผ่านทุกคีย์โดย has_perm):
--   employees:register       dept_admin, leader, manager, mtn, planner_store, sale, supervisor, warehouse_delivery
--   employees:edit           + sale, warehouse_delivery (ชุดเดียวกัน)
--   employees:deactivate     dept_admin, leader, manager, mtn, planner_store, supervisor
--   line_setup:edit          dept_admin, manager, supervisor
--   management:assign_manpower dept_admin, manager, supervisor
--   skills:delete            dept_admin, manager
--   page:/add-user           (admin เท่านั้น)
--   kpi:manage               dept_admin, manager, supervisor
--   ⚠️ `sale` / `warehouse_delivery` ถือ employees:register + employees:edit — ดูไม่สมเหตุผล
--      **ไม่แก้ให้** (เป็นการตัดสินใจเชิงนโยบายที่ /permissions) แต่ตอนนี้ DB บังคับตามแล้ว
--      ⇒ ถอนที่ /permissions เมื่อไหร่ มีผลจริงทันที
--
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (คืนพฤติกรรมเดิม = เปิดให้ authenticated ทุกคนเขียน)
--   alter policy "Allow supervisors to insert employees"  on public.employees with check (true);
--   alter policy "Allow authenticated to update employees" on public.employees using (true);
--   alter policy "Allow authenticated to delete employees" on public.employees using (true);
--   alter policy "Allow All on workstations" on public.workstations using (true) with check (true);
--   alter policy auth_all on public.station_requirements    using (true) with check (true);
--   alter policy auth_all on public.employee_home_positions using (true) with check (true);
--   alter policy "auth write kpi_actuals" on public.kpi_actuals using (true) with check (true);
--   alter policy "auth write kpi_targets" on public.kpi_targets using (true) with check (true);
--   alter policy auth_rw on public.kpi_raw_inputs using (true) with check (true);
--   alter policy authenticated_full_access_kpi_section_detail on public.kpi_section_detail
--     using (true) with check (true);
--   -- 🔴 คืนค่า `using(true)` ให้ครบ **ก่อน** แล้วค่อย drop policy อ่าน (drop ก่อน = ช่วงนั้นอ่านไม่ได้)
--   drop policy workstations_read on public.workstations;
--   drop policy station_requirements_read on public.station_requirements;
--   drop policy employee_home_positions_read on public.employee_home_positions;
--   drop policy kpi_raw_inputs_read on public.kpi_raw_inputs;
--   drop policy kpi_section_detail_read on public.kpi_section_detail;
-- ════════════════════════════════════════════════════════════════════════════
