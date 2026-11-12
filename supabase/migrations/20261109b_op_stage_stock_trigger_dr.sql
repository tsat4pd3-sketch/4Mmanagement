-- 🔩 เฟส 2 ขั้น OP — ส่วนที่ 2: ตัวตัดสต็อกตอนคอนเฟิร์ม (fn_explode_child_demand) · DR ("Product DB" · eyhclzkifitbhbljgoav)
-- user เคาะ 09/11: (ข) ขั้นหลังได้พาร์ทแล้ว = ไม่ขยับสต็อก · ตัดทั้งพื้นที่ SAP · ชิ้นกลางไม่พอ = ตัดลูกเดิมแทนส่วนที่ขาด
-- เปลี่ยนจากเดิม 3 อย่าง:
--   ① ตัดของ "ทั้งพื้นที่ SAP" (ไลน์ที่คอนเฟิร์มก่อน → ไลน์อื่นในรหัสเดียวกัน) แทนไลน์เดียว — ใช้กับทุกใบ
--   ② ใบขั้น OP แบบก่อนประกอบ: ตัดของที่ขั้นกิน (fn_op_inputs) + รับชิ้นที่ผ่านขั้นเข้าไลน์ (mat = ชื่อขั้น)
--      ขั้นหลังได้พาร์ทแล้ว / ยังไม่ผูก = ไม่ทำอะไร (เหมือนเดิม)
--   ③ ใบแม่: ลูกที่ขั้น OP กินแล้ว → ตัดชิ้นจากขั้นสุดท้ายแทน · ชิ้นไม่พอ → ไล่กลับไปตัดของที่ขั้นนั้นกิน (ลูกเดิม) แทนส่วนที่ขาด
-- ย้อนกลับ: รัน "ส่วน ROLLBACK" ท้ายไฟล์ (คืนฟังก์ชันเดิมทั้งตัว) แล้ว drop fn_area_take / fn_take_op_output / fn_take_raw / fn_child_short

-- ตัดของ 1 รายการจากพื้นที่ SAP ของไลน์ — ไลน์ตัวเองก่อน แล้วไลน์อื่นที่มีของมากสุด · ไม่ติดลบ · คืนยอดที่ตัดได้
create or replace function public.fn_area_take(p_line text, p_mat text, p_part text, p_need numeric, p_wd date,
                                               p_note text, p_order uuid, p_session uuid)
returns numeric language plpgsql as $$
declare r record; v_left numeric := coalesce(p_need, 0); v_take numeric; v_taken numeric := 0;
begin
  if v_left <= 0 then return 0; end if;
  for r in select s.line_name, s.qty_on_hand from public.line_stock_summary s
            where s.mat_no = p_mat and s.line_name = any(public.fn_area_lines(p_line)) and s.qty_on_hand > 0
            order by (s.line_name = p_line) desc, s.qty_on_hand desc loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty_on_hand);
    insert into public.line_stock_transactions(line_name, mat_no, part_name, qty, type, work_date, note, created_by, ref_order_id, ref_session_id)
      values (r.line_name, p_mat, p_part, v_take, 'consume', p_wd,
              p_note || case when r.line_name <> p_line then ' · ตัดจากไลน์ '||r.line_name||' (พื้นที่ SAP เดียวกัน)' else '' end,
              'auto', p_order, p_session);
    v_left := v_left - v_take; v_taken := v_taken + v_take;
  end loop;
  return v_taken;
end $$;

-- ส่วนที่ตัดไม่ได้ (ของไม่พอ) = ลงยอดขาดแบบเดียวกับตัวเดิมทุกตัว (ใบลูก direct / ตัวสะสม + ออกใบตามล็อต) — ห้ามเงียบ
create or replace function public.fn_child_short(p_mat text, p_part text, p_short numeric, p_line text, p_wd date,
                                                 p_prod_no text, p_source_line text)
