-- DR project (Product DB · eyhclzkifitbhbljgoav)
-- 2026-11-09 · คำสั่ง user: "ลงปัญหาโรบอทเบรคดาวน์ เครื่องจักรที่ขึ้นให้เลือกก็ควรเป็นโรบอท ไม่ใช่ขึ้นทุกเครื่องของไลน์"
-- ประเภท Downtime → ประเภทเครื่องที่เกี่ยวข้อง (machine_types.id) — คนติ๊กเองที่ /daily-report แท็บตั้งค่า
--   · null / ว่าง = ไม่จำกัด (เกิดได้กับทุกเครื่อง เช่น Sensor/Pneumatic) = พฤติกรรมเดิม
--   · ไม่ผูก FK (array) — ประเภทเครื่องที่ถูกลบ = จอข้ามเอง
-- ย้อนกลับ: alter table public.dr_downtime_types drop column if exists machine_type_ids;
alter table public.dr_downtime_types add column if not exists machine_type_ids uuid[];
comment on column public.dr_downtime_types.machine_type_ids is
  'ประเภทเครื่อง (machine_types.id) ที่ประเภท Downtime นี้เกิดได้ — ใช้กรองช่องเลือกเครื่องในฟอร์ม Downtime · ว่าง = ทุกเครื่อง';
