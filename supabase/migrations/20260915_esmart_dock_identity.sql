-- ═══════════════════════════════════════════════════════════════════════════════
-- e-SMART: dock = ส่วนหนึ่งของ "เที่ยวรถ" (DR project · eyhclzkifitbhbljgoav "Product DB")
--
-- 🔴 ที่มา (เกิดจริง 2026-09-15 08:15 — logistic แจ้ง "อัพไฟล์สองทีไม่ได้"):
--    ลูกค้าเปลี่ยนมาแยกไฟล์ e-SMART **ต่อ dock** (B1 ไฟล์หนึ่ง · B5 อีกไฟล์หนึ่ง)
--    อัพติดกัน 2 ไฟล์ ช่วงเวลาเดียวกัน ⇒ ได้ ship_time เดียวกัน ⇒
--      batch 05c163a3 (dock B1) → สร้าง 3 ใบสำเร็จ
--      batch 4d818c42 (dock B5) → **สร้าง 0 · อัพเดท 0** (10 แถวหลักฐาน 125 ชิ้น เข้าครบ แต่ไม่มีใบ)
--    เพราะ unique index ของใบ e-SMART ไม่มี dock ⇒ ใบที่ 2 ชน 23505 ทุกตัว
--    ⇒ อาการที่หน้างานเห็น = "บาง part no หายไป"
--
-- แก้: ใส่ dock เข้า identity ทั้ง 2 ชั้น + เก็บ dock ของไฟล์ไว้ที่ batch
-- ⚠️ index ใหม่ **หลวมกว่าเดิม** (อนุญาตแถวได้มากขึ้น) ⇒ ไม่มีทางล้มกับข้อมูลเดิม
--    ใบเก่าที่ dock_code เป็น null → coalesce เป็น '' = พฤติกรรมเดิมเป๊ะ
-- rollback: drop index ใหม่ แล้ว create index เดิมกลับ (SQL ท้ายไฟล์)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) ใบส่ง: 1 พาร์ท × 1 รอบ × 1 dock = 1 ใบ
drop index if exists customer_shipping_orders_esmart_slot_uniq;
create unique index if not exists customer_shipping_orders_esmart_slot_uniq
  on public.customer_shipping_orders (customer, due_date, ship_time, mat_no, coalesce(dock_code, ''))
  where source = 'esmart';

-- 2) แถวหลักฐาน: พาร์ทเดียวกัน วินาทีเดียวกัน แต่คนละ dock = คนละการดึง ห้ามถูกกลืนเป็นซ้ำ
drop index if exists customer_pull_signals_dedup_idx;
create unique index if not exists customer_pull_signals_dedup_idx
  on public.customer_pull_signals (source, ship_to, customer_part_no, pulled_at, coalesce(dock_code, ''));

-- 3) batch จำ dock ของไฟล์ — ใช้แยก "อัพซ้ำจริง" ออกจาก "ไฟล์คนละ dock ช่วงเวลาเดียวกัน"
alter table public.customer_pull_batches add column if not exists dock_code text;

-- backfill จาก dock ที่พบมากที่สุดในแถวหลักฐานของ batch นั้น (เกณฑ์เดียวกับที่ตัวอ่านไฟล์ใช้)
update public.customer_pull_batches b
   set dock_code = d.dock_code
  from (
    select distinct on (batch_id) batch_id, dock_code
      from public.customer_pull_signals
     where batch_id is not null and coalesce(dock_code, '') <> ''
     group by batch_id, dock_code
     order by batch_id, count(*) desc, dock_code
  ) d
 where d.batch_id = b.id and b.dock_code is null;

-- ── rollback ───────────────────────────────────────────────────────────────────
-- drop index if exists customer_shipping_orders_esmart_slot_uniq;
-- create unique index customer_shipping_orders_esmart_slot_uniq
--   on public.customer_shipping_orders (customer, due_date, ship_time, mat_no) where source = 'esmart';
-- drop index if exists customer_pull_signals_dedup_idx;
-- create unique index customer_pull_signals_dedup_idx
--   on public.customer_pull_signals (source, ship_to, customer_part_no, pulled_at);
-- alter table public.customer_pull_batches drop column if exists dock_code;

-- ── ตามด้วยทันที (แยกออกมาเพราะ onConflict ของ PostgREST อ้างคอลัมน์ล้วนเท่านั้น) ─────────
-- index แบบ expression `coalesce(dock_code,'')` ทำให้ upsert แถวหลักฐานโยน 42P10
-- แล้ว **ไม่บันทึกอะไรเลย** (กับดักเดิมจาก 2026-09-09) ⇒ ทำคอลัมน์เป็น NOT NULL DEFAULT ''
update public.customer_pull_signals set dock_code = '' where dock_code is null;
alter table public.customer_pull_signals alter column dock_code set default '';
alter table public.customer_pull_signals alter column dock_code set not null;
drop index if exists customer_pull_signals_dedup_idx;
create unique index customer_pull_signals_dedup_idx
  on public.customer_pull_signals (source, ship_to, customer_part_no, pulled_at, dock_code);
