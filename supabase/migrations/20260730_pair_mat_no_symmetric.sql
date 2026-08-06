-- F6 (single-source audit) — dr_products.pair_mat_no ต้อง symmetric ทั้ง 2 แถว (A→B และ B→A)
-- UI (ProductMaster) รักษา symmetric อยู่แล้ว แต่ CSV import / แก้ตรง DB / ลบคู่ ทำข้างเดียวได้
-- → OEE นับ run time ซ้ำ 2 เท่า, บอร์ด Heijunka วางเลน RH/LH เพี้ยน (ดู CLAUDE.md กฎงานคู่ RH/LH)
-- trigger นี้บังคับ symmetric ฝั่ง server กันทุก write · DR project (eyhclzkifitbhbljgoav)
-- backward-compatible: additive · rollback = drop trigger + function (ด้านล่าง)
-- ไม่แตะข้อมูลเดิม (fix เฉพาะ write ต่อจากนี้) — ถ้าอยาก symmetrize ของเดิมค่อยรันแยกหลัง validate

create or replace function fn_sync_pair_mat_no() returns trigger
language plpgsql as $$
begin
  -- 1) ล้าง back-reference เก่า: แถวที่เคยชี้มาหาแถวนี้ แต่ตอนนี้ไม่ใช่คู่แล้ว
  update dr_products d set pair_mat_no = null
   where d.pair_mat_no = NEW.mat_no
     and d.mat_no <> coalesce(NEW.pair_mat_no, '')
     and d.pair_mat_no is not null;
  -- 2) ตั้ง back-reference ของคู่ใหม่ให้ชี้กลับมาหาแถวนี้ (ถ้ายังไม่ตรง)
  --    เมื่อ symmetric แล้ว เงื่อนไข is distinct ทำให้ไม่มีแถวถูก update → trigger ลูกไม่ re-fire (กัน recursion)
  if NEW.pair_mat_no is not null and NEW.pair_mat_no <> NEW.mat_no then
    update dr_products d set pair_mat_no = NEW.mat_no
     where d.mat_no = NEW.pair_mat_no
       and d.pair_mat_no is distinct from NEW.mat_no;
  end if;
  return null; -- AFTER trigger
end $$;

drop trigger if exists trg_sync_pair_mat_no on dr_products;
create trigger trg_sync_pair_mat_no
  after insert or update of pair_mat_no on dr_products
  for each row execute function fn_sync_pair_mat_no();

-- rollback:
--   drop trigger if exists trg_sync_pair_mat_no on dr_products;
--   drop function if exists fn_sync_pair_mat_no();
