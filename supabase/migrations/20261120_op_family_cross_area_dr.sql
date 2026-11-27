-- 🔩 ชั้น OP: FG ต่างลูกค้าของพาร์ทเดียวกัน + ตัดชิ้น OP ข้ามพื้นที่ SAP (DR · 2026-11-20 · คำสั่ง user)
-- Project: DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- ปัญหา 1 (family): OP ผูกแม่ได้ทีละรหัส (`op_parent_mat` = text ช่องเดียว) ⇒ 10100385 (AAT) ตัดชิ้น OP
--   แต่ 10100384 (FTM) / 10106790 (FVL) / 20066636 (ชุบดำ) ซึ่งเป็นพาร์ทเดียวกัน ยังตัดท่อ 50031601 ตรง = ตัดท่อซ้ำ
--   แก้: FG ที่ "ไม่มี OP ของตัวเองเลย" → หา OP ผ่านแม่ในกลุ่มเดียวกัน (แกน p_no · `fn_op_family_key`)
--   🔴 กลุ่มเข้มกว่า partCoreOf: ท้ายเลขต้องเป็นตัวอักษรล้วน ≤3 ตัว (= เรฟ เช่น BA/BC) — ไม่งั้นใช้เลขเต็ม
--      (N1WB-17E850R-PIA02 กับ -PIA04 = คนละพาร์ท · R1WB-17K824/825-AAW - STEP 2 = คนละแม่) ห้ามเดารวม
--   🔴 หาแม่ในกลุ่มได้ > 1 ตัว = ไม่รู้ = พฤติกรรมเดิม (ไม่แทน) · แทนเฉพาะลูกที่อยู่ใน BOM ของ FG ตัวนั้นจริง
-- ปัญหา 2 (cross-area): ชิ้น OP (เช่น 90031603 ที่ LASER-345 พื้นที่ HYDROFORM) อยู่คนละพื้นที่กับไลน์ประกอบ
--   (Line 60 = P411) ⇒ FG มองไม่เห็นชิ้น → ตัดท่อแทน · แก้: ไม่พอในพื้นที่ตัวเอง → ตัดต่อจากพื้นที่ของไลน์ขั้น OP
--
-- ย้อนกลับ: รัน CREATE OR REPLACE ของ fn_op_parent_replace / fn_take_op_output จาก
--   20261109b_op_stage_stock_trigger_dr.sql (fn_take_op_output ฉบับ 19/11 ใน docs/modules/bom-levels.md) แล้ว
--   drop function fn_op_parent_resolve(text), fn_op_family_key(text)

create or replace function public.fn_op_family_key(p_no text)
returns text language plpgsql immutable as $$
declare t text[]; n int; mid text;
begin
  t := array(select x from unnest(regexp_split_to_array(upper(coalesce(p_no,'')), '[^A-Z0-9]+')) x where x <> '');
  n := coalesce(array_length(t, 1), 0);
  if n = 0 then return ''; end if;
  if n >= 3 then
    mid := array_to_string(t[2:n-1], '');
    if length(mid) >= 3 and mid ~ '\d' and t[n] ~ '^[A-Z]{1,3}$' then return mid; end if;
  end if;
  return array_to_string(t, '');
end $$;

-- แม่ของโซ่ OP ที่ FG นี้ใช้: มี OP ของตัวเอง = ตัวเอง · ไม่มีเลย = แม่ตัวเดียวในกลุ่ม · ไม่งั้น = ตัวเอง (เดิม)
create or replace function public.fn_op_parent_resolve(p_fg text)
returns text language plpgsql stable as $$
declare v_key text; v_n int; v_par text;
begin
  if exists (select 1 from public.dr_products s where s.is_active and coalesce(s.is_operation,false)
              and s.op_parent_mat = p_fg) then return p_fg; end if;
  select public.fn_op_family_key(d.p_no) into v_key from public.dr_products d
   where d.mat_no = p_fg and d.is_active and not coalesce(d.is_operation,false) limit 1;
  if coalesce(v_key,'') = '' then return p_fg; end if;
  select count(distinct s.op_parent_mat), min(s.op_parent_mat) into v_n, v_par
    from public.dr_products s
    join public.dr_products p on p.mat_no = s.op_parent_mat and p.is_active
   where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat <> p_fg
     and public.fn_op_family_key(p.p_no) = v_key and public.fn_op_kind(s.mat_no) = 'pre';
  if v_n = 1 then return v_par; end if;
  return p_fg;
end $$;