returns void language plpgsql as $$
declare v_lot integer; v_mode text; v_pending numeric; v_made int := 0; MAX_LOTS constant int := 50;
begin
  if coalesce(p_short,0) <= 0 then return; end if;
  select lot_size, lot_mode into v_lot, v_mode from public.kanban_standards where mat_no = p_mat and is_active limit 1;
  if v_mode = 'direct' then
    perform public.fn_emit_child_demand_slip(p_mat, p_part, ceil(p_short), p_line, p_wd, p_prod_no, p_source_line);
    return;
  end if;
  insert into public.child_demand_accumulator(child_mat_no, pending_qty, updated_at) values (p_mat, p_short, now())
  on conflict (child_mat_no) do update set pending_qty = child_demand_accumulator.pending_qty + excluded.pending_qty, updated_at = now();
  if v_lot is null or v_lot <= 0 then return; end if;
  select pending_qty into v_pending from public.child_demand_accumulator where child_mat_no = p_mat;
  while v_pending >= v_lot and v_made < MAX_LOTS loop
    perform public.fn_emit_child_demand_slip(p_mat, p_part, v_lot, p_line, p_wd, p_prod_no, p_source_line);
    v_pending := v_pending - v_lot; v_made := v_made + 1;
  end loop;
  update public.child_demand_accumulator set pending_qty = v_pending, updated_at = now() where child_mat_no = p_mat;
end $$;

-- ตัดของดิบ 1 รายการทั้งพื้นที่ + ส่วนที่ขาดลงยอดขาด
create or replace function public.fn_take_raw(p_line text, p_mat text, p_part text, p_need numeric, p_wd date,
                                              p_note text, p_order uuid, p_session uuid, p_prod_no text, p_source_line text)
returns numeric language plpgsql as $$
declare v_taken numeric;
begin
  v_taken := public.fn_area_take(p_line, p_mat, p_part, p_need, p_wd, p_note, p_order, p_session);
  perform public.fn_child_short(p_mat, p_part, coalesce(p_need,0) - v_taken, p_line, p_wd, p_prod_no, p_source_line);
  return v_taken;
end $$;

-- ตัดชิ้นที่ผ่านขั้น OP · ไม่พอ = ไล่ไปตัดของที่ขั้นนั้นกินแทนส่วนที่ขาด (ลึกสุด 5 ชั้น) · คืนยอดชิ้นที่ตัดได้จริง
create or replace function public.fn_take_op_output(p_line text, p_op text, p_need numeric, p_wd date,
                                                    p_note text, p_order uuid, p_session uuid, p_prod_no text, p_depth int default 0)
returns numeric language plpgsql as $$
declare v_taken numeric; v_short numeric; i record;
begin
  v_taken := public.fn_area_take(p_line, p_op, null, p_need, p_wd, p_note, p_order, p_session);
  v_short := coalesce(p_need,0) - v_taken;
  if v_short > 0 and p_depth < 5 then
    for i in select * from public.fn_op_inputs(p_op) loop
      if i.is_op_output then
        perform public.fn_take_op_output(p_line, i.mat_no, v_short * i.qty_per_unit, p_wd,
          p_note || ' · ชิ้นขั้น '||p_op||' ไม่พอ '||round(v_short)||' → ตัดแทน', p_order, p_session, p_prod_no, p_depth + 1);
      else
        perform public.fn_take_raw(p_line, i.mat_no, i.part_name, v_short * i.qty_per_unit, p_wd,
          p_note || ' · ชิ้นขั้น '||p_op||' ไม่พอ '||round(v_short)||' → ตัดลูกเดิมแทน', p_order, p_session, p_prod_no, i.source_line);
      end if;
    end loop;
  end if;
  return v_taken;
end $$;

create or replace function public.fn_explode_child_demand()
 returns trigger language plpgsql as $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; p record; i record;
  v_gross numeric; v_qty numeric; v_is_op boolean;
  v_last_op text; v_out_qty numeric; v_has_inputs boolean := false; v_note text;
