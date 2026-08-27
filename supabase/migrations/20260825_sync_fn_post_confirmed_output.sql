-- Sync เวอร์ชันจริงของ fn_post_confirmed_output จาก DB เข้ารีโป (QC flow-audit 2026-08-25 · finding #12)
-- Project: DR (eyhclzkifitbhbljgoav)
--
-- ที่มา: ไฟล์ migration ล่าสุดในรีโปที่ create or replace ฟังก์ชันนี้ (20260714) **ไม่มี OP guard**
-- ที่เพิ่มไปตรงบน DB ด้วย 20260820_op_items_never_enter_stock.sql — ใครยกร่าง/replay จากไฟล์เก่า
-- guard จะหายเงียบแล้วรายการขั้นตอน (OP) กลับมาโพสต์สต็อกปลอมอีก
-- ไฟล์นี้ = pg_get_functiondef ที่ dump จาก DB จริง 2026-08-25 (user รันให้) วางตรงตัว — **ห้ามเขียนใหม่จากความจำ**
--
-- ⚠️ ถ้า DB มีเวอร์ชันนี้อยู่แล้ว การรันซ้ำ = no-op (นิยามเดียวกัน) ปลอดภัย

CREATE OR REPLACE FUNCTION public.fn_post_confirmed_output()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_line text; v_workdate date; v_dest text; v_name text; v_qty numeric; v_is_op boolean;
begin
  if NEW.status is distinct from 'confirmed' then return null; end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
  v_qty := coalesce(NEW.qty_ok, NEW.qty);
  if v_qty is null or v_qty <= 0 or NEW.mat_no is null then return null; end if;

  -- 🔩 รายการขั้นตอน (OP) ไม่ใช่ของในคลัง — ข้ามเสมอ ห้ามพึ่งว่าชื่อจะไม่ตรง prefix rules
  select coalesce(is_operation, false) into v_is_op
    from dr_products where mat_no = NEW.mat_no limit 1;
  if coalesce(v_is_op, false) then return null; end if;

  if exists (select 1 from line_stock_transactions
             where ref_order_id = NEW.id and type = 'issue' and created_by = 'auto') then
    return null;
  end if;

  select dest_line_name into v_dest from stock_inflow_rules
   where is_active
     and ((match_type = 'mat' and match_value = NEW.mat_no)
       or (match_type = 'prefix' and left(NEW.mat_no, length(match_value)) = match_value))
   order by case when match_type = 'mat' then 0 else 1 end, length(match_value) desc
   limit 1;
  if v_dest is null then return null; end if;

  select ps.work_date, ps.line_name into v_workdate, v_line
    from production_sessions ps where ps.id = NEW.session_id;
  -- fallback = work date ไทย (ตัด 08:00) — ห้าม current_date (UTC)
  v_workdate := coalesce(v_workdate, work_date_bangkok());
  select name into v_name from dr_products where mat_no = NEW.mat_no and is_active limit 1;

  insert into line_stock_transactions
    (line_name, mat_no, part_name, qty, type, ref_session_id, ref_order_id, work_date, note, created_by)
  values
    (v_dest, NEW.mat_no, coalesce(v_name, NEW.part_name), v_qty, 'issue',
     NEW.session_id, NEW.id, v_workdate,
     'auto: ปิดออเดอร์ ' || coalesce(NEW.prod_no, '') || ' จากไลน์ ' || coalesce(v_line, '-'), 'auto');
  return null;
end; $function$;