create or replace function public.fn_op_parent_replace(p_parent text)
returns table(eaten_mat text, last_op text) language plpgsql stable as $$
declare v_n int; v_nullseq int; v_last text; v_par text;
begin
  v_par := public.fn_op_parent_resolve(p_parent);
  select count(*), count(*) filter (where s.op_seq is null) into v_n, v_nullseq
    from public.dr_products s
   where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat = v_par and public.fn_op_kind(s.mat_no) = 'pre';
  if v_n = 0 or (v_n > 1 and v_nullseq > 0) then return; end if;
  select s.mat_no into v_last from public.dr_products s
   where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat = v_par and public.fn_op_kind(s.mat_no) = 'pre'
   order by s.op_seq desc nulls last limit 1;
  -- แทนเฉพาะลูกที่อยู่ใน BOM ของ FG ตัวนี้จริง (p_parent ไม่ใช่ v_par)
  return query
    select distinct k.mat_no, v_last
      from public.dr_products s
      cross join lateral public.fn_op_inputs(s.mat_no) i
      join public.fn_bom_direct_demand(p_parent) k on k.mat_no = i.mat_no
     where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat = v_par and not i.is_op_output;
end $$;

create or replace function public.fn_take_op_output(p_line text, p_op text, p_need numeric, p_wd date, p_note text,
  p_order uuid, p_session uuid, p_prod_no text, p_depth integer default 0)
returns numeric language plpgsql as $$
declare v_taken numeric; v_short numeric; i record; v_has boolean := false; v_opline text;
begin
  v_taken := public.fn_area_take(p_line, p_op, null, p_need, p_wd, p_note, p_order, p_session);
  -- 20/11: ไม่พอในพื้นที่ตัวเอง → ตัดต่อจากพื้นที่ของไลน์ขั้น OP (ชิ้น OP อยู่ที่ไลน์ที่ทำขั้นนั้น)
  if coalesce(p_need,0) - v_taken > 0 then
    select d.line_name into v_opline from public.dr_products d
     where d.mat_no = p_op and d.is_active and coalesce(d.is_operation,false) limit 1;
    if coalesce(btrim(v_opline),'') <> '' and not (v_opline = any(public.fn_area_lines(p_line))) then
      v_taken := v_taken + public.fn_area_take(v_opline, p_op, null, coalesce(p_need,0) - v_taken, p_wd,
        p_note || ' · ข้ามพื้นที่: ชิ้นขั้น OP อยู่พื้นที่ของ ' || v_opline || ' (ใช้ที่ ' || p_line || ')',
        p_order, p_session);
    end if;
  end if;
  v_short := coalesce(p_need,0) - v_taken;
  if v_short > 0 and p_depth < 5 then
    for i in select * from public.fn_op_inputs(p_op) loop
      v_has := true;
      if i.is_op_output then
        perform public.fn_take_op_output(p_line, i.mat_no, v_short * i.qty_per_unit, p_wd,
          p_note || ' · ชิ้นขั้น '||p_op||' ไม่พอ '||round(v_short)||' → ตัดแทน', p_order, p_session, p_prod_no, p_depth + 1);
      else
        perform public.fn_take_raw(p_line, i.mat_no, i.part_name, v_short * i.qty_per_unit, p_wd,
          p_note || ' · ชิ้นขั้น '||p_op||' ไม่พอ '||round(v_short)||' → ตัดลูกเดิมแทน', p_order, p_session, p_prod_no, i.source_line);
      end if;
    end loop;
  end if;
  -- 19/11: ไม่มีของที่ขั้นกินให้ตัดแทน (หรือลึกเกิน) = ติดลบที่ชิ้นขั้นนี้ ห้ามหายเงียบ
  if v_short > 0 and not v_has then
    insert into public.line_stock_transactions(line_name, mat_no, part_name, qty, type, work_date, note, created_by, ref_order_id, ref_session_id)
    values (p_line, p_op, null, v_short, 'consume', p_wd,
            p_note || ' · ⚠ ชิ้นขั้น OP ในระบบไม่พอ ตัดเกิน ' || round(v_short) || ' (ติดลบ รอเติมหักล้าง)', 'auto', p_order, p_session);
  end if;
  return v_taken;
end $$;

-- Assy LWR: ขั้น BENDING LWR BAR 306 กินท่อ 50031625 ×1 (เดิมไม่มี BOM + แม่มีลูกหลายตัว = unset)
insert into public.bom_items(product_id, mat_no, part_name, qty_per_unit, uom, note, is_active, created_by)
select d.id, '50031625', 'WSS-M1A367-A36 50G50G 1.50X(43X65)X1186', 1, 'PC',
       'ขั้น BENDING กินท่อ 1:1 (20/11 · ผูก OP Assy LWR)', true, 'ADMIN'
  from public.dr_products d
 where d.mat_no = 'BENDING LWR BAR 306' and d.is_active
   and not exists (select 1 from public.bom_items b where b.product_id = d.id and b.mat_no = '50031625' and b.is_active);
