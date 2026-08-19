-- เติม cost_center ให้ production_lines จากผังองค์กร · Main project
-- 2026-08-19 · user: "ถ้ามี cost center แยก ไป seed ให้ที"  (apply แล้ว 2026-08-19)
--
-- ผังองค์กร (org_nodes.kind='line') มีรหัส SAP ระดับกลุ่มถูกต้องอยู่แล้ว แต่ production_lines ยังว่าง
-- → cost saving ของไลน์ลูกพวกนี้คำนวณไม่ได้ (ตกไป fallback ไลน์แม่ ซึ่งเป็นรหัสระดับแผนก 21405xxxx
--   ที่ไม่มี rate ตามกฎ "rate มีที่ระดับกลุ่มเท่านั้น")
--
-- ⚠️ เติม **เฉพาะไลน์ที่ยังว่าง และรหัสจากผังมี rate จริง** — ไม่ทับค่าที่มีอยู่แล้ว
--    (การแก้ค่าที่ตั้งไว้ผิดเป็นคนละเรื่อง ต้องให้คนตัดสิน — ดูรายการที่ต้องตรวจใน CLAUDE.md)
update public.production_lines l
set cost_center = o.cost_center
from public.org_nodes o
where o.kind = 'line'
  and o.ref_line_id = l.id
  and coalesce(l.cost_center, '') = ''
  and coalesce(o.cost_center, '') <> ''
  and exists (select 1 from public.cost_center_rates r where r.cost_center = o.cost_center);
