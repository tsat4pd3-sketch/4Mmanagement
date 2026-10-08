-- ══════════════════════════════════════════════════════════════════════════════════════════
-- KPI: ขอบเขตระดับ "ฝ่าย" (division) + จอเลือกขอบเขตได้ทุกมิติของผังองค์กร   (Main · 2026-09-23)
-- ที่มา: user 23/09 — "เลือกส่วนงานตอนนี้เหมือนเลือกได้แค่ section และไม่ตรงกับผังองค์กร
--        ควรกรองได้ทุกมิติในผังองค์กร"
--   · โค้ดใหม่ (`src/utils/orgScope.js` · `<OrgScopePicker>`) เขียน scope_kind/scope_value ตรง
--     (เดิมทุกจอเขียนแค่ section/line_group แล้วให้ trigger เดา) — เพิ่ม 'division' เข้า check constraint
--   · `fn_kpi_def_scope_sync` ยังใช้เดิม: kind อื่นนอกจาก section/line_group/plant ไม่แตะ section
--     (โค้ดใหม่เขียน `section` มาเองผ่าน defScopeColumns() เผื่อจอเก่าที่ยังกรองด้วย section)
--   · unique index (year, scope_kind, scope_value, catalog_id) มีอยู่แล้ว (20260916) ครอบทุก kind
-- 📊 ตอนรัน: kpi_definitions = 0 แถว ⇒ blast radius เป็นศูนย์
-- ══════════════════════════════════════════════════════════════════════════════════════════
alter table public.kpi_definitions drop constraint if exists kpi_definitions_scope_kind_chk;
alter table public.kpi_definitions add constraint kpi_definitions_scope_kind_chk
  check (scope_kind is null or scope_kind in
    ('plant','division','section','department','line_group','line','cost_center'));

-- kpi_month_plans / kpi_base_inputs ก็มี scope_kind — ให้รับ 'division' ด้วยถ้ามี constraint ชื่อเดียวกัน
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'kpi_month_plans_scope_kind_chk') then
    alter table public.kpi_month_plans drop constraint kpi_month_plans_scope_kind_chk;
    alter table public.kpi_month_plans add constraint kpi_month_plans_scope_kind_chk
      check (scope_kind in ('plant','division','section','department','line_group','line','cost_center'));
  end if;
end $$;

-- ── rollback ──
-- alter table public.kpi_definitions drop constraint if exists kpi_definitions_scope_kind_chk;
-- alter table public.kpi_definitions add constraint kpi_definitions_scope_kind_chk
--   check (scope_kind is null or scope_kind in ('plant','section','department','line_group','line','cost_center'));
-- (ต้อง update แถวที่ scope_kind='division' ให้เป็น 'plant' ก่อน ไม่งั้น add constraint ล้ม)
