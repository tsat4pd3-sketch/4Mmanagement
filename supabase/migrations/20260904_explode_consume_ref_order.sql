-- 20260904_explode_consume_ref_order.sql  ·  ⚠️ DR project (eyhclzkifitbhbljgoav)
-- full QC audit รอบ 10 — fn_explode_child_demand เขียนแถว consume (ตัดชิ้นส่วนจาก mini-store ตอนปิดใบ FG)
-- โดยไม่ stamp ref_order_id / ref_session_id เลย → หน้า "สอบกลับ Order" (OrderTrace) ดึงสต็อกด้วย ref_order_id เท่านั้น
-- = การตัดชิ้นส่วนของใบนั้น "มองไม่เห็นทั้งหมด" ทั้งที่เป็นข้อมูลเดียวที่บอกว่าใบนี้กินลูกอะไรไปเท่าไหร่
-- วัดจริง 2026-09-04: consume auto 2,247 แถว ref_order_id เป็น null ทั้งหมด (ส.ค. 1,192 · ก.ย. 1,055)
-- แก้ 2 ชั้น:
--   (1) trigger stamp ref_order_id = NEW.id · ref_session_id = NEW.session_id ตั้งแต่ตอนเขียน (ทางเดียวกับแถว issue ของ fn_post_confirmed_output)
--   (2) backfill ของเก่า: จับคู่ note 'auto: FG <prod_no> ใช้ mini-store' + ไลน์ + work_date กับ prod_orders/production_sessions
--       ตรงตัว 1 ใบ = 2,212 แถว → เติม · กำกวม (prod_no ซ้ำในวัน/ไลน์เดียวกัน) 29 + หาไม่เจอ 6 → ปล่อย null ไม่เดา
-- ผลข้างเคียงที่เช็คแล้ว: guard กันโพสต์ซ้ำ (fn_post_confirmed_output) และปุ่ม "ถอยใบ" (DailyReport) กรอง type='issue' เท่านั้น
--   → แถว consume ที่มี ref_order_id แล้วไม่ถูกลบ/นับซ้ำ · dedupe ของ explode ยังใช้ child_demand_explosions เหมือนเดิม
-- rollback: create or replace ฟังก์ชันจาก 20260825_partial_output_and_explode_dedup.sql (ref ที่ backfill แล้วปล่อยไว้ได้ — nullable)
begin;

create or replace function public.fn_explode_child_demand()
returns trigger
language plpgsql
as $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; r record; p record;
  v_gross numeric; v_onhand numeric; v_consume numeric; v_short numeric;
  v_lot integer; v_pending numeric; v_lotid uuid; v_supplier text; v_srcline text;
  v_made int; v_qty numeric; v_is_op boolean;
  MAX_LOTS constant int := 50;
