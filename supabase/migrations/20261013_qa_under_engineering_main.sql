-- ─────────────────────────────────────────────────────────────────────────────
-- ✅ ย้าย QA ไปใต้ "ฝ่าย Engineering" ตามผังจริง                    (Main project · ewhdfqwfwofivojtsizn)
-- 2026-10-13 · คำสั่ง user "ย้าย QA ไปใต้ฝ่าย Engineering ตามผังเลย"
--   อ้างอิง ORG-001_TSAT4_Overall_Rev.09 (§8 org-hierarchy.md): ฝ่าย Engineering 2140340000 มี 2 ส่วน =
--   Quality Assurance 2140441000 (เด่นดวง ดวงธนู · ผจก. M2) + Process Engineering 2140446000
--   ⇒ "ฝ่ายคุณภาพ" (`quality`) ไม่มีอยู่จริงในผัง — เป็นป้ายที่ระบบตั้งเองตอน 2026-08-18
--
-- ── สิ่งที่เปลี่ยน ─────────────────────────────────────────────────────────────
--   ① โหนด QA (department ขึ้นตรงฝ่าย) ป้ายฝ่าย quality → engineering
--   ② ปิดใช้งานฝ่าย `quality` (is_active=false · **ไม่ลบ** เก็บประวัติ + FK org_nodes.division ยังชี้ได้)
--      ทำแบบ fail-closed: ปิดได้ต่อเมื่อไม่เหลือโหนด active ที่ยังติดป้าย quality
--
-- ── ตรวจผลกระทบก่อนทำ (13/10) ───────────────────────────────────────────────
--   · skill_definitions.scope_division = quality → 0 แถว (มีแค่ production 64 · office 1 · null 5)
--   · kpi_definitions / kpi_board_layouts / kpi_month_notes / kpi_base_inputs scope_kind='division' → ไม่มีแถว quality
--   · profiles ไม่มี scope 'division:quality' · employees ที่ผูกโหนด QA = 0 คน
--   · โค้ด: ไม่มีที่ไหน hardcode division === 'quality' (คำว่า quality ที่เหลือใน src เป็นหมวดอาการ/4M คนละแกน)
--   ⇒ ผลที่เห็น: OrgScopePicker/KPI/scrap report ที่เคยมีหัว "✅ ฝ่ายคุณภาพ › QA" จะเป็น "⚙️ ฝ่ายวิศวกรรม › QA + PE"
--
-- ⚠️ ยังไม่แก้ในรอบนี้ (ต้องให้ user เคาะแยก): QA ในผังจริงเป็น "ส่วน" Cost 2140441000
--    แต่ระบบเก็บเป็น department Cost `214055654` (9 หลัก ไม่ตรงรูปแบบ) — เปลี่ยน kind/cost กระทบทะเบียน cost_centers + KPI ที่จับคู่ด้วย text
--
-- ROLLBACK:
--   update org_divisions set is_active = true where code = 'quality';
--   update org_nodes set division = 'quality' where kind = 'department' and name = 'QA' and division = 'engineering';
-- ─────────────────────────────────────────────────────────────────────────────

-- ① QA → ฝ่าย Engineering (เฉพาะโหนดที่ยังติด quality — รันซ้ำไม่ทับค่าที่คนแก้ทีหลัง)
update public.org_nodes
   set division = 'engineering'
 where kind = 'department' and name = 'QA' and division = 'quality';

-- ② ปิดฝ่าย quality เมื่อไม่มีใครใช้แล้ว (fail-closed)
update public.org_divisions d
   set is_active = false
 where d.code = 'quality'
   and not exists (select 1 from public.org_nodes n where n.division = 'quality' and n.is_active);

-- ตรวจผล:
--   select name, kind, division from org_nodes where name = 'QA';                 -- engineering
--   select code, label, is_active from org_divisions order by sort_order;       -- quality = false
