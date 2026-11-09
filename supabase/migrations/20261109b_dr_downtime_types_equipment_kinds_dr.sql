-- DR project (Product DB · eyhclzkifitbhbljgoav)
-- 2026-11-09 · คำสั่ง user: ติ๊ก "แม่พิมพ์" ให้ประเภท Downtime แม่พิมพ์ชำรุด/แตก (+ ประเภทแม่พิมพ์อื่น)
-- แม่พิมพ์แยกด้วย machines.equipment_kind = 'die' (270/276 ตัวไม่มี machine_type_id) ⇒ ผูกด้วย machine_type_ids ไม่ได้
-- ประเภท Downtime → ชนิดอุปกรณ์ (machine/die/jig/facility · utils/equipmentKinds.js)
--   · เครื่องเข้าเกณฑ์ถ้า ประเภทเครื่องตรง machine_type_ids **หรือ** ชนิดตรง equipment_kinds
--   · ทั้ง 2 ช่องว่าง = ทุกเครื่อง (พฤติกรรมเดิม)
-- ย้อนกลับ: alter table public.dr_downtime_types drop column if exists equipment_kinds;
alter table public.dr_downtime_types add column if not exists equipment_kinds text[];
comment on column public.dr_downtime_types.equipment_kinds is
  'ชนิดอุปกรณ์ (machine/die/jig/facility) ที่ประเภท Downtime นี้เกิดได้ — OR กับ machine_type_ids · ว่างทั้งคู่ = ทุกเครื่อง';
