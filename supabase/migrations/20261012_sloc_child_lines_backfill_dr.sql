-- DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-12 · audit SSOT ยอดสต็อก
-- ปัญหา: trigger fn_stock_txn_fill_sloc หา SLoc ด้วย storage_locations.line_names @> [line_name] ตรงตัว
--   แต่ทะเบียนผูกไว้ที่ "ไลน์แม่" (P411 = LINE APRON ASSY · P409 = HYDROFORM) ขณะที่ ledger เขียนด้วย
--   "ชื่อไลน์ลูก" (Line 60/61, HDF1, LASER E50) ⇒ แถวที่ฝั่ง DB/ฟังก์ชันเขียนได้ storage_location = null
--   ⇒ v_sloc_stock ยอดขาด (Line 60 466 แถว · Line 61 564 · LASER E50 13 · HDF1 1)
--   ฝั่ง client (`slocOfLine`) ไล่ขึ้นหาไลน์แม่ได้ จึงเกิดอาการ "ไลน์เดียวกันมีทั้ง P411 และ null"
-- แก้: DR ไม่มีลำดับชั้นไลน์ (production_lines อยู่ Main) ⇒ ใส่ชื่อไลน์ลูกลงทะเบียน SLoc ตรงๆ
--   (ผลเท่ากับการไล่หาแม่ทุกประการ — ไม่มีลูกตัวไหนผูก SLoc อื่นเอง) แล้วเติมแถวเก่าที่ว่าง
-- ลูกจาก production_lines (Main) ณ 12/10:
--   LINE APRON ASSY → Line 60 · Line 61 · SUB APRON
--   HYDROFORM       → BENDING E50 · BENDING EXPORT · HDF1 · HDF2 · LASER E50 · LASER EXPORT · LASER-345 · LASER-789
-- ⚠️ ไลน์ลูกที่เพิ่มทีหลัง ต้องเติมที่ /line-stock แท็บพื้นที่ (StorageLocPanel) ด้วย — จอนั้นนับแถวว่างให้เห็นอยู่แล้ว

create schema if not exists archive;

-- ภาพก่อนแก้ (ย้อนได้)
create table if not exists archive.lst_sloc_backfill_20261012 as
  select id, storage_location as old_sloc from public.line_stock_transactions
   where storage_location is null
     and line_name in ('Line 60','Line 61','SUB APRON',
                       'BENDING E50','BENDING EXPORT','HDF1','HDF2','LASER E50','LASER EXPORT','LASER-345','LASER-789');
alter table archive.lst_sloc_backfill_20261012 enable row level security;

create table if not exists archive.storage_locations_before_20261012 as
  select code, line_names from public.storage_locations where code in ('P411','P409');
alter table archive.storage_locations_before_20261012 enable row level security;

update public.storage_locations s
   set line_names = (select array_agg(distinct x order by x) from unnest(s.line_names || array['Line 60','Line 61','SUB APRON']) x)
 where s.code = 'P411';
update public.storage_locations s
   set line_names = (select array_agg(distinct x order by x) from unnest(s.line_names || array[
         'BENDING E50','BENDING EXPORT','HDF1','HDF2','LASER E50','LASER EXPORT','LASER-345','LASER-789']) x)
 where s.code = 'P409';

update public.line_stock_transactions t set storage_location = 'P411'
 where t.storage_location is null and t.line_name in ('Line 60','Line 61','SUB APRON');
update public.line_stock_transactions t set storage_location = 'P409'
 where t.storage_location is null and t.line_name in
   ('BENDING E50','BENDING EXPORT','HDF1','HDF2','LASER E50','LASER EXPORT','LASER-345','LASER-789');

-- เช็คผล:
--   select line_name, count(*) from line_stock_transactions where storage_location is null group by 1;  -- ต้องไม่มี Line 60/61/HDF1/LASER E50
--   select code, line_names from storage_locations where code in ('P411','P409');
-- ย้อน (ลำดับนี้):
--   update public.line_stock_transactions t set storage_location = null
--     from archive.lst_sloc_backfill_20261012 a where a.id = t.id;
--   update public.storage_locations s set line_names = a.line_names
--     from archive.storage_locations_before_20261012 a where a.code = s.code;
