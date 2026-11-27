-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- 🏢 เติม "ชั้นบน" ของผังจริงเหนือส่วนงานของโรงงานเรา (2026-11-20 · คำสั่ง user เลือกทาง (ก))
--
--   เลเวล 0  company_group  Thai Summit Group (TSG)
--   เลเวล 1  spg            AMF (2000)
--   เลเวล 2  company        TSAT (SAP 2100 · Com Code 210)
--   เลเวล 3  plant          TSAT-P4 (2140)
--   └─ ส่วนงานทั้ง 10 ตัว (เลเวล 4) ย้าย parent_id มาชี้ plant
--
-- ที่มาของค่า: template Com Code + ไฟล์ Activity Rate 2027 (docs/modules/org-hierarchy.md §ทะเบียน cost_centers)
--   · ชั้นบน **ไม่ใส่ cost_center / division / labor_type** — การตกทอดทุกชนิดหยุดที่ชั้นบน (src/utils/orgLayers.js)
--     ถ้าใส่ = กฎตัวเก่าที่ยังไต่ parent_id ตรงๆ (divisionOfNode · laborTypeOfNode) จะเห็นค่าของ plant ไหลลงหน่วย
--   · เฉพาะสาย P4 ของเรา — plant อื่นในเครือยังไม่มีหน่วยงานในระบบ (ไม่เติมโหนดเปล่า)
--   · id ตายตัว ⇒ รันซ้ำได้ (on conflict do nothing) · ย้อนกลับได้ตรงตัว
-- ✅ apply แล้วผ่าน MCP 2026-11-20 ~19:00 (หลัง deploy e350bfe ที่รวมโค้ดจอ) · ตรวจกลับ: ชั้นบนอย่างละ 1 · ส่วนงาน 10/10 ชี้ TSAT-P4 · ชั้นบนไม่มี CC/ฝ่าย/แรงงาน
--
-- พิสูจน์ก่อน apply (20/11): จำลองผังจริง 88 โหนด ก่อน/หลัง ผ่านกฎกลางทุกตัว
--   (orgScope · ccScope · scopePicker · sectionScope.orphanDepts/deptOptionsFor · derivedScope · laborType ·
--    orgNodeEdit.sectionOfOrgNode · divisionOfNode) = 155 ผลลัพธ์ ต่าง 0 · ฝั่ง DB: fn_kpi_scope_canon กรอง kind
--   section/department อยู่แล้ว · wf_resolve ไต่หาหัวหน้าขึ้นไปเจอชั้นบนที่ไม่มี org_assignments = ผลเดิม
--
-- ย้อนกลับ (ลำดับสำคัญ — FK parent_id เป็น RESTRICT):
--   update public.org_nodes set parent_id = null where kind = 'section' and parent_id = 'a0000000-0000-4000-8000-000000002140';
--   delete from public.org_nodes where id in ('a0000000-0000-4000-8000-000000002140');
--   delete from public.org_nodes where id in ('a0000000-0000-4000-8000-000000002100');
--   delete from public.org_nodes where id in ('a0000000-0000-4000-8000-000000002000');
--   delete from public.org_nodes where id in ('a0000000-0000-4000-8000-000000000001');

insert into public.org_nodes (id, kind, name, code, parent_id, sort_order, is_active) values
  ('a0000000-0000-4000-8000-000000000001', 'company_group', 'Thai Summit Group', 'TSG',  null,                                   0, true),
  ('a0000000-0000-4000-8000-000000002000', 'spg',           'AMF',               '2000', 'a0000000-0000-4000-8000-000000000001', 0, true),
  ('a0000000-0000-4000-8000-000000002100', 'company',       'TSAT',              '2100', 'a0000000-0000-4000-8000-000000002000', 0, true),
  ('a0000000-0000-4000-8000-000000002140', 'plant',         'TSAT-P4',           '2140', 'a0000000-0000-4000-8000-000000002100', 0, true)
on conflict (id) do nothing;

-- ส่วนงานที่ยังลอย (parent ว่าง) เท่านั้น — ไม่แตะส่วนงานที่มีคนตั้งแม่ไว้แล้ว
update public.org_nodes
   set parent_id = 'a0000000-0000-4000-8000-000000002140'
 where kind = 'section' and parent_id is null;

-- ตรวจผล:
--   select kind, count(*) from public.org_nodes group by kind order by 1;
--   select n.name, p.name as parent from public.org_nodes n left join public.org_nodes p on p.id = n.parent_id
--    where n.kind in ('company_group','spg','company','plant','section') order by n.kind, n.name;
