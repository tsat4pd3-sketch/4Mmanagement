/* 🔑 เลขรายการ (item_no) ซ้ำได้ "ข้ามตัวแม่" — DR "Product DB" (eyhclzkifitbhbljgoav)
   2026-10-01 · เจอตอนนำเข้า BOM หลายชั้นจาก SAP ใบ 10105769

   migration `20260902_bom_item_no_storage_location.sql` เขียนคอมเมนต์ไว้ถูกแล้วว่า
     "เลขรายการในใบ BOM ของตัวแม่ (SAP Item 0010/0020) — **นับใหม่ทุกตัวแม่**" · "1 ตัวแม่ = 1 เลขรายการ"
   แต่ index ที่สร้างจริงเป็น `(product_id, item_no)` = **1 ใบ = 1 เลขรายการ** (ลืมมิติตัวแม่)

   ⇒ BOM หลายชั้นของ SAP ชน index ทันที: ใบ 10105769 มี `0010` ที่ชั้น 1 (30044771)
     และ `0010` ที่ชั้น 2 ใต้ 20058490 กับใต้ 20058491 (50027085 ทั้งคู่) = เลขเดียวกัน 3 แถว
     → `duplicate key value violates unique constraint "bom_items_product_item_uniq"`

   แก้: ใส่ `coalesce(parent_mat,'')` เข้าไปในคีย์ ให้ตรงกับเจตนาเดิม
   ⚠️ index ใหม่ **หลวมกว่าเดิม** (คีย์ยาวขึ้น) ⇒ แถวที่ผ่าน index เก่าได้ ผ่านอันใหม่ทั้งหมด — ไม่มีข้อมูลเดิมพัง
*/
drop index if exists public.bom_items_product_item_uniq;

create unique index if not exists bom_items_product_parent_item_uniq
  on public.bom_items (product_id, coalesce(parent_mat, ''::text), item_no)
  where item_no is not null;

-- ตรวจหลังรัน (ต้องได้ 0 แถว):
-- select product_id, coalesce(parent_mat,'') pm, item_no, count(*)
--   from public.bom_items where item_no is not null
--  group by 1,2,3 having count(*) > 1;

/* rollback:
   drop index if exists public.bom_items_product_parent_item_uniq;
   create unique index bom_items_product_item_uniq on public.bom_items (product_id, item_no) where item_no is not null;
   ⚠️ ย้อนแล้วต้องเคลียร์ item_no ที่ซ้ำข้ามตัวแม่ก่อน ไม่งั้นสร้าง index เก่าไม่ขึ้น */
