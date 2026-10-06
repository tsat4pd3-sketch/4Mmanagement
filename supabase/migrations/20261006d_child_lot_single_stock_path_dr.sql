-- DR project ("Product DB" · eyhclzkifitbhbljgoav)
-- 2026-10-06 · คำสั่ง user (ช่องโหว่สโตร์ข้อ 3): "ให้เหลือทางปิดล็อตที่บอร์ดสโตร์"
--
-- ของ child ที่สโตร์คุมเป็นล็อต (`child_lot_requests`) เคยลงสต็อก 2 ทาง:
--   (1) ปิดล็อตที่ /heijunka → `issue` ที่ source_line (advanceLot ใน HeijunkaKanban.jsx)
--   (2) ไลน์ปั๊มปิดใบผลิต 2xx → trigger นี้ → ใบรอรับ `stock_receipts` เข้า STORE (เดิม: issue ตรง)
--   ⇒ ของก้อนเดียวกันโผล่ 2 ที่ (ไม่มีคอลัมน์ผูก child_lot_requests ↔ prod_orders ให้รู้ว่าซ้ำ)
-- ⇒ trigger ข้าม MAT ที่มีใบล็อต (ไม่นับ cancelled) · MAT อื่นทำงานเหมือนเดิมทุกอย่าง
--
-- ย้อนกลับ: รันนิยามเดิมจาก 20261002_stock_receipts_confirm_dr.sql (หรือลบบล็อก "06/10" ด้านล่างออก)

create or replace function public.fn_post_confirmed_output()
 returns trigger
 language plpgsql
as $function$
declare
  v_line text; v_workdate date; v_dest text; v_mode text; v_name text; v_qty numeric; v_is_op boolean;
  v_partial boolean := false;
begin
  if NEW.status = 'confirmed' then
    if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
    v_qty := coalesce(NEW.qty_ok, NEW.qty);
  elsif TG_OP = 'UPDATE' and NEW.status in ('carry_over', 'cancelled')
        and OLD.status is distinct from NEW.status then
    v_qty := NEW.qty_actual;
    v_partial := true;
  else
    return null;
  end if;
  if v_qty is null or v_qty <= 0 or NEW.mat_no is null then return null; end if;

  select coalesce(is_operation, false) into v_is_op
    from dr_products where mat_no = NEW.mat_no limit 1;
  if coalesce(v_is_op, false) then return null; end if;

  -- 06/10 — child ที่สโตร์คุมเป็นล็อต: สต็อกเข้าทางปิดล็อตที่บอร์ดสโตร์ทางเดียว (คำสั่ง user)
  if exists (select 1 from child_lot_requests
             where child_mat_no = NEW.mat_no and status <> 'cancelled') then
    return null;
  end if;

  if exists (select 1 from line_stock_transactions
             where ref_order_id = NEW.id and type = 'issue' and created_by = 'auto') then
    return null;
  end if;
  if exists (select 1 from stock_receipts
             where prod_order_id = NEW.id and status in ('pending', 'received')) then
    return null;
  end if;

  select dest_line_name, mode into v_dest, v_mode from stock_inflow_rules
   where is_active
     and ((match_type = 'mat' and match_value = NEW.mat_no)
       or (match_type = 'prefix' and left(NEW.mat_no, length(match_value)) = match_value))
   order by case when match_type = 'mat' then 0 else 1 end, length(match_value) desc
   limit 1;
  if v_dest is null then return null; end if;

  select ps.work_date, ps.line_name into v_workdate, v_line
    from production_sessions ps where ps.id = NEW.session_id;
  v_workdate := coalesce(v_workdate, work_date_bangkok());
  select name into v_name from dr_products where mat_no = NEW.mat_no and is_active limit 1;

  if v_mode = 'confirm' then
    insert into stock_receipts
      (prod_order_id, prod_no, mat_no, part_name, qty_expected, dest_line_name, source_line,
       ref_session_id, work_date, partial_reason)
    values
      (NEW.id, NEW.prod_no, NEW.mat_no, coalesce(v_name, NEW.part_name), v_qty, v_dest, v_line,
       NEW.session_id, v_workdate,
       case when v_partial then (case when NEW.status = 'cancelled' then 'ยกเลิกใบ' else 'ยกยอดข้ามกะ' end) end);
    return null;
  end if;

  insert into line_stock_transactions
    (line_name, mat_no, part_name, qty, type, ref_session_id, ref_order_id, work_date, note, created_by)
  values
    (v_dest, NEW.mat_no, coalesce(v_name, NEW.part_name), v_qty, 'issue',
     NEW.session_id, NEW.id, v_workdate,
     case when v_partial
       then 'auto: '||(case when NEW.status = 'cancelled' then 'ยกเลิกใบ' else 'ยกยอดข้ามกะ' end)
            ||' '||coalesce(NEW.prod_no, '')||' — ยอดทำจริงบางส่วน '||round(v_qty)||' ชิ้น จากไลน์ '||coalesce(v_line, '-')
       else 'auto: ปิดออเดอร์ '||coalesce(NEW.prod_no, '')||' จากไลน์ '||coalesce(v_line, '-')
     end, 'auto');
  return null;
end; $function$;

-- เร่งการเช็ค (ตารางเล็ก แต่ trigger ยิงทุกครั้งที่ปิดใบผลิต)
create index if not exists child_lot_requests_child_mat_no_idx on public.child_lot_requests (child_mat_no);
