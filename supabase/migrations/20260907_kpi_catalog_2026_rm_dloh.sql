-- ══ ทะเบียน KPI ปี 2026: เพิ่ม %RM + DL+OH · ปิดใช้งาน Direct Labor / Overhead (Main · 2026-09-07) ══
-- user: "ที่ส่งให้ดูคือปีเก่า · ปีนี้จะมีเพิ่ม %RM (Raw Material) เข้ามาเป็นข้อที่ 1 และ DL กับ OH จะรวมกันเป็นข้อเดียว"
-- กติกา:
--   · ไม่ rename แถวเดิม — ตัวตน KPI ใช้ข้ามปี (นิยามปี ≤ 2025 ถ้ามีต้องอ่านออกเหมือนเดิม) → ปิดใช้งาน (soft) เท่านั้น
--   · เพิ่มเฉพาะเมื่อยังไม่มีชื่อซ้ำ (unique index lower(btrim(name)) กันอยู่แล้ว) · รันซ้ำได้
--   · สูตร %RM เป็นข้อสันนิษฐานตามแบบ DL/OH (ตัวหาร Sale from product) — user ยังไม่ยืนยัน แก้ได้ที่ 🗂 ทะเบียน
--   · rollback: update kpi_catalog set is_active=true where name in ('Direct Labor','Overhead'); แล้วปิด 2 ชื่อใหม่

insert into public.kpi_catalog (name, category, direction, unit, formula_text, scope_text, sort_order)
select v.name, v.category, v.direction, v.unit, v.formula_text, v.scope_text, v.sort_order
from (values
  ('%RM (Raw Material)', 'financial', 'down', '%',
   'ต้นทุนวัตถุดิบ (Raw Material) ÷ ยอดขายจากสินค้า (Sale from product) × 100 — สูตรสันนิษฐาน รอยืนยัน',
   'กรอกมือ — ข้อมูลจากบัญชี/SAP · KPI ข้อ 1 หมวด Financial ตั้งแต่ปี 2026', 5),
  ('DL+OH (Direct Labor + Overhead)', 'financial', 'down', '%',
   '(ต้นทุนแรงงานทางตรง + ค่าโสหุ้ย) ÷ ยอดขายจากสินค้า (Sale from product) × 100',
   'กรอกมือ — ข้อมูลจากบัญชี/SAP · รวม Direct Labor + Overhead เป็นข้อเดียวตั้งแต่ปี 2026', 12)
) as v(name, category, direction, unit, formula_text, scope_text, sort_order)
where not exists (
  select 1 from public.kpi_catalog c where lower(btrim(c.name)) = lower(btrim(v.name))
);

-- ปิดใช้งานชื่อโครงเก่า (ยังอ่านได้ในนิยามปีเก่า · เปิดคืนได้ที่ 🗂 ทะเบียนชื่อ KPI)
update public.kpi_catalog
set is_active = false
where lower(btrim(name)) in ('direct labor', 'overhead') and is_active;

-- ตรวจผล: ควรเห็น %RM (5) · DL+OH (12) active · Direct Labor / Overhead is_active=false
-- select name, is_active, sort_order, unit, formula_text from public.kpi_catalog order by sort_order;
