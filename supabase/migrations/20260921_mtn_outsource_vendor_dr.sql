-- ═══════════════════════════════════════════════════════════════════════════
-- ส่งซ่อมภายนอก (supplier) บนใบแจ้งซ่อม MO   (DR · eyhclzkifitbhbljgoav)
-- 2026-09-21 · คำถามทีมหน้างาน "ซ่อมเองไม่ได้ ต้องเรียก supplier มาแก้ นับเวลายังไง"
-- user เคาะ: (1) หักช่วงรอ supplier ออกจาก MTTR ของช่าง
--            (2) ต้องเป็น **สถานะของตัวเอง** ให้ผู้แจ้งเห็น ไม่งั้น "ดองไว้ที่ช่างไม่มีใครรู้"
--            (3) ค่าใช้จ่ายลงช่องเดิม (ค่าแรง `mtn_order_labor` / ค่าอะไหล่ `parts_cost`)
--
-- 🔴 นาฬิกาเครื่อง ≠ นาฬิกาช่าง — downtime ของไลน์ยังนับเต็มเหมือนเดิม **ห้ามหยุด**
--    (หยุดนับ = OEE โกหก) · หักเฉพาะ MTTR ของช่าง · สูตรอยู่ `src/utils/mtnVendor.js` ที่เดียว
--
-- `status` ของ mtn_orders เป็น text ไม่มี check constraint ⇒ เพิ่มค่า 'waiting_vendor'
-- ได้โดยไม่ต้องแตะ schema (ป้าย/สี/ลำดับขั้น อยู่ `src/utils/mtnStepPerm.js`)
-- ⚠️ ไม่เพิ่ม `mtn_repair_types` แถว "Outsource" โดยตั้งใจ — งานที่ส่งออกนอกก็ยังเป็น
--    Breakdown/Preventive อยู่ดี · เอา 2 แกนมาปนกันแล้วสถิติประเภทงานจะเพี้ยน
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.mtn_orders add column if not exists supplier        text;
alter table public.mtn_orders add column if not exists vendor_sent_at  timestamptz;
alter table public.mtn_orders add column if not exists vendor_back_at  timestamptz;
alter table public.mtn_orders add column if not exists vendor_note     text;
alter table public.mtn_orders add column if not exists vendor_sent_by  text;
alter table public.mtn_orders add column if not exists vendor_back_by  text;

comment on column public.mtn_orders.supplier is
  'ผู้รับจ้างภายนอกที่ส่งไปซ่อม (suppliers.name — เก็บ text ไม่ผูก FK ตาม convention ทะเบียน 2026-09-08)';
comment on column public.mtn_orders.vendor_sent_at is
  'เวลาที่ส่งของออกไปให้ supplier — เริ่มนับช่วงที่ต้องหักออกจาก MTTR ของช่าง (src/utils/mtnVendor.js)';
comment on column public.mtn_orders.vendor_back_at is
  'เวลาที่ของกลับเข้าโรงงาน — ว่าง = ยังอยู่ข้างนอก (นาฬิกายังเดิน)';

-- ใบที่ค้างอยู่กับ supplier = งานที่ต้องตามทุกวัน ⇒ ดัชนีสำหรับคิว/จอเฝ้าดู
create index if not exists idx_mtn_orders_waiting_vendor
  on public.mtn_orders (vendor_sent_at)
  where vendor_back_at is null and vendor_sent_at is not null;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════════════════
--   select count(*) from information_schema.columns
--    where table_name='mtn_orders' and column_name in
--      ('supplier','vendor_sent_at','vendor_back_at','vendor_note','vendor_sent_by','vendor_back_by');  -- 6
--   select status, count(*) from mtn_orders group by 1 order by 2 desc;   -- ยังไม่มี waiting_vendor
--
-- ═══ ROLLBACK ══════════════════════════════════════════════════════════════
--   update public.mtn_orders set status='repairing' where status='waiting_vendor';
--   drop index if exists public.idx_mtn_orders_waiting_vendor;
--   alter table public.mtn_orders
--     drop column if exists supplier, drop column if exists vendor_sent_at,
--     drop column if exists vendor_back_at, drop column if exists vendor_note,
--     drop column if exists vendor_sent_by, drop column if exists vendor_back_by;
