-- 🧲 เหล็ก coil จ่ายเป็น kg (2026-11-05 · คำสั่ง user) — Main project (ewhdfqwfwofivojtsizn)
-- ประทับหน่วยลงใบเบิกตอนออกใบ (lib/lineDemandSync.js) · null = ชิ้น (ใบเก่า/พาร์ททั่วไป — พฤติกรรมเดิม)
-- ย้อนกลับ: alter table public.wip_replenish_requests drop column if exists uom;
alter table public.wip_replenish_requests add column if not exists uom text;
comment on column public.wip_replenish_requests.uom is
  'หน่วยของ request_qty/picked_qty/received_qty — ''KG'' = เหล็ก coil (จ่ายเป็นม้วน กรอกน้ำหนักจริง) · null = ชิ้น';