begin
  if NEW.status = 'confirmed' then
    if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
    v_qty := NEW.qty;
    v_out_qty := coalesce(NEW.qty_ok, NEW.qty);
  elsif TG_OP = 'UPDATE' and NEW.status in ('carry_over', 'cancelled')
        and OLD.status is distinct from NEW.status then
    v_qty := NEW.qty_actual;
    v_out_qty := NEW.qty_actual;
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

  -- 🔩 ใบขั้น OP (09/11) — แบบก่อนประกอบ: ตัดของที่ขั้นกิน + รับชิ้นที่ผ่านขั้น · หลังได้พาร์ท/ยังไม่ผูก = ไม่ขยับ (เหมือนเดิม)
  if v_is_op then
    if public.fn_op_kind(NEW.mat_no) <> 'pre' then return null; end if;
    v_note := 'auto: ขั้น OP '||NEW.mat_no||' '||coalesce(NEW.prod_no,'')||' ใช้';
    for i in select * from public.fn_op_inputs(NEW.mat_no) loop
      v_has_inputs := true;
      if i.is_op_output then
        perform public.fn_take_op_output(v_line, i.mat_no, v_qty * i.qty_per_unit, v_workdate, v_note, NEW.id, NEW.session_id, NEW.prod_no);
      else
        perform public.fn_take_raw(v_line, i.mat_no, i.part_name, v_qty * i.qty_per_unit, v_workdate, v_note, NEW.id, NEW.session_id, NEW.prod_no, i.source_line);
      end if;
    end loop;
    if v_has_inputs and coalesce(v_out_qty,0) > 0 then
      insert into line_stock_transactions(line_name, mat_no, part_name, qty, type, work_date, note, created_by, ref_order_id, ref_session_id)
        values (v_line, NEW.mat_no, v_fgname, v_out_qty, 'issue', v_workdate,
                'auto: ชิ้นผ่านขั้น OP '||coalesce(NEW.prod_no,'')||' (ชิ้นกลาง · SAP มองเป็นของที่ขั้นกิน)', 'auto', NEW.id, NEW.session_id);
    end if;
    return null;
  end if;

  -- ③ ลูกที่ขั้น OP ของแม่กินไปแล้ว → ตัดชิ้นจากขั้นสุดท้ายแทน (ไม่พอ = ตัดลูกเดิมแทนส่วนที่ขาด)
  select r.last_op into v_last_op from public.fn_op_parent_replace(NEW.mat_no) r limit 1;
  if v_last_op is not null then
    perform public.fn_take_op_output(v_line, v_last_op, v_qty, v_workdate,
      'auto: FG '||coalesce(NEW.prod_no,'')||' ใช้ชิ้นผ่านขั้น OP', NEW.id, NEW.session_id, NEW.prod_no);
  end if;

  for b in select * from public.fn_bom_direct_demand(NEW.mat_no) loop
    if exists (select 1 from dr_products dp where dp.mat_no = b.mat_no and dp.is_active
                 and coalesce(dp.is_operation, false)) then continue; end if;
    if v_last_op is not null and exists (select 1 from public.fn_op_parent_replace(NEW.mat_no) r where r.eaten_mat = b.mat_no) then continue; end if;

    v_gross := v_qty * b.qty_per_unit;
    -- ① ตัดทั้งพื้นที่ SAP (09/11 · user เคาะ) — เดิมตัดเฉพาะไลน์ที่คอนเฟิร์ม · ส่วนที่ขาด = ลงยอดขาดแบบเดิม (fn_child_short)
    perform public.fn_take_raw(v_line, b.mat_no, b.part_name, v_gross, v_workdate,
                  'auto: FG '||coalesce(NEW.prod_no,'')||' ใช้ mini-store'
                    ||case when b.via_phantom is not null then ' (ผ่านของลม '||b.via_phantom||')' else '' end,
                  NEW.id, NEW.session_id, NEW.prod_no, b.source_line);
  end loop;

  for p in select * from product_packaging where product_id = v_fg and is_active loop
    insert into packaging_withdrawal_requests(work_date, product_mat_no, product_name, source_line, packaging_code, packaging_name, qty, source_prod_no)
      values (v_workdate, NEW.mat_no, v_fgname, v_line, p.packaging_code, p.packaging_name,
              ceil(v_qty::numeric / greatest(p.pcs_per_pkg,1)), NEW.prod_no);
  end loop;

  return null;
end;
$function$;

