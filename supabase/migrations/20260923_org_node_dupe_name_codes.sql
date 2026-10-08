-- ─────────────────────────────────────────────────────────────────────────────
-- 🏷️ โหนดผังที่ "ชื่อซ้ำกัน" ต้องมี code เพื่อชี้ได้หน่วยเดียว   (Main project)
-- 2026-09-23 · docs/ORG-AXES-DECISION.md §3.1
--
-- ปัญหา: มีแผนกชื่อ `ทั่วไป` **2 อัน** (ใต้ PD2 และ PD4) และทั้งคู่ `code` ว่าง
--   ⇒ `orgScope` (utils/orgScope.js) ใช้ `code || name` เป็นค่าของ `?scope=kind:value`
--     ⇒ `department:ทั่วไป` **อ้างถึงทั้ง 2 หน่วยพร้อมกัน** — เลือกแยกกันไม่ได้เลย
--   ⇒ ตัวกรอง/กฎแจ้งเตือนใดๆ ที่เดินผ่านชื่อแผนก ตัดสิน 15 คนกลุ่มนี้ผิดหรือได้ทั้งคู่
--
-- ตรวจก่อนแก้ (23/09): `kpi_definitions.scope_value` มีแค่ JIG MTN / PD3 / PD4
--   ⇒ **ไม่มีแถวไหนเก็บ 'ทั่วไป'** จึงไม่มีของเก่าต้อง migrate ตาม
--
-- 🔴 กฎที่ได้: **โหนดในผังที่ชื่อซ้ำกับโหนดอื่นใน kind เดียวกัน ต้องตั้ง `code` เสมอ**
--    (ชื่อไว้อ่าน · code ไว้ชี้) — จอ /org-setup ควรเตือนเมื่อสร้างชื่อซ้ำโดยไม่ใส่ code
--
-- ROLLBACK: update org_nodes set code = null where code in ('PD2-GEN','PD4-GEN');
-- ─────────────────────────────────────────────────────────────────────────────
update public.org_nodes d
   set code = case s.name when 'PD2' then 'PD2-GEN' when 'PD4' then 'PD4-GEN' else d.code end
  from public.org_nodes s
 where d.parent_id = s.id and d.kind = 'department' and d.name = 'ทั่วไป'
   and coalesce(d.code, '') = '' and s.name in ('PD2', 'PD4');
