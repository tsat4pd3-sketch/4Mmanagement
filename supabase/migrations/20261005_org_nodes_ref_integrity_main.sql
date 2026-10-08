-- ─────────────────────────────────────────────────────────────────────────────
-- 🧭 ความสัมพันธ์ของผังองค์กร — ลบโหนดต้องไม่ทำข้อมูลคนหายเงียบ   (Main project)
-- 2026-10-05 · คำสั่ง user "เช็ค relate table ที แก้ไห้ถูก"
-- Project: MAIN (ชื่อในจอ Supabase = "MAIN") · id ewhdfqwfwofivojtsizn
--
-- ── relate table ของ public.org_nodes (วัดจริง 05/10) ───────────────────────
--   org_nodes.parent_id         → ลูกในผัง   17 แผนก · 28 กลุ่ม · 12 ทีม   **เดิม CASCADE**
--   employees.org_node_id       → แกนสังกัดของพนักงาน   308 แถว            **เดิม SET NULL**
--   profiles.org_node_id        → สังกัดของบัญชี          72 แถว            **เดิม SET NULL**
--   org_assignments.org_node_id → การแต่งตั้งหัวหน้าหน่วย   4 แถว   CASCADE (คงไว้ — เป็นลูกแท้ๆ
--                                 ของโหนด ไม่มีความหมายถ้าโหนดหาย · จอเตือนจำนวนก่อนลบ)
--
-- ── ปัญหาที่แก้ ─────────────────────────────────────────────────────────────
--   1. `parent_id` CASCADE = ลบ "ส่วนงาน" 1 คลิก → แผนก/กลุ่ม/ทีมใต้มันหายทั้งสาขา
--      แล้ว SET NULL ไล่ตามทำให้พนักงาน 308 คน + บัญชี 72 ตัว **ไม่มีสังกัด แบบไม่มีใครรู้**
--      ของเดิมมีด่านแค่ JS ในหน้า /org-setup — หลุดทางอื่น (SQL Editor / โค้ดใหม่) = พังหมด
--   2. `org_node_id` SET NULL = ลบโหนดที่ "ไม่มีลูก" แต่มีคนสังกัด (DIE MTN 9 · MTN 9 ·
--      ทั่วไป 8 · JIG MTN 7) แล้วคนหลุดสังกัดเงียบ — คอมเมนต์ migration 20260923_org_node_link
--      เขียนเองว่าคอลัมน์นี้คือ "แกนสังกัดแกนเดียวของระบบ" ⇒ หายเงียบไม่ได้
--   3. RLS เขียนของ org_nodes เป็น `using (true)` ทั้ง insert/update/delete
--      = บัญชีที่ login แล้ว**ทุกคน**ยิง API ลบผังองค์กรทิ้งได้ ถึงปุ่มบนจอจะซ่อนไว้
--      (db-write-rules ข้อ 3: policy ต้อง has_perm ด้วยคีย์เดียวกับปุ่มบนจอ)
--      ปุ่มบนจอใช้ 2 คีย์: org:manage (admin — ทั้งผัง) · org:manage_own_unit (หัวหน้า — ใต้ส่วนตัวเอง)
--      ขอบเขต "ใต้ส่วนงานตัวเอง" ยังคุมที่จอ (canEditNode/canAddDeptHere/canAddLineHere/canAddTeamHere)
--      — ชั้น SQL กันคนที่ "ไม่มีสิทธิ์แตะผังเลย" ออกไปก่อน
--
-- ── ย้อนได้ / ไม่กระทบของเดิม ───────────────────────────────────────────────
--   เปลี่ยนแค่พฤติกรรม "ตอนลบโหนด" — insert/update/select เหมือนเดิมเป๊ะ
--   ไม่มีแถวไหนถูกแก้ · ไม่มีคอลัมน์เพิ่ม/ลด · หน้าเดิมทุกหน้าอ่านเหมือนเดิม
--   /org-setup เช็ค relate table ก่อนลบอยู่แล้ว (src/utils/orgNodeRefs.js) ⇒ คนใช้ไม่เจอ error 23503
--   โค้ดทำงานได้ทั้งก่อนและหลัง apply (ด่าน JS ทำงานเหมือนกัน · DB เป็นแค่ชั้นสอง)
--
-- ROLLBACK (คืนพฤติกรรมเดิมทั้งหมด):
--   alter table public.org_nodes drop constraint org_nodes_parent_id_fkey;
--   alter table public.org_nodes add constraint org_nodes_parent_id_fkey
--     foreign key (parent_id) references public.org_nodes(id) on delete cascade;
--   alter table public.employees drop constraint employees_org_node_id_fkey;
--   alter table public.employees add constraint employees_org_node_id_fkey
--     foreign key (org_node_id) references public.org_nodes(id) on delete set null;
--   alter table public.profiles drop constraint profiles_org_node_id_fkey;
--   alter table public.profiles add constraint profiles_org_node_id_fkey
--     foreign key (org_node_id) references public.org_nodes(id) on delete set null;
--   drop policy if exists org_nodes_insert on public.org_nodes;
--   drop policy if exists org_nodes_update on public.org_nodes;
--   drop policy if exists org_nodes_delete on public.org_nodes;
--   create policy org_nodes_insert on public.org_nodes for insert to authenticated with check (true);
--   create policy org_nodes_update on public.org_nodes for update to authenticated using (true);
--   create policy org_nodes_delete on public.org_nodes for delete to authenticated using (true);
--   (policy org_nodes_delete_perm ถ้ายังอยู่ ลบทิ้งได้เลย — expression เดียวกับ org_nodes_delete)
-- ─────────────────────────────────────────────────────────────────────────────

