-- 2026-11-04 · Main ("MAIN" · ewhdfqwfwofivojtsizn)
-- ใบเบิก WIP ที่ยกเลิก ต้องเก็บเหตุผล/ใคร/เมื่อไหร่ (เดิมตารางไม่มีช่อง — ยกเลิกแล้วไม่รู้ว่าทำไม)
-- เคสแรก: ยกเลิกใบ "➕ ขอเอง" 10 ใบที่ไลน์ขอพาร์ทที่ตัวเองผลิต (ขอผิดทิศ · คำสั่ง user 04/11)
-- ย้อนได้: alter table public.wip_replenish_requests drop column cancel_reason, drop column cancelled_at, drop column cancelled_by_name;
alter table public.wip_replenish_requests
  add column if not exists cancel_reason     text,
  add column if not exists cancelled_at      timestamptz,
  add column if not exists cancelled_by_name text;
