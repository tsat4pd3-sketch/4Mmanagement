-- ผูกใบงานกับเครื่องจริง สำหรับไลน์เครื่องขนาน (2026-07-23) · DR project (prod_orders)
-- machine_no = เลขเครื่อง (อ้าง machines.machine_no ของไลน์นั้น) ที่ใบงานนี้วิ่ง
-- ไลน์ one_piece_flow ปล่อยว่างได้ (null) — ใช้เฉพาะไลน์ parallel_machine เพื่อแยกเลน + วัด OEE รายเครื่อง
alter table public.prod_orders
  add column if not exists machine_no text;

comment on column public.prod_orders.machine_no is
  'เลขเครื่อง (machines.machine_no) ที่ใบงานวิ่ง — สำหรับไลน์ parallel_machine แยกเลนบนบอร์ด · null = ไม่ผูก';