begin
  if NEW.status = 'confirmed' then
    if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
    v_qty := NEW.qty;
  elsif TG_OP = 'UPDATE' and NEW.status in ('carry_over', 'cancelled')
        and OLD.status is distinct from NEW.status then
    v_qty := NEW.qty_actual;
  else
    return null;
  end if;
  if v_qty is null or v_qty <= 0 then return null; end if;

  begin
    insert into public.child_demand_explosions(order_id) values (NEW.id);
  exception when unique_violation then
    return null;
  end;

  select ps.line_name, ps.work_date into v_line, v_workdate
    from production_sessions ps where ps.id = NEW.session_id;

  select id, name, coalesce(is_operation, false) into v_fg, v_fgname, v_is_op
    from dr_products where mat_no = NEW.mat_no and is_active limit 1;
  if v_fg is null then return null; end if;
  if v_is_op then return null; end if;

  for b in select * from bom_items where product_id = v_fg and is_active loop
    v_gross := v_qty * b.qty_per_unit;
    select coalesce(qty_on_hand,0) into v_onhand
      from line_stock_summary where line_name = v_line and mat_no = b.mat_no;
    if v_onhand is null then v_onhand := 0; end if;
    v_consume := least(v_onhand, v_gross);
    if v_consume < 0 then v_consume := 0; end if;
    v_short := v_gross - v_consume;
    if v_consume > 0 then
      -- 2026-09-04: stamp ref_order_id/ref_session_id ให้สอบกลับได้ (OrderTrace ดึงด้วย ref_order_id)
      insert into line_stock_transactions(line_name, mat_no, part_name, qty, type, work_date, note, created_by,
                                          ref_order_id, ref_session_id)
        values (v_line, b.mat_no, b.part_name, v_consume, 'consume', v_workdate,
                'auto: FG '||coalesce(NEW.prod_no,'')||' ใช้ mini-store', 'auto',
                NEW.id, NEW.session_id);
    end if;
    if v_short <= 0 then continue; end if;
    insert into child_demand_accumulator(child_mat_no, pending_qty, updated_at)
      values (b.mat_no, v_short, now())
    on conflict (child_mat_no) do update
      set pending_qty = child_demand_accumulator.pending_qty + excluded.pending_qty, updated_at = now();
    select lot_size into v_lot from kanban_standards where mat_no = b.mat_no and is_active limit 1;
    if v_lot is null or v_lot <= 0 then continue; end if;
    select pending_qty into v_pending from child_demand_accumulator where child_mat_no = b.mat_no;
    v_made := 0;
    while v_pending >= v_lot and v_made < MAX_LOTS loop
      if b.mat_no like '3%' or b.mat_no like '5%' then
        select supplier into v_supplier from parts_master where mat_no = b.mat_no limit 1;
        insert into purchase_requests(work_date, mat_no, part_name, qty, dest_line, supplier, source_prod_no)
          values (v_workdate, b.mat_no, b.part_name, v_lot, v_line, v_supplier, NEW.prod_no);
      else
        v_srcline := coalesce(
          nullif(btrim(b.source_line), ''),
          (select nullif(btrim(d.line_name),'') from dr_products d
            where d.mat_no = b.mat_no and d.is_active limit 1));
        insert into child_lot_requests(work_date, child_mat_no, part_name, source_line, lot_qty, source_prod_no)
          values (v_workdate, b.mat_no, b.part_name, v_srcline, v_lot, NEW.prod_no) returning id into v_lotid;
        for r in select bi.mat_no, bi.part_name, bi.qty_per_unit
                   from dr_products cp join bom_items bi on bi.product_id = cp.id and bi.is_active
                  where cp.mat_no = b.mat_no and cp.is_active loop
          insert into raw_withdrawal_requests(lot_request_id, raw_mat_no, part_name, qty)
            values (v_lotid, r.mat_no, r.part_name, v_lot * r.qty_per_unit);
        end loop;
      end if;
      v_pending := v_pending - v_lot;
      v_made := v_made + 1;
    end loop;
    update child_demand_accumulator set pending_qty = v_pending, updated_at = now() where child_mat_no = b.mat_no;
  end loop;

  for p in select * from product_packaging where product_id = v_fg and is_active loop
    insert into packaging_withdrawal_requests(work_date, product_mat_no, product_name, source_line, packaging_code, packaging_name, qty, source_prod_no)
      values (v_workdate, NEW.mat_no, v_fgname, v_line, p.packaging_code, p.packaging_name,
              ceil(v_qty::numeric / greatest(p.pcs_per_pkg,1)), NEW.prod_no);
  end loop;

  return null;
end;
$function$;

-- backfill เฉพาะแถวที่จับคู่ได้ "ใบเดียว" — กำกวม/หาไม่เจอ ปล่อย null (ห้ามเดา)
with c as (
  select t.id, t.work_date, t.line_name, substring(t.note from 'auto: FG (.*) ใช้ mini-store') pn
  from line_stock_transactions t
  where t.type = 'consume' and t.created_by = 'auto' and t.ref_order_id is null
), m as (
  select c.id, min(o.id::text)::uuid oid, min(o.session_id::text)::uuid sid, count(*) n
  from c
  join prod_orders o on o.prod_no = c.pn
  join production_sessions s on s.id = o.session_id and s.line_name = c.line_name and s.work_date = c.work_date
  group by c.id
)
update line_stock_transactions t
   set ref_order_id = m.oid, ref_session_id = m.sid
  from m where m.n = 1 and t.id = m.id;

commit;

-- เช็คผลหลังรัน (คาด: null_left ≈ 35 = กำกวม 29 + หาไม่เจอ 6):
-- select count(*) filter (where ref_order_id is null) null_left, count(*) total
--   from line_stock_transactions where type='consume' and created_by='auto';
