-- 20260904_rls_match_ui_permissions.sql  ·  ⚠️ Main project (ewhdfqwfwofivojtsizn)
-- full QC audit รอบ 10 — RLS ที่ hardcode role array "แคบกว่า" สิทธิ์ที่ปุ่มบนจอใช้ (role_permissions)
-- ⇒ UPDATE/DELETE ที่ RLS ปฏิเสธ = "สำเร็จ 0 แถว ไม่มี error" → จอขึ้นเหมือนบันทึกแล้วทั้งที่ไม่มีอะไรเปลี่ยน
-- วัดกับฐานจริง 2026-09-04 ด้วยการสวมบท authenticated (ไม่ใช่ service role):
--   · operator_special_tasks ไม่มี UPDATE policy เลย (มีแค่ insert/select/delete)
--       → upsert ที่ชนแถวเดิม (เปลี่ยนงานนอกไลน์ให้คนที่มีงานวันนี้แล้ว) โดน 42501 ทุก role รวม supervisor
--         และ Management ไม่เช็ค error → modal ปิด จอโชว์งานเดิม (161 แถว/30 วัน = ฟีเจอร์ที่ใช้ทุกวัน)
--   · machine_points / machine_flow_links / wip_buffer_points เขียนได้เฉพาะ admin/manager/supervisor (hardcode)
--       แต่ปุ่มใน LineSetup ใช้ line_setup:edit ซึ่งมี bucket dept_admin (mtn 5 + planner_store 1 บัญชี)
--       → has_perm('line_setup:edit')=true แต่ update rows=0 · delete rows=0
--   · skill_sub_items เขียนได้ admin/mgr/sv/leader (hardcode) แต่ skills:edit มี sale/mtn/planner_store (15 บัญชี) + dept_admin
--       → เรียงลำดับหัวข้อ (update) rows=0 เงียบ · เพิ่ม/ลบ ขึ้น error RLS ที่คนหน้างานอ่านไม่รู้เรื่อง
--   · shift_merge_events เขียนได้ admin/mgr/sv (hardcode) แต่ shift_schedule:edit มี document_control (+dept_admin)
--       → ลบเหตุการณ์ยุบกะ rows=0 เงียบ
-- กฎ (PERMISSIONS-DESIGN): policy ต้อง data-driven ผ่าน has_perm() ด้วย "คีย์เดียวกับปุ่มบนจอ"
--   ห้าม hardcode role array — คลาสเดียวกับ cost_center_rates (20260903) และ wip_point_add_qty (20260903)
-- backward-compatible: role เดิม (admin/mgr/sv/leader) ยังมีคีย์เหล่านี้ครบ → ทำได้เหมือนเดิม · เพิ่มเฉพาะที่ UI เปิดไว้อยู่แล้ว
-- rollback: สร้าง policy เดิมกลับ (ดู 20260707_enable_rls_shift_merge_skill_levelup.sql · 20260716_skill_assessment_subitems.sql)
begin;

-- 1) งานนอกไลน์ — เติม UPDATE ให้ครบชุด (insert/delete เปิดให้ authenticated อยู่แล้ว · upsert ต้องมี UPDATE ถึงจะเปลี่ยนงานได้)
drop policy if exists "authenticated update special tasks" on public.operator_special_tasks;
create policy "authenticated update special tasks" on public.operator_special_tasks
  for update to authenticated using (true) with check (true);

-- 2) ผังไลน์ (LineSetup) — คีย์ line_setup:edit / line_setup:delete
drop policy if exists machine_points_write_setup on public.machine_points;
create policy machine_points_write_setup on public.machine_points
  for all to authenticated
  using (has_perm('line_setup:edit') or has_perm('line_setup:delete'))
  with check (has_perm('line_setup:edit'));

drop policy if exists machine_flow_links_write_setup on public.machine_flow_links;
create policy machine_flow_links_write_setup on public.machine_flow_links
  for all to authenticated
  using (has_perm('line_setup:edit') or has_perm('line_setup:delete'))
  with check (has_perm('line_setup:edit'));

-- wip_buffer_points: master จุด WIP แก้ที่ LineSetup (คีย์เดียวกัน) · การ "บวกยอด" ของสโตร์ยังผ่าน RPC wip_point_add_qty เท่านั้น
drop policy if exists wip_buffer_points_write_setup on public.wip_buffer_points;
create policy wip_buffer_points_write_setup on public.wip_buffer_points
  for all to authenticated
  using (has_perm('line_setup:edit') or has_perm('line_setup:delete'))
  with check (has_perm('line_setup:edit'));

-- 3) หัวข้อพิจารณาย่อยของสกิล — คีย์ skills:edit (ปุ่ม 📝 ใน operator ⚙️)
drop policy if exists skill_sub_items_write_privileged on public.skill_sub_items;
drop policy if exists skill_sub_items_write on public.skill_sub_items;
create policy skill_sub_items_write on public.skill_sub_items
  for all to authenticated
  using (has_perm('skills:edit') or has_perm('skills:delete'))
  with check (has_perm('skills:edit'));

-- 4) เหตุการณ์ยุบกะ — คีย์ shift_schedule:edit (ปุ่มลบใช้ canDelete → shift_schedule:delete ถ้า seed ไว้ ไม่งั้น edit)
drop policy if exists shift_merge_events_write_admin_manager_supervisor on public.shift_merge_events;
drop policy if exists shift_merge_events_write on public.shift_merge_events;
create policy shift_merge_events_write on public.shift_merge_events
  for all to authenticated
  using (has_perm('shift_schedule:edit') or has_perm('shift_schedule:delete'))
  with check (has_perm('shift_schedule:edit'));

commit;

-- เช็คผลหลังรัน (ควรเห็น policy ใหม่ครบ 6 ตาราง และไม่มี 'ARRAY[' ใน qual ของตารางเหล่านี้):
-- select tablename, policyname, cmd, qual from pg_policies where schemaname='public'
--   and tablename in ('operator_special_tasks','machine_points','machine_flow_links','wip_buffer_points','skill_sub_items','shift_merge_events')
--   order by 1,2;
