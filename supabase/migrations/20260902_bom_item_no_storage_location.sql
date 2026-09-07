-- ═══ bom_items: เลขรายการ (Item 0010/0020) + คลังที่เบิก (Storage Location) ═══
--
-- ที่มา (2026-09-02 · user เทียบกับจอ SAP Display Multilevel BOM):
--   "ในsap จะมี รหัส storage location เพื่อควบคุม ของเราน่าจะยังไม่มี
--    และก็ ที่เห็น 0010 0020 ช่อง item ... ถ้าอยู่ชั้นเดียวกัน ก็จะนับ 0010 0020 0030
--    แต่ถ้าลูกของ 0030 ก็จะนับไป 0010"
--
-- ตรวจ schema จริงก่อนทำแล้ว — ทั้ง 2 อย่างไม่มีในระบบเลย:
--   bom_items          : id, product_id, mat_no, part_name, qty_per_unit, uom, supplier,
--                        note, is_active, created_by, created_at, updated_at,
--                        part_no, qty_per_pkg, source_line      ← ไม่มี item/seq/sloc
--   purchase_requests  : มีแค่ dest_line (ชื่อไลน์ ไม่ใช่รหัสคลัง)
--   line_stock_*       : มีแค่ line_name (STORE / FG WAREHOUSE / ชื่อไลน์)
--
-- ⚠️ storage_zones (WMS เฟส 1) ไม่ใช่ตัวนี้ — นั่นคือ "ทะเบียนโซนกองของในคลัง"
--    ส่วนนี่คือ "ชิ้นส่วนบรรทัดนี้เบิกจากคลังไหน" ผูกกับ BOM รายบรรทัด **ห้ามยุบรวมกัน**
--
-- ═══ นิยาม ═══
-- item_no (integer)
--   • เลขรายการในใบ BOM ของ "ตัวแม่ตัวนั้น" — **นับใหม่ทุกตัวแม่ ไม่ใช่นับต่อเนื่องทั้งใบ**
--     (SAP: ชั้น .1 วิ่ง 0010→0120 · ใต้ 20066660 เริ่ม 0010 ใหม่ · ใต้ 20066662 ก็ 0010 ใหม่)
--   • เก็บเป็น integer ไม่ใช่ text → เรียงลำดับถูกเสมอ แม้คนกรอก 10 แทน 0010
--     แสดงผลเติมศูนย์หน้าเป็น 4 หลักด้วย itemNoLabel() ฝั่ง client
--   • ธรรมเนียม SAP เว้นทีละ 10 (0010/0020/0030) เพื่อให้แทรกกลางได้ — nextItemNo() ทำตามนี้
--   • **null = ยังไม่ได้ตั้ง (ไม่ใช่ 0)** — ของเก่าทั้ง 459 แถวเป็น null ทั้งหมด ห้าม backfill เดา
--     ลำดับที่ถูกต้องเป็นความรู้ของ PE (SAP เรียงตามลำดับประกอบ ไม่ใช่ตามเลข mat)
--
-- storage_location (text)
--   • รหัสคลังที่เบิกชิ้นส่วนบรรทัดนี้ (SAP: Stor.Loc. / Prod.SLoc — 4 ตัวอักษร)
--   • **null = ยังไม่ระบุ** → ระบบยังใช้พฤติกรรมเดิม (เบิกจาก line_name/STORE) เหมือนไม่มีคอลัมน์นี้
--
-- ⚠️⚠️ additive ล้วน — **ยังไม่มีอะไรอ่าน 2 คอลัมน์นี้ไปตัดสต็อก**
--    fn_explode_child_demand ยังหักจาก line_stock_summary ด้วย line_name เหมือนเดิมทุกประการ
--    (ผูก SLoc เข้าเส้นทางตัดสต็อกเป็นงานแยก ต้องคุยกับสโตร์ว่าจะ map รหัสคลังกับ location เดิมยังไง)
--    ⇒ deploy แล้วพฤติกรรมระบบไม่เปลี่ยนเลย ใครไม่กรอกก็ไม่กระทบ
--
-- rollback:
--   drop index if exists bom_items_product_item_uniq;
--   alter table public.bom_items drop column if exists item_no, drop column if exists storage_location;

alter table public.bom_items
  add column if not exists item_no         integer,
  add column if not exists storage_location text;

comment on column public.bom_items.item_no is
  'เลขรายการในใบ BOM ของตัวแม่ (SAP Item 0010/0020) — นับใหม่ทุกตัวแม่ · null = ยังไม่ตั้ง';
comment on column public.bom_items.storage_location is
  'รหัสคลังที่เบิกชิ้นส่วนบรรทัดนี้ (SAP Stor.Loc.) — null = ยังไม่ระบุ ใช้พฤติกรรมเดิม';

-- เลขรายการต้องเป็นบวกและอยู่ในช่วงที่ SAP รับได้ (ฟิลด์ 4 ตัวอักษร)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bom_items_item_no_range') then
    alter table public.bom_items
      add constraint bom_items_item_no_range
      check (item_no is null or (item_no > 0 and item_no <= 9999));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bom_items_sloc_len') then
    alter table public.bom_items
      add constraint bom_items_sloc_len
      check (storage_location is null or char_length(storage_location) between 1 and 20);
  end if;
end $$;

-- 1 ตัวแม่ = 1 เลขรายการ ห้ามซ้ำ (partial → แถวที่ยังไม่ตั้งเลขยังอยู่ร่วมกันได้)
create unique index if not exists bom_items_product_item_uniq
  on public.bom_items (product_id, item_no)
  where item_no is not null;

-- เรียงตามเลขรายการเร็วขึ้น (ตารางเรียง item_no ก่อน mat_no)
create index if not exists bom_items_product_item_idx
  on public.bom_items (product_id, item_no);
