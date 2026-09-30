-- ══ KPI ที่ "ค่าเป็นของโรงงาน" — ทุกหน่วยงานที่ถือ KPI ตัวนี้ใช้ตัวเลขเดียวกัน (MAIN · ewhdfqwfwofivojtsizn · 2026-09-30) ══
-- คำสั่ง user: "customer satisfaction กับ %RM (raw material) เป็นค่าที่ทุกหน่วยงานที่ถือ KPI ตัวนี้จะใช้ตัวเดียวกันคือของโรงงาน"
-- หลักการ (data-driven ไม่ hardcode ชื่อในโค้ด):
--   · `kpi_catalog.value_scope` = 'own' (ค่าของหน่วยงานเอง · ค่าเดิม) | 'plant' (ค่าโรงงาน ใช้ร่วมกัน)
--   · KPI ที่เป็น 'plant': **ค่ารายเดือนอยู่ที่นิยามระดับโรงงาน (scope_kind='plant') ที่เดียว** ·
--     นิยามของหน่วยงาน (PD3/PD4/…) ยังมีได้ — เก็บ "เป้า/น้ำหนัก/ลำดับในใบ KPI ของหน่วยนั้น" แต่จอ**อ่านค่าจากนิยามโรงงาน**
--     (จอ: ObeyaKpiBoard + KpiMonthly ผ่าน `valueScopeOf()`/`sharedValueDef()` ใน src/utils/kpiSetup.js)
--   · ตั้งได้จากปุ่ม 📘 ทะเบียน KPI ในแท็บ ⚙️ — เพิ่ม/ถอด KPI ตัวอื่นภายหลังไม่ต้องแก้โค้ด
-- ข้อมูล ณ วันรัน (ตรวจแล้ว): %RM / Customer Satisfaction มีนิยาม PD3 (ไม่มีค่า) + PD4 (กรอก ม.ค.–ส.ค. 2026) · ยังไม่มีนิยามโรงงาน
--   ⇒ สร้างนิยามโรงงานปี 2026 จากนิยามหน่วยที่มีค่ามากสุด (PD4) แล้ว**คัดลอก**ค่ารายเดือนไป (ค่าเดิมของ PD4 ไม่ลบ = ประวัติ)
-- rollback (ย้อนได้ทั้งหมด · ทำตามลำดับ):
--   delete from kpi_manual_entries where kpi_id in (select id from kpi_definitions where scope_kind='plant' and catalog_id in (select id from kpi_catalog where value_scope='plant'));
--   delete from kpi_definitions where scope_kind='plant' and catalog_id in (select id from kpi_catalog where value_scope='plant') and created_at >= '2026-09-30';
--   alter table kpi_catalog drop column value_scope;

begin;

alter table public.kpi_catalog
  add column if not exists value_scope text not null default 'own';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_catalog_value_scope_chk') then
    alter table public.kpi_catalog add constraint kpi_catalog_value_scope_chk
      check (value_scope in ('own', 'plant'));
  end if;
end $$;

comment on column public.kpi_catalog.value_scope is
  'own = ค่ารายเดือนเป็นของหน่วยงานที่ถือ KPI · plant = ค่าโรงงาน ทุกหน่วยที่ถือ KPI นี้อ่านค่าจากนิยามระดับ plant ตัวเดียวกัน (กรอกที่ขอบเขต ทั้งโรงงาน)';

-- 1) ทำเครื่องหมาย 2 ตัวตามคำสั่ง user (เทียบชื่อแบบไม่สนตัวพิมพ์/ช่องว่าง เหมือน unique index ของทะเบียน)
update public.kpi_catalog
   set value_scope = 'plant', updated_at = now()
 where lower(btrim(name)) in ('%rm (raw material)', 'customer satisfaction')
   and value_scope <> 'plant';

-- 2) นิยามระดับโรงงานของ KPI แบบ plant ที่ยังไม่มี — คัดโครงจากนิยามหน่วยงานที่มีค่ากรอกมากสุด (น้ำหนักไม่คัดลอก = ของใบหน่วยงาน)
insert into public.kpi_definitions
  (year, category, seq, name, source, unit, decimals, target_value, target_compare, commit_value, commit_compare, commitment,
   direction, weight, catalog_id, std_unit, std_item_id, formula_text, scope_text, scope_kind, scope_value, section, line_group, is_active)
select d.year, d.category, d.seq, d.name, 'manual', d.unit, d.decimals, d.target_value, d.target_compare, d.commit_value, d.commit_compare, d.commitment,
       d.direction, null, d.catalog_id, d.std_unit, d.std_item_id, d.formula_text, d.scope_text, 'plant', null, null, null, true
from (
  select distinct on (d.catalog_id, d.year) d.*
  from public.kpi_definitions d
  join public.kpi_catalog c on c.id = d.catalog_id
  where c.value_scope = 'plant' and d.is_active and coalesce(d.scope_kind, '') <> 'plant'
  order by d.catalog_id, d.year,
           (select count(*) from public.kpi_manual_entries e where e.kpi_id = d.id and e.value is not null) desc,
           d.created_at
) d
where not exists (
  select 1 from public.kpi_definitions p
  where p.catalog_id = d.catalog_id and p.year = d.year and p.scope_kind = 'plant' and p.is_active
);

-- 3) คัดลอกค่ารายเดือนจากนิยามหน่วยงาน → นิยามโรงงาน เฉพาะเดือนที่โรงงานยังว่าง (หน่วยที่กรอกมากสุดชนะ · ไม่ทับค่าที่มีอยู่)
insert into public.kpi_manual_entries (kpi_id, month, value)
select p.id, e.month, e.value
from public.kpi_definitions p
join public.kpi_catalog c on c.id = p.catalog_id and c.value_scope = 'plant'
join lateral (
  select distinct on (e.month) e.month, e.value
  from public.kpi_manual_entries e
  join public.kpi_definitions u on u.id = e.kpi_id
  where u.catalog_id = p.catalog_id and u.year = p.year and u.id <> p.id and e.value is not null
  order by e.month,
           (select count(*) from public.kpi_manual_entries e2 where e2.kpi_id = u.id and e2.value is not null) desc,
           u.created_at
) e on true
where p.scope_kind = 'plant' and p.is_active
on conflict (kpi_id, month) do nothing;

commit;

-- ตรวจผลหลังรัน (MAIN):
-- select c.name, c.value_scope, d.scope_kind, d.scope_value,
--        (select count(*) from kpi_manual_entries e where e.kpi_id = d.id and e.value is not null) as months
--   from kpi_catalog c join kpi_definitions d on d.catalog_id = c.id and d.is_active
--  where c.value_scope = 'plant' order by c.name, d.scope_kind;
