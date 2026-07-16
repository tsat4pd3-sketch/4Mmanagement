-- ── DR project (eyhclzkifitbhbljgoav) ──
-- แก้ 🔴 จาก QC audit (กฎ A1 ฝั่ง SQL): fallback ของ work_date ใน trigger ใช้ current_date
-- ซึ่งบน Supabase คือ UTC — เพี้ยนช่วง 07:00-07:59 ไทย (UTC ข้ามวันแล้ว แต่ work date ไทย
-- ต้องยังเป็นเมื่อวานเพราะกะดึกจบ 08:00) และไม่ตัด 08:00 ตามกฎ getWorkDate()
-- สูตร work date ฝั่ง SQL: ((now() at time zone 'Asia/Bangkok') - interval '8 hours')::date
-- backward-compatible: เปลี่ยนเฉพาะ fallback — เส้นทางหลัก (work_date จาก session) เหมือนเดิม

-- helper กลาง — ใช้ซ้ำได้ทุก function/default ฝั่ง DR ที่ต้องการ work date
create or replace function work_date_bangkok() returns date
language sql stable as
$$ select ((now() at time zone 'Asia/Bangkok') - interval '8 hours')::date $$;

-- 1) fn_post_confirmed_output — post FG เข้า stock ตอนปิดออเดอร์ (เดิม fallback = current_date)
create or replace function fn_post_confirmed_output() returns trigger as $$
declare
  v_line text; v_workdate date; v_dest text; v_name text; v_qty numeric;
begin
  if NEW.status is distinct from 'confirmed' then return null; end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
  v_qty := coalesce(NEW.qty_ok, NEW.qty);
  if v_qty is null or v_qty <= 0 or NEW.mat_no is null then return null; end if;

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
end; $$ language plpgsql;

-- 2) purchase_requests.work_date default current_date (UTC) → work date ไทย
--    (กันเคส insert ที่ไม่ได้ส่ง work_date มา ได้วันผิดช่วง 07:00-07:59)
alter table purchase_requests alter column work_date set default work_date_bangkok();

-- Rollback: alter table purchase_requests alter column work_date set default current_date;
--           แล้ว re-apply function เดิมจาก 20260710_stock_inflow_on_confirm.sql
--           (drop function work_date_bangkok() ได้หลังไม่มีใครอ้างแล้ว)
