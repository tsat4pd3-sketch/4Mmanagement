-- 🔩 เฟส 2 ขั้น OP — ส่วนที่ 1: ฟังก์ชันช่วย (อ่านอย่างเดียว ยังไม่เปลี่ยนพฤติกรรมอะไร) · DR ("Product DB" · eyhclzkifitbhbljgoav)
-- กฎตรงกับฝั่งจอ src/utils/opInputs.js (opInputsOf / isFirstOpInChain) — แก้ที่หนึ่งต้องแก้อีกที่
-- ย้อนกลับ: drop function public.fn_op_inputs(text); drop function public.fn_op_kind(text);
--          drop function public.fn_op_parent_replace(text); drop function public.fn_area_lines(text);

-- 📍 ไลน์ในพื้นที่ SAP เดียวกัน (storage_locations.line_names) · ไม่ผูก = ไลน์ตัวเอง
--    ⚠️ ฝั่ง DR อ่านลำดับชั้นไลน์ (Main) ไม่ได้ ⇒ ไลน์ลูกที่ไม่ได้อยู่ในรายชื่อ = เฉพาะตัวเอง (พฤติกรรมเดิม)
create or replace function public.fn_area_lines(p_line text) returns text[]
language sql stable as $$
  select coalesce(
    (select array(select distinct x from unnest(s.line_names || array[p_line]) x where coalesce(btrim(x),'') <> '')
       from public.storage_locations s
      where s.is_active and p_line = any(s.line_names) limit 1),
    array[p_line]);
$$;

-- ชนิดขั้น: 'post' = ขั้นหลังได้พาร์ทแล้ว (ใบของขั้นมีตัวแม่เอง เช่น ขับนัทบน 20058481) → ไม่ขยับสต็อก (user เคาะ 09/11)
--          'pre'  = ขั้นก่อนประกอบ (กินลูกของแม่ทำเป็นชิ้นกลาง) · null = ไม่ใช่ขั้น OP
create or replace function public.fn_op_kind(p_op text) returns text
language plpgsql stable as $$
declare v_par text;
begin
  select d.op_parent_mat into v_par from public.dr_products d
   where d.mat_no = p_op and d.is_active and coalesce(d.is_operation,false) limit 1;
  if not found then return null; end if;
  if v_par is not null and exists (select 1 from public.fn_bom_direct_demand(p_op) k
                                    where upper(btrim(k.mat_no)) = upper(btrim(v_par))) then return 'post'; end if;
  return 'pre';
end $$;

-- ของที่ขั้น OP (แบบ pre) กิน · is_op_output = รับชิ้นจากขั้นก่อนหน้าในโซ่
--   ① ใบของขั้นเอง (+ ชิ้นจากขั้นก่อนหน้าถ้าไม่ใช่ขั้นแรก) ② ขั้นแรก + แม่มีลูกตัวเดียว = ลูกตัวนั้น
--   ③ ไม่ใช่ขั้นแรก = ชิ้นจากขั้นก่อนหน้า ×1 ④ ไม่งั้น = ว่าง (ยังไม่ผูก · ห้ามเดา)
--   "ขั้นแรก" = แม่มีขั้น pre ตัวเดียว หรือ op_seq ครบทุกขั้นแล้วตัวนี้น้อยสุด
create or replace function public.fn_op_inputs(p_op text)
returns table(mat_no text, part_name text, qty_per_unit numeric, is_op_output boolean, source_line text, via_phantom text)
language plpgsql stable as $$
declare v_par text; v_seq int; v_n int; v_nullseq int; v_min int; v_first boolean; v_prev text; v_own int; v_pk int;
begin
  select d.op_parent_mat, d.op_seq into v_par, v_seq from public.dr_products d
   where d.mat_no = p_op and d.is_active and coalesce(d.is_operation,false) limit 1;
  if v_par is null or public.fn_op_kind(p_op) <> 'pre' then return; end if;
  select count(*), count(*) filter (where s.op_seq is null), min(s.op_seq) into v_n, v_nullseq, v_min
    from public.dr_products s
   where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat = v_par and public.fn_op_kind(s.mat_no) = 'pre';
  v_first := v_n <= 1 or (v_nullseq = 0 and v_seq = v_min);
  if not v_first and v_nullseq = 0 then
    select s.mat_no into v_prev from public.dr_products s
     where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat = v_par
       and public.fn_op_kind(s.mat_no) = 'pre' and s.op_seq < v_seq
     order by s.op_seq desc limit 1;
  end if;
  select count(*) into v_own from public.fn_bom_direct_demand(p_op);
  if v_own > 0 then
    return query select k.mat_no, k.part_name, k.qty_per_unit,
        exists (select 1 from public.dr_products x where x.mat_no = k.mat_no and x.is_active and coalesce(x.is_operation,false)),
        k.source_line, k.via_phantom
      from public.fn_bom_direct_demand(p_op) k;
    if v_prev is not null and not exists (select 1 from public.fn_bom_direct_demand(p_op) k where k.mat_no = v_prev) then
      return query select v_prev, null::text, 1::numeric, true, null::text, null::text;
    end if;
    return;
  end if;
  if v_first then
    select count(*) into v_pk from public.fn_bom_direct_demand(v_par);
    if v_pk = 1 then
      return query select k.mat_no, k.part_name, k.qty_per_unit, false, k.source_line, k.via_phantom
        from public.fn_bom_direct_demand(v_par) k;
    end if;
    return;
  end if;
  if v_prev is not null then
    return query select v_prev, null::text, 1::numeric, true, null::text, null::text;
  end if;
end $$;

-- ใบแม่: ลูกตัวไหนถูกขั้น OP กินไปแล้ว (eaten) + ขั้นสุดท้ายของโซ่ (last_op) ที่แม่ต้องใช้ชิ้นแทน
--   หลายขั้นแต่ลำดับไม่ครบ = ไม่รู้ว่าตัวไหนสุดท้าย ⇒ ไม่แทนอะไร (ตัดลูกเดิมแบบเดิม)
create or replace function public.fn_op_parent_replace(p_parent text)
returns table(eaten_mat text, last_op text)
language plpgsql stable as $$
declare v_n int; v_nullseq int; v_last text;
begin
  select count(*), count(*) filter (where s.op_seq is null) into v_n, v_nullseq
    from public.dr_products s
   where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat = p_parent and public.fn_op_kind(s.mat_no) = 'pre';
  if v_n = 0 or (v_n > 1 and v_nullseq > 0) then return; end if;
  select s.mat_no into v_last from public.dr_products s
   where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat = p_parent and public.fn_op_kind(s.mat_no) = 'pre'
   order by s.op_seq desc nulls last limit 1;
  return query
    select distinct k.mat_no, v_last
      from public.dr_products s
      cross join lateral public.fn_op_inputs(s.mat_no) i
      join public.fn_bom_direct_demand(p_parent) k on k.mat_no = i.mat_no
     where s.is_active and coalesce(s.is_operation,false) and s.op_parent_mat = p_parent and not i.is_op_output;
end $$;

grant execute on function public.fn_area_lines(text), public.fn_op_kind(text), public.fn_op_inputs(text), public.fn_op_parent_replace(text) to anon, authenticated;
