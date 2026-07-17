-- กรองหมวดจุดตรวจ (CATEGORY) ตามชนิดอุปกรณ์ (2026-07-16)
-- Project: DR/Product (eyhclzkifitbhbljgoav) — client `supabaseDR` (role anon เสมอ)
--
-- ปัญหาเดิม: หมวดจุดตรวจ (LP/SD/AC/... ของ JIG) โชว์รวมทุกฝ่ายทุกเครื่อง เลือกยาก รก
-- แก้: แท็กหมวดว่าใช้กับชนิดอุปกรณ์ไหน (machine/jig/die/facility) แล้ว PM Setup กรอง dropdown
--      ตาม equipment_type ของอุปกรณ์ที่กำลังตั้ง · null/ว่าง = หมวดกลาง (โชว์ทุกชนิด)
--
-- ⚠️ ต้อง DROP category CHECK ที่ hardcode รายชื่อหมวด JIG (LP/SD/AC/PS/RS/V/SU/SC/HD)
--    ก่อน ไม่งั้นเพิ่มหมวดของเครื่องจักร/die/facility ไม่ได้ (หมวดเป็น data-driven ใน
--    pm_checkpoint_categories อยู่แล้ว CHECK นี้จึงซ้ำซ้อนและบล็อกของใหม่)
alter table public.jig_checkpoints
  drop constraint if exists jig_checkpoints_category_check;

alter table public.pm_checkpoint_categories
  add column if not exists equip_types text[];

-- หมวดเดิม 9 ตัวเป็นของ JIG ทั้งหมด → แท็ก jig (เครื่องจักร/die/facility จะไม่เห็น จนกว่าจะเพิ่มหมวดของตัวเอง)
update public.pm_checkpoint_categories
  set equip_types = array['jig'] where equip_types is null;
