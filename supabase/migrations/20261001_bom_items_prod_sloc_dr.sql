/* 📥 นำเข้า BOM จาก SAP — เก็บ "Prod.SLoc" แยกจาก "Stor. Loc." (DR "Product DB" eyhclzkifitbhbljgoav)
   2026-10-01 · คำสั่ง user: *"เราเห็นแน่ๆ column storage location 1"*

   ใบ Display Multilevel BOM ของ SAP มี SLoc **2 ช่อง** ต่อบรรทัด:
     · Prod.SLoc  = คลังที่ "ผลิตเบิกไปใช้" (เช่น S406 · P405)
     · Stor. Loc. = คลังที่ "เก็บของ"      (เช่น P410 · S402)
   ESM มีช่องเดียว (`storage_location`) ⇒ นำเข้าแล้วข้อมูลหาย 1 ช่อง
   ⇒ เพิ่ม `prod_sloc` · **`storage_location` ความหมายเดิมไม่เปลี่ยน** (= Stor. Loc.)
     ทุกจอที่อ่าน `storage_location` อยู่แล้วไม่ต้องแก้ · แถวเดิมทั้งหมด prod_sloc = null (ไม่มีใครเปลี่ยนค่า)
*/
alter table public.bom_items add column if not exists prod_sloc text;

comment on column public.bom_items.prod_sloc is
  'SAP Prod.SLoc — คลังที่ผลิตเบิกไปใช้ (คนละช่องกับ storage_location = Stor. Loc. ที่เก็บ)';

-- ตรวจหลังรัน:
-- select count(*) filter (where prod_sloc is not null) as มีค่า, count(*) as ทั้งหมด from public.bom_items;
