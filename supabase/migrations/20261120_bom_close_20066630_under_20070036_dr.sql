-- ═══ ปิดบรรทัด 20066630 ในใบ BOM ของ 20070036 (DR · Product DB · eyhclzkifitbhbljgoav) — 2026-11-20 · คำสั่ง user ═══
-- 20066630 = rev เก่า (RB3B-8C306-BB · ใช้ตั้งแต่ 06.12.2023) · 20070036 = rev ใหม่ (BC · 24.01.2025)
-- = พาร์ทระดับเดียวกัน ไม่ใช่แม่-ลูก (หลักฐาน: จอ CS03 ทั้ง 2 ตัว + CS12 FG306.XLSX ที่ user ส่งมา 19/11)
-- ถูกใส่เป็นลูกเมื่อ 13/08 ⇒ confirm 20070036 ตัด 20066630 เกินทุกครั้ง
-- ✅ apply แล้ว 20/11 (ตรวจกลับ: archive 1 · ยัง active 0 · confirm 20070036 = 12 บรรทัด · โซ่ขาด 2)
-- dry-run: confirm 20070036 เหลือ 12 บรรทัดตรง SAP · โซ่ขาด 2 ⇒ 2
-- ปิด ไม่ลบ · สำรอง archive.bom_items_close_20066630_20261120
-- ย้อน: update public.bom_items b set is_active = true from archive.bom_items_close_20066630_20261120 a where b.id = a.id;
-- ⚠️ ไม่ได้แตะ 3 แถวที่ห้อยใต้ 20066630 ในใบเดียวกัน (30052452 · 50029377 · 30052453) — user สั่งเฉพาะบรรทัดนี้
create schema if not exists archive;
create table if not exists archive.bom_items_close_20066630_20261120 as
  select b.* from public.bom_items b join public.dr_products p on p.id = b.product_id
   where p.mat_no = '20070036' and b.mat_no = '20066630' and b.parent_mat is null and b.is_active;
update public.bom_items b set is_active = false, updated_at = now()
  from archive.bom_items_close_20066630_20261120 a where b.id = a.id;