-- ══ 1) ลบโหนดที่ยังมีลูก/มีคนสังกัด = DB ปฏิเสธ (ไม่ใช่กวาดตามให้เงียบๆ) ══
alter table public.org_nodes  drop constraint if exists org_nodes_parent_id_fkey;
alter table public.org_nodes  add  constraint org_nodes_parent_id_fkey
  foreign key (parent_id) references public.org_nodes(id) on delete restrict;

alter table public.employees  drop constraint if exists employees_org_node_id_fkey;
alter table public.employees  add  constraint employees_org_node_id_fkey
  foreign key (org_node_id) references public.org_nodes(id) on delete restrict;

alter table public.profiles   drop constraint if exists profiles_org_node_id_fkey;
alter table public.profiles   add  constraint profiles_org_node_id_fkey
  foreign key (org_node_id) references public.org_nodes(id) on delete restrict;

-- ══ 2) RLS เขียน — คีย์เดียวกับปุ่มบนจอ ══
-- ⚠️ ฐานจริงถูก apply ด้วย `alter policy` (ปรับ expression ในที่เดิม) เพราะ `drop policy`
--    ค้างที่ตัว MCP ทุกครั้งแล้ว rollback — ปลายทางเหมือนกันเป๊ะ · ฐานใหม่ใช้ drop+create ได้ปกติ
--    ผลพลอยได้: ฐานจริงมี policy ซ้ำชื่อ `org_nodes_delete_perm` (expression เดียวกัน = ไม่ขยายสิทธิ์)
--    บรรทัด drop ข้างล่างเก็บกวาดให้เอง เมื่อ user รันในหน้า SQL Editor
drop policy if exists org_nodes_insert      on public.org_nodes;
drop policy if exists org_nodes_update      on public.org_nodes;
drop policy if exists org_nodes_delete      on public.org_nodes;
drop policy if exists org_nodes_delete_perm on public.org_nodes;

create policy org_nodes_insert on public.org_nodes for insert to authenticated
  with check ((select has_perm('org:manage')) or (select has_perm('org:manage_own_unit')));
create policy org_nodes_update on public.org_nodes for update to authenticated
  using  ((select has_perm('org:manage')) or (select has_perm('org:manage_own_unit')))
  with check ((select has_perm('org:manage')) or (select has_perm('org:manage_own_unit')));
create policy org_nodes_delete on public.org_nodes for delete to authenticated
  using  ((select has_perm('org:manage')) or (select has_perm('org:manage_own_unit')));

comment on constraint org_nodes_parent_id_fkey on public.org_nodes is
  'restrict ตั้งใจ — ลบโหนดที่ยังมีลูกต้องถูกปฏิเสธ ไม่ใช่ cascade ลบสาขาทิ้ง (2026-10-05)';
