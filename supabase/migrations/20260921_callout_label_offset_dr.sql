-- ตำแหน่งป้ายเลขหมุดที่คนลากเอง (DR · eyhclzkifitbhbljgoav) — 2026-09-21
-- คู่กับ 20260921_callout_label_offset_main.sql · หมุด PM (jig_checkpoints) + หมุดชิม (fixture_points)
-- null ทั้งคู่ = ทิศอัตโนมัติแบบเดิม ⇒ หมุดเก่าทุกตัวหน้าตาไม่เปลี่ยน
alter table public.jig_checkpoints add column if not exists label_dx numeric;
alter table public.jig_checkpoints add column if not exists label_dy numeric;
alter table public.fixture_points  add column if not exists label_dx numeric;
alter table public.fixture_points  add column if not exists label_dy numeric;

comment on column public.jig_checkpoints.label_dx is
  'ตำแหน่งป้ายเลขหมุดเทียบกับจุดจริง — % ของกล่องรูป (null = ทิศอัตโนมัติ) · src/utils/calloutGeom.js';
comment on column public.fixture_points.label_dx is
  'ตำแหน่งป้ายเลขหมุดชิมเทียบกับจุดจริง — % ของกล่องรูป (null = ทิศอัตโนมัติ)';

-- ROLLBACK:
--   alter table public.jig_checkpoints drop column if exists label_dx, drop column if exists label_dy;
--   alter table public.fixture_points  drop column if exists label_dx, drop column if exists label_dy;
