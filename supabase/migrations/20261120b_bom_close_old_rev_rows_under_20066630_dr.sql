-- ═══ ปิด 3 แถวที่ห้อยใต้ 20066630 (rev เก่า BB) ในใบ BOM ของ 20070036 (DR · Product DB · eyhclzkifitbhbljgoav) — 2026-11-20 · คำสั่ง user ═══
-- ต่อจาก 20261120_bom_close_20066630_under_20070036_dr.sql (ปิดตัวแม่ 20066630 ไปแล้ว ⇒ 3 แถวนี้ค้างในใบ)
-- 30052452 (RB3B-8B224-AA) · 30052453 (RB3B-8B225-AA) · 50029377 = ของรุ่นเก่าตาม CS03 ของ 20066630
-- (รุ่นใหม่ในใบ 20070036 = 30054973 / 30054974 / 50031625) — user ดูรูปจากข้อมูลจริงแล้วสั่งปิด
-- ✅ apply แล้ว 20/11 (ตรวจกลับ: archive 3 แถว · ใบ 20070036 เหลือ 12 แถว = ตรง CS03 · confirm 12 บรรทัด · โซ่ขาด 0)
-- dry-run: ปิด 3 แถว · ผลตัดจ่ายทุกสินค้าเท่าเดิม · โซ่ขาด 2 ⇒ 0 (2 รายการที่เหลือคือแถวค้างพวกนี้)
-- ปิด ไม่ลบ · สำรอง archive.bom_items_close_old_rev_20261120
-- ย้อน: update public.bom_items b set is_active = true from archive.bom_items_close_old_rev_20261120 a where b.id = a.id;
create schema if not exists archive;
create table if not exists archive.bom_items_close_old_rev_20261120 as
  select b.* from public.bom_items b join public.dr_products p on p.id = b.product_id
   where p.mat_no = '20070036' and upper(btrim(b.parent_mat)) = '20066630' and b.is_active;
update public.bom_items b set is_active = false, updated_at = now()
  from archive.bom_items_close_old_rev_20261120 a where b.id = a.id;
