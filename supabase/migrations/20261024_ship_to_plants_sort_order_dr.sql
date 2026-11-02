-- DR ("Product DB" eyhclzkifitbhbljgoav) · 2026-10-24
-- ลำดับแถวลูกค้าบน Shipping Time Chart ล็อกตายตัว (คำสั่ง user: "ไม่อยากให้ลูกค้าสลับตำแหน่งในตาราง lock ไปเลย ใครจะแถวไหน")
-- เดิมแถวเรียงตามลำดับที่ใบโผล่ในคิวรีแต่ละวัน ⇒ วันนี้ AAT บนสุด พรุ่งนี้ FTM บนสุด
-- ตั้ง/แก้ได้ที่ /customer-demand → ⚙️ Ship-to Config (ช่อง "ลำดับในชาร์ต") · ว่าง = ต่อท้าย เรียงตามชื่อ
-- ย้อนกลับ: alter table public.ship_to_plants drop column if exists sort_order;
alter table public.ship_to_plants add column if not exists sort_order integer;

-- ค่าตั้งต้น = ปริมาณรอบส่ง 30 วันล่าสุด (มาก→น้อย) — ตั้งเฉพาะแถวที่ยังว่าง
update public.ship_to_plants p set sort_order = s.rn * 10
from (
  select code, row_number() over (order by (select count(*) from public.customer_shipping_orders o
    where o.customer = p2.code and o.due_date >= current_date - 30) desc, code) rn
  from public.ship_to_plants p2
) s
where s.code = p.code and p.sort_order is null;
