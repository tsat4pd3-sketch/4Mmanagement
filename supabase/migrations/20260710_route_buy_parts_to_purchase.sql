-- ============================================================================
-- Route BOUGHT parts (3xx child / 5xx raw) to purchase instead of production
-- ============================================================================
-- TARGET PROJECT: DR / "Product DB" (eyhclzkifitbhbljgoav).
--
-- fn_explode_child_demand (trigger trg_explode_child_demand on prod_orders)
-- previously emitted a child_lot_requests row ("เริ่มผลิต") for EVERY short BOM
-- part — including 3xx (child bought from supplier) and 5xx (raw material).
-- Those are purchased, not produced, so they now emit purchase_requests
-- instead, and the in-house BOM/raw explosion is skipped for them.
--
-- ONLY the emission branch changed. The store-consume, accumulator and
-- lot-size accumulation are identical to before, so behaviour for 2xx
-- (make-in-house) parts is unchanged. Backward compatible: create-or-replace,
-- no schema drop.
--
-- ROLLBACK: re-create the function with the old emission block (child_lot_
-- requests + raw_withdrawal_requests for all parts). The previous definition
-- is preserved in docs/ROLLBACK_BUY_PARTS_PURCHASE.md.
-- ============================================================================

create or replace function public.fn_explode_child_demand()
 returns trigger
 language plpgsql
as $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; r record; p record;
  v_gross numeric; v_onhand numeric; v_consume numeric; v_short numeric;
  v_lot integer; v_pending numeric; v_lotid uuid; v_supplier text;
begin
  if NEW.status is distinct from 'confirmed' then return null; end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
  if NEW.qty is null or NEW.qty <= 0 then return null; end if;

  select ps.line_name, ps.work_date into v_line, v_workdate
    from production_sessions ps where ps.id = NEW.session_id;

  select id, name into v_fg, v_fgname from dr_products where mat_no = NEW.mat_no and is_active limit 1;
  if v_fg is null then return null; end if;

  -- ── child parts → mini-store consume + accumulate + emit (produce OR buy) ──
  for b in select * from bom_items where product_id = v_fg and is_active loop
    v_gross := NEW.qty * b.qty_per_unit;
    select coalesce(qty_on_hand,0) into v_onhand
      from line_stock_summary where line_name = v_line and mat_no = b.mat_no;
    if v_onhand is null then v_onhand := 0; end if;
    v_consume := least(v_onhand, v_gross);
    if v_consume < 0 then v_consume := 0; end if;
    v_short := v_gross - v_consume;
    if v_consume > 0 then
      insert into line_stock_transactions(line_name, mat_no, part_name, qty, type, work_date, note, created_by)
        values (v_line, b.mat_no, b.part_name, v_consume, 'consume', v_workdate,
                'auto: FG '||coalesce(NEW.prod_no,'')||' ใช้ mini-store', 'auto');
    end if;
    if v_short <= 0 then continue; end if;
    insert into child_demand_accumulator(child_mat_no, pending_qty, updated_at)
      values (b.mat_no, v_short, now())
    on conflict (child_mat_no) do update
      set pending_qty = child_demand_accumulator.pending_qty + excluded.pending_qty, updated_at = now();
    select lot_size into v_lot from kanban_standards where mat_no = b.mat_no and is_active limit 1;
    if v_lot is null or v_lot <= 0 then continue; end if;
    select pending_qty into v_pending from child_demand_accumulator where child_mat_no = b.mat_no;
    while v_pending >= v_lot loop
      if b.mat_no like '3%' or b.mat_no like '5%' then
        -- BOUGHT part (3xx child / 5xx raw) → purchase from supplier, no BOM explosion
        select supplier into v_supplier from parts_master where mat_no = b.mat_no limit 1;
        insert into purchase_requests(work_date, mat_no, part_name, qty, dest_line, supplier, source_prod_no)
          values (v_workdate, b.mat_no, b.part_name, v_lot, v_line, v_supplier, NEW.prod_no);
      else
        -- MADE in-house (2xx) → production lot + raw withdrawals
        insert into child_lot_requests(work_date, child_mat_no, part_name, source_line, lot_qty, source_prod_no)
          values (v_workdate, b.mat_no, b.part_name, b.source_line, v_lot, NEW.prod_no) returning id into v_lotid;
        for r in select bi.mat_no, bi.part_name, bi.qty_per_unit
                   from dr_products cp join bom_items bi on bi.product_id = cp.id and bi.is_active
                  where cp.mat_no = b.mat_no and cp.is_active loop
          insert into raw_withdrawal_requests(lot_request_id, raw_mat_no, part_name, qty)
            values (v_lotid, r.mat_no, r.part_name, v_lot * r.qty_per_unit);
        end loop;
      end if;
      v_pending := v_pending - v_lot;
    end loop;
    update child_demand_accumulator set pending_qty = v_pending, updated_at = now() where child_mat_no = b.mat_no;
  end loop;

  -- ── packaging → ใบเบิกจาก Rack Center (ตรงตามจำนวนผลิต ไม่สะสม) ──
  for p in select * from product_packaging where product_id = v_fg and is_active loop
    insert into packaging_withdrawal_requests(work_date, product_mat_no, product_name, source_line, packaging_code, packaging_name, qty, source_prod_no)
      values (v_workdate, NEW.mat_no, v_fgname, v_line, p.packaging_code, p.packaging_name,
              ceil(NEW.qty::numeric / greatest(p.pcs_per_pkg,1)), NEW.prod_no);
  end loop;

  return null;
end;
$function$;
