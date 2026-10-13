-- ─────────────────────────────────────────────────────────────────────────────
-- 🧪 เพิ่ม "ส่วน Process Engineering" เข้าผังองค์กร                 (Main project · ewhdfqwfwofivojtsizn)
-- 2026-10-13 · อ้างอิงผังทางการ **ORG-016_TSAT4_PE_Process_Rev.05** (FM-HRM-1-001(03) ·
--              Received/Effective 6 Oct 2026 · TSAT Branch 1) — user ส่งไฟล์มาให้ "ทำความเข้าใจ + เพิ่มข้อมูล"
--
-- ── โครงในผังจริง (4 ชั้น คั่นเส้นประแดง) ─────────────────────────────────────
--   ฝ่าย  Engineering                     Cost 2140340000  นายชัยยุทธ พรหมภา · ผู้จัดการทั่วไป (G2)
--   ส่วน  Process Engineering             Cost 2140446000  น.ส.เพ็ญศิริ วงศ์ภักดี · รก.ผู้จัดการ (S1)*
--         Process Engineering             Cost 2140446000  นายศิวาวุธ · รก.หัวหน้าส่วน (S2)*
--   แผนก  Process Engineering             Cost 2140446000  นายสุกกิจ · รก.หัวหน้าแผนก (S2)*
--         ├ Process Engineering 1         Cost 2140546100  วิศวกร S3 ×3 · ช่างเทคนิค T3 ×2
--         └ Process Engineering 2         Cost 2140546200  วิศวกร S3 ×2 (+ว่าง 1) · พนักงาน T1 ×1 · ช่างเทคนิค T2/T3 ×2
--   อัตรากำลังรวม 13 (หัวหน้าส่วน 1 · วิศวกร 7 · พนักงาน 1 · ช่างเทคนิค 4)
--
-- ── วิธีแมปเข้าระบบ (ตามกฎ docs/modules/org-hierarchy.md) ────────────────────
--   · ฝ่าย = **ป้าย** `org_divisions` ไม่ใช่โหนด ⇒ เพิ่มรหัส `engineering` (เดิมระบบไม่มีฝ่ายนี้ —
--     เป็นช่องว่างที่บันทึกไว้ใน §8 "ขาดฝ่าย Engineering") · ไม่ย้าย QA ออกจาก `quality` ในรอบนี้ (ต้องให้ user เคาะ)
--   · ส่วน/Process Engineering/แผนก Process Engineering = **Cost เดียวกัน 2140446000** ⇒ เป็นหน่วยเดียวในระบบ
--     (3 กล่องในผังคือ 3 ชั้นของ "รักษาการ" ไม่ใช่ 3 หน่วยงบประมาณ · `/org-setup` ก็ไม่ให้ cost center ซ้ำอยู่แล้ว)
--     ⇒ โหนด section 1 ตัว `PE` → department 2 ตัว `PE1` / `PE2` (เลข 21405xxxxx = รูปแบบแผนกเหมือน PD)
--   · labor_type = indirect (สายสนับสนุน) · ไม่ผูก `ref_line_id` (ไม่ใช่ไลน์ผลิต)
--
-- ── สิ่งที่ **ไม่ได้** ใส่ในรอบนี้ และทำไม ────────────────────────────────────
--   · พนักงาน 13 คน — `employees.employee_id_code` เป็น NOT NULL UNIQUE แต่ผังไม่มีรหัสพนักงาน
--     ⇒ ห้ามแต่งรหัสขึ้นเอง (รายชื่อ+ตำแหน่ง+เกรดถอดไว้แล้วใน org-hierarchy.md §10 รอรหัสจาก HR)
--   · หัวหน้า/รักษาการ (`org_assignments`) — ต้องผูก `profile_id` แต่ 3 ท่านยังไม่มีบัญชีผู้ใช้
--     (บัญชี role engineer ที่มีอยู่คือบัญชีกลาง `processengineering` ไม่ใช่ตัวบุคคล)
--   · cost center ของฝ่าย 2140340000 — ทะเบียน `cost_centers` เก็บระดับส่วน/แผนก/ไลน์เท่านั้น (ไม่มีฝ่ายไหนอยู่)
--
-- idempotent ทั้งไฟล์ (รันซ้ำไม่เพิ่มซ้ำ) · ย้อนได้ด้วย ROLLBACK ท้ายไฟล์
-- ─────────────────────────────────────────────────────────────────────────────

-- ① ฝ่าย Engineering (ป้าย) — fallback ฝั่ง JS: DEFAULT_DIVISIONS ใน src/utils/orgDivisions.js ต้องตรงกัน
insert into public.org_divisions (code, label, icon, color, sort_order)
values ('engineering', 'ฝ่ายวิศวกรรม', '⚙️', '#0ea5e9', 25)
on conflict (code) do nothing;

-- ② ทะเบียน cost center (section = สำเนาชื่อส่วนที่ทะเบียนใช้จัดกลุ่ม · text ไม่ผูก FK)
insert into public.cost_centers (code, name, section, sort_order)
values ('2140446000', 'PE',  'PE', 113),
       ('2140546100', 'PE1', 'PE', 114),
       ('2140546200', 'PE2', 'PE', 115)
on conflict (code) do nothing;

-- ③ โหนดในผัง — ส่วน PE (ขึ้นตรงฝ่าย · parent_id null เหมือน PD1-4)
insert into public.org_nodes (kind, name, code, parent_id, cost_center, division, labor_type, sort_order, is_active)
select 'section', 'Process Engineering', 'PE', null, '2140446000', 'engineering', 'indirect', 45, true
 where not exists (select 1 from public.org_nodes where kind = 'section' and cost_center = '2140446000');

-- ④ แผนก PE1 / PE2 ใต้ส่วน PE
insert into public.org_nodes (kind, name, code, parent_id, cost_center, labor_type, sort_order, is_active)
select 'department', v.name, v.code, s.id, v.cc, 'indirect', v.so, true
  from (values ('Process Engineering 1', 'PE1', '2140546100', 1),
               ('Process Engineering 2', 'PE2', '2140546200', 2)) as v(name, code, cc, so)
  join public.org_nodes s on s.kind = 'section' and s.cost_center = '2140446000' and s.is_active
 where not exists (select 1 from public.org_nodes d where d.kind = 'department' and d.cost_center = v.cc);

-- ตรวจผล:
--   select kind, code, name, cost_center, division, labor_type, parent_id from org_nodes
--    where cost_center in ('2140446000','2140546100','2140546200') order by kind desc, sort_order;
--   select * from cost_centers where section = 'PE';  select * from org_divisions where code = 'engineering';
--
-- ROLLBACK (ย้อนลำดับ · โหนดมี FK จาก employees.org_node_id แบบ RESTRICT — ถ้ามีคนผูกแล้วต้องย้ายคนก่อน):
--   delete from org_nodes where kind='department' and cost_center in ('2140546100','2140546200');
--   delete from org_nodes where kind='section' and cost_center = '2140446000';
--   delete from cost_centers where code in ('2140446000','2140546100','2140546200');
--   delete from org_divisions where code = 'engineering';   -- org_nodes.division FK = on delete set null
