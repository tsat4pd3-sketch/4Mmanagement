-- ══════════════════════════════════════════════════════════════════════════
-- ใบแจ้งซ่อม MO — วันเวลาที่เกิดเหตุจริง (แจ้งย้อนหลัง)                       2026-09-08
-- Project: DR (eyhclzkifitbhbljgoav)
--
-- ที่มา (feedback admin 2026-08-27): "กรอกข้อมูลวันที่มีแจ้งซ่อมได้ (MO) และเลือกประเภทการซ่อมได้ เช่น BM,PM"
--   · ประเภทการซ่อม: คอลัมน์ repair_type มีอยู่แล้ว — แค่เปิดให้ผู้แจ้งเลือกที่ขั้น 1 (ไม่แตะ schema)
--   · วันที่ย้อนหลัง: **ไม่ทับ report_at** เพราะ report_at = นาฬิกา KPI (Response/TTR) + DDMMYY ในเลข MO
--     + ลำดับรายการ — ทับแล้ว KPI เพี้ยนและเลข MO ไม่เรียงตามวัน จึงเพิ่ม occurred_at แยกเป็น "เวลาเกิดเหตุจริง"
-- additive · nullable (null = เกิดเหตุตอนกดแจ้ง) · ใบเก่าไม่กระทบ · โค้ดฝั่งเว็บถอยได้ถ้ายังไม่รัน (42703 → บันทึกโดยไม่เก็บ + เตือนบนจอ)
-- ══════════════════════════════════════════════════════════════════════════
alter table public.mtn_orders
  add column if not exists occurred_at timestamptz;

comment on column public.mtn_orders.occurred_at is
  'วันเวลาที่เกิดเหตุจริง (ผู้แจ้งกรอกเมื่อแจ้งย้อนหลัง) · null = เกิดเหตุตอนกดแจ้ง · ห้ามใช้แทน report_at ในสูตร KPI/เลข MO';

-- ตรวจผล:
--   select column_name, data_type from information_schema.columns
--    where table_name = 'mtn_orders' and column_name = 'occurred_at';   -- ต้องได้ 1 แถว
-- Rollback (ถอดโค้ดฝั่งเว็บก่อน):
--   alter table public.mtn_orders drop column occurred_at;
