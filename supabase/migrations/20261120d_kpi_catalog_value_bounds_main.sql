-- MAIN (ewhdfqwfwofivojtsizn) · 2026-11-20
-- 🏁 "เดือนที่เหลือต้องทำเท่าไหร่" ห้ามคืนตัวเลขที่เป็นไปไม่ได้ (OEE > 100 % · MTTR ติดลบ) — user 20/11
-- ⇒ ทะเบียน KPI ถือ "ช่วงค่าที่เป็นไปได้" ของตัวตน KPI (ตั้งได้ที่ปุ่ม 📘 ทะเบียน · ว่าง = ไม่จำกัด)
-- เจ้าของกฎฝั่ง JS: valueBoundsOf() + neededRunRate() ใน src/utils/kpiSetup.js
alter table public.kpi_catalog
  add column if not exists value_min numeric,
  add column if not exists value_max numeric;
comment on column public.kpi_catalog.value_min is 'ค่าต่ำสุดที่เป็นไปได้ของ KPI นี้ (null = ไม่จำกัด) — ใช้ตัดสินว่า "ที่ต้องทำเดือนที่เหลือ" เป็นไปได้ไหม';
comment on column public.kpi_catalog.value_max is 'ค่าสูงสุดที่เป็นไปได้ของ KPI นี้ (null = ไม่จำกัด) เช่น % = 100 · PPM = 1000000';
alter table public.kpi_catalog drop constraint if exists kpi_catalog_value_bounds_chk;
alter table public.kpi_catalog add constraint kpi_catalog_value_bounds_chk
  check (value_min is null or value_max is null or value_min <= value_max);
-- seed ตามชนิดหน่วย (แก้รายตัวได้ที่ทะเบียน): ทุกตัวไม่ติดลบ · % เพดาน 100 · PPM เพดาน 1,000,000
update public.kpi_catalog set value_min = 0 where value_min is null;
update public.kpi_catalog set value_max = 100     where value_max is null and unit = '%';
update public.kpi_catalog set value_max = 1000000 where value_max is null and upper(coalesce(unit,'')) = 'PPM';
-- ตรวจผล: select name, unit, value_min, value_max from kpi_catalog order by unit, name;
