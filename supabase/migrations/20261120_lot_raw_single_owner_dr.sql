-- ═══════════════════════════════════════════════════════════════════════════════
-- 20261120 — วัตถุดิบของพาร์ทลูกที่ผลิตเป็นล็อต: ตัดที่เดียว (DR · "Product DB" · eyhclzkifitbhbljgoav)
-- คำสั่ง user 20/11 เลือกทาง (ก): **ตัดตอนสโตร์จ่ายวัตถุดิบ/ปิดล็อต** · ปิดใบผลิตไม่ตัดซ้ำ
--
-- บั๊ก (audit 19/11): พาร์ทลูกที่สั่งผลิตเป็นล็อตถูกตัดวัตถุดิบ 2 ทางสำหรับการผลิตครั้งเดียวกัน
--   ① บอร์ดสโตร์ "จ่ายวัตถุดิบ"/ปิดล็อต → consume (raw_withdrawal_requests · HeijunkaKanban)
--   ② ปิดใบผลิตของพาร์ทลูกตัวเดียวกัน → trigger fn_explode_child_demand ตัดตาม BOM อีกรอบ
--   (30 วัน: 11 พาร์ทลูก ส่วนซ้ำ ~40,000 ชิ้น · หลัง 20261119c "ตัดเต็ม" ส่วนซ้ำกลายเป็นยอดติดลบที่ไลน์)
--
-- ใบผลิตกับใบล็อตไม่มีคอลัมน์ผูกกัน ⇒ ตัดสินเป็น "คู่ (พาร์ทลูก, วัตถุดิบ)":
--   คู่นี้เคยมีใบเบิกวัตถุดิบของล็อตที่มีไลน์ผลิต (ไม่นับใบ/ล็อตที่ยกเลิก) = ฝั่งล็อตเป็นเจ้าของ (fn_raw_lot_owned)
--   ⇒ ปิดใบผลิต **ไม่ลง ledger** ของคู่นั้น แต่ **ยังคิดยอดขาดแบบเดิม** (ต้องใช้ − ยอดบวกในพื้นที่ SAP)
--      แล้วส่งให้ fn_child_short เหมือนเดิม — สัญญาณสั่งเติมวัตถุดิบ (คัมบัง) ห้ามหาย (วัตถุดิบทั้ง 46 คู่มีทะเบียนคัมบัง)
--   คู่ที่ไม่เคยผ่านล็อต = ตัดตอนปิดใบเหมือนเดิมทุกอย่าง
--
-- ✅ apply แล้ว 20/11 (จำลองก่อน: คู่ผ่านล็อต ไม่ตัดซ้ำ + ยอดสั่งเติมเท่าเดิม · คู่ไม่ผ่านล็อต ตัดเหมือนเดิม)
-- ย้อนกลับ: ส่วน ROLLBACK ท้ายไฟล์ (คืน fn_explode_child_demand ตัวเดิม + drop 2 ฟังก์ชันช่วย)
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.fn_raw_lot_owned(p_child text, p_raw text)
returns boolean language sql stable as $f$
  select exists (
    select 1 from public.raw_withdrawal_requests r
      join public.child_lot_requests l on l.id = r.lot_request_id
     where l.child_mat_no = p_child and r.raw_mat_no = p_raw
       and r.status <> 'cancelled' and l.status <> 'cancelled' and l.source_line is not null)
$f$;

-- ยอดบวกในพื้นที่ SAP เดียวกับไลน์ (ชุดเดียวกับที่ fn_area_take ตัดได้)
create or replace function public.fn_area_onhand(p_line text, p_mat text)
returns numeric language sql stable as $f$
  select coalesce(sum(s.qty_on_hand), 0) from public.line_stock_summary s
   where s.mat_no = p_mat and s.line_name = any(public.fn_area_lines(p_line)) and s.qty_on_hand > 0
$f$;

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
      elsif public.fn_raw_lot_owned(NEW.mat_no, i.mat_no) then
        -- 20/11 (ก): สโตร์ตัดตอนจ่ายวัตถุดิบล็อตแล้ว — ไม่ตัดซ้ำ · ยอดขาดยังส่งสัญญาณสั่งเติมแบบเดิม
        perform public.fn_child_short(i.mat_no, i.part_name,
          v_qty * i.qty_per_unit - least(v_qty * i.qty_per_unit, public.fn_area_onhand(v_line, i.mat_no)),
          v_line, v_workdate, NEW.prod_no, i.source_line);
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
    -- 20/11 (ก · user): คู่ (พาร์ทลูก, วัตถุดิบ) ที่ผ่านใบเบิกล็อต = สโตร์ตัดตอนจ่ายวัตถุดิบแล้ว ⇒ ไม่ลง ledger ซ้ำ
    --   แต่ยอดขาด (คิดแบบเดิม) ยังส่ง fn_child_short — สัญญาณสั่งเติมวัตถุดิบห้ามหาย
    if public.fn_raw_lot_owned(NEW.mat_no, b.mat_no) then
      perform public.fn_child_short(b.mat_no, b.part_name,
        v_gross - least(v_gross, public.fn_area_onhand(v_line, b.mat_no)),
        v_line, v_workdate, NEW.prod_no, b.source_line);
      continue;
    end if;
    -- ① ตัดทั้งพื้นที่ SAP (09/11 · user เคาะ) — เดิมตัดเฉพาะไลน์ที่คอนเฟิร์ม · ส่วนที่ขาด = ติดลบที่ไลน์ (20261119c) + ลงยอดขาด
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK: คืน fn_explode_child_demand ตัวก่อนหน้า = ลบ 2 บล็อก "fn_raw_lot_owned" ออกจากฟังก์ชันข้างบน
--   (บล็อก elsif ในลูป OP + บล็อก if ... continue ในลูป BOM) แล้วรัน create or replace อีกครั้ง จากนั้น:
-- drop function if exists public.fn_raw_lot_owned(text, text);
-- drop function if exists public.fn_area_onhand(text, text);
-- ═══════════════════════════════════════════════════════════════════════════════
