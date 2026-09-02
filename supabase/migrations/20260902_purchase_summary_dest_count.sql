-- ═══ v_purchase_open_summary — บอกด้วยว่ากลุ่มนี้มีหลายปลายทาง/หลายซัพพลายเออร์ไหม ═══
--
-- ที่มา (2026-09-02): วิวนี้ group ด้วย (mat_no, status) แล้วเอา min(dest_line)/min(supplier)
-- มาโชว์ ⇒ กลุ่มที่ใบกระจายหลายไลน์ **การ์ดโชว์ไลน์เดียว = โกหกเงียบ**
--
-- วัดจริง 2026-09-02: 8 จาก 25 กลุ่มมีหลายปลายทาง และเป็นกลุ่มใหญ่ทั้งนั้น
--   50031601  609 ใบ → 5 ปลายทาง (HDF2 · LASER-789 · LASER123 · Line 60 · Line 61) · 2 ซัพพลายเออร์
--   30045438  384 ใบ → 3 ปลายทาง (Assy GOR · Line 60 · Line 61)
--   30042570  198 ใบ → 2 · 30044771 180 ใบ → 4 · 30042571 109 ใบ → 3
--
-- ⚠️ สำคัญกับปุ่ม "รับเข้ารวมยอด" — ถ้ายึด dest_line บนการ์ดโพสต์สต็อกทีเดียว
--    ของจะเข้าไลน์เดียวทั้งที่ใบสั่งกระจายไป 3-5 ไลน์ = สต็อกผิดทั้งกระดาน ย้อนยาก
--    ⇒ ตัวรับเข้าต้องจัดกลุ่มตาม dest_line ของ "ใบจริงที่อัปเดตสำเร็จ" เสมอ
--
-- additive ล้วน (เพิ่ม 2 คอลัมน์) — โค้ดเดิมที่ select * หรือระบุคอลัมน์เดิมไม่กระทบ
-- rollback: create or replace view โดยตัด 2 คอลัมน์ท้ายออก

create or replace view public.v_purchase_open_summary as
  select
    mat_no,
    status,
    min(part_name)                              as part_name,
    min(supplier)                               as supplier,
    min(dest_line)                              as dest_line,
    count(*)::integer                           as slips,
    sum(qty)                                    as total_qty,
    min(qty)                                    as min_lot,
    max(qty)                                    as max_lot,
    min(created_at)                             as first_at,
    (array_agg(id ORDER BY created_at))[1]      as first_id,
    (array_agg(work_date ORDER BY created_at))[1] as first_work_date,
    -- ⬇️ ใหม่: จำนวนปลายทาง/ซัพพลายเออร์ที่ต่างกันในกลุ่ม (1 = ตรงกับที่การ์ดโชว์ · >1 = ต้องกางดู)
    count(distinct coalesce(dest_line, ''))::integer as dest_count,
    count(distinct coalesce(supplier, ''))::integer  as supplier_count
  from public.purchase_requests
  where status <> 'cancelled'
  group by mat_no, status;