/* ═══ ROLLBACK (คืนตัวตัดสต็อกเดิมก่อน 09/11) — รันใน DR "Product DB" ═══
create or replace function public.fn_explode_child_demand()
 returns trigger language plpgsql as $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; p record;
  v_gross numeric; v_onhand numeric; v_consume numeric; v_short numeric;
  v_lot integer; v_mode text; v_pending numeric; v_made int; v_qty numeric; v_is_op boolean;
  MAX_LOTS constant int := 50;
begin
  if NEW.status = 'confirmed' then
    if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
    v_qty := NEW.qty;
  elsif TG_OP = 'UPDATE' and NEW.status in ('carry_over', 'cancelled') and OLD.status is distinct from NEW.status then
    v_qty := NEW.qty_actual;
  else return null; end if;
  if v_qty is null or v_qty <= 0 then return null; end if;
  begin insert into public.child_demand_explosions(order_id) values (NEW.id);
  exception when unique_violation then return null; end;
  select ps.line_name, ps.work_date into v_line, v_workdate from production_sessions ps where ps.id = NEW.session_id;
  select id, name, coalesce(is_operation, false) into v_fg, v_fgname, v_is_op from dr_products where mat_no = NEW.mat_no and is_active limit 1;
  if v_fg is null then return null; end if;
  if v_is_op then return null; end if;
  for b in select * from public.fn_bom_direct_demand(NEW.mat_no) loop
    if exists (select 1 from dr_products dp where dp.mat_no = b.mat_no and dp.is_active and coalesce(dp.is_operation, false)) then continue; end if;
    v_gross := v_qty * b.qty_per_unit;
    select coalesce(qty_on_hand,0) into v_onhand from line_stock_summary where line_name = v_line and mat_no = b.mat_no;
    if v_onhand is null then v_onhand := 0; end if;
    v_consume := least(v_onhand, v_gross);
    if v_consume < 0 then v_consume := 0; end if;
    v_short := v_gross - v_consume;
    if v_consume > 0 then
      insert into line_stock_transactions(line_name, mat_no, part_name, qty, type, work_date, note, created_by, ref_order_id, ref_session_id)
        values (v_line, b.mat_no, b.part_name, v_consume, 'consume', v_workdate,
                'auto: FG '||coalesce(NEW.prod_no,'')||' ใช้ mini-store'||case when b.via_phantom is not null then ' (ผ่านของลม '||b.via_phantom||')' else '' end,
                'auto', NEW.id, NEW.session_id);
    end if;
    if v_short <= 0 then continue; end if;
    v_lot := null; v_mode := null;
    select lot_size, lot_mode into v_lot, v_mode from kanban_standards where mat_no = b.mat_no and is_active limit 1;
    if v_mode = 'direct' then
      perform public.fn_emit_child_demand_slip(b.mat_no, b.part_name, ceil(v_short), v_line, v_workdate, NEW.prod_no, b.source_line);
      continue;
    end if;
    insert into child_demand_accumulator(child_mat_no, pending_qty, updated_at) values (b.mat_no, v_short, now())
    on conflict (child_mat_no) do update set pending_qty = child_demand_accumulator.pending_qty + excluded.pending_qty, updated_at = now();
    if v_lot is null or v_lot <= 0 then continue; end if;
    select pending_qty into v_pending from child_demand_accumulator where child_mat_no = b.mat_no;
    v_made := 0;
    while v_pending >= v_lot and v_made < MAX_LOTS loop
      perform public.fn_emit_child_demand_slip(b.mat_no, b.part_name, v_lot, v_line, v_workdate, NEW.prod_no, b.source_line);
      v_pending := v_pending - v_lot; v_made := v_made + 1;
    end loop;
    update child_demand_accumulator set pending_qty = v_pending, updated_at = now() where child_mat_no = b.mat_no;
  end loop;
  for p in select * from product_packaging where product_id = v_fg and is_active loop
    insert into packaging_withdrawal_requests(work_date, product_mat_no, product_name, source_line, packaging_code, packaging_name, qty, source_prod_no)
      values (v_workdate, NEW.mat_no, v_fgname, v_line, p.packaging_code, p.packaging_name, ceil(v_qty::numeric / greatest(p.pcs_per_pkg,1)), NEW.prod_no);
  end loop;
  return null;
end; $function$;
*/
