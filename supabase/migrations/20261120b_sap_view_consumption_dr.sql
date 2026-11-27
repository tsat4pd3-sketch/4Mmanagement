-- 📊 รายงาน "มุมมองแบบ SAP" — ยอดตัดของต่อช่วงวัน เทียบ ESM (DR · 2026-11-20 · คำสั่ง user)
-- Project: DR "Product DB" (eyhclzkifitbhbljgoav)
--
-- SAP backflush: FG 101 ตัด 501 ตรงตอนคอนเฟิร์ม (ไม่มีขั้น OP) · ESM: OP ตัด 501 ตอนทำขั้น · FG ตัดชิ้นจาก OP
-- ⇒ ยอดรายวันต่างได้ (ของค้างระหว่างขั้น) แต่ยอดสะสมควรเท่ากัน · รายงานนี้ "คิดแบบ SAP" ไว้เทียบกับ SAP
--   sap_qty = Σ ยอด FG (ไม่รวมใบขั้น OP) × BOM ปัจจุบัน (fn_bom_direct_demand · ลูกที่เป็นรหัสขั้น OP ไม่นับ — SAP ไม่มี)
--   esm_qty = Σ ธุรกรรม consume อัตโนมัติที่ผูกกับใบผลิตในช่วงเดียวกัน (รวมใบขั้น OP)
--   op_eaten = ลูกตัวนี้ขั้น OP เป็นคนกิน ⇒ ต่างรายวันได้ตามจังหวะขั้น (ไม่ใช่ความผิด)
-- ยอด FG ใช้กฎเดียวกับ trigger ตัดของ (`fn_explode_child_demand`): confirmed = qty · carry_over/cancelled = qty_actual
-- ⚠️ ใช้ BOM "วันนี้" ไม่ใช่ BOM ณ วันผลิต (ระบบยังไม่เก็บประวัติ BOM) — จอต้องเขียนบอก
-- read-only · ย้อนกลับ: drop function public.fn_sap_view_consumption(date, date, text[])

create or replace function public.fn_sap_view_consumption(p_from date, p_to date, p_lines text[] default null)
returns table(mat_no text, part_name text, sap_qty numeric, esm_qty numeric, op_eaten boolean)
language sql stable as $$
  with o as (
    select po.id, po.mat_no,
           case when po.status = 'confirmed' then po.qty else po.qty_actual end as q
      from public.prod_orders po
      join public.production_sessions ps on ps.id = po.session_id
     where ps.work_date between p_from and p_to
       and po.status in ('confirmed', 'carry_over', 'cancelled')
       and (p_lines is null or ps.line_name = any(p_lines))),
  fg as (
    select o.mat_no, sum(o.q) as q from o
      join public.dr_products d on d.mat_no = o.mat_no and d.is_active and not coalesce(d.is_operation, false)
     where o.q > 0 group by o.mat_no),
  sap as (
    select k.mat_no, max(k.part_name) as part_name, sum(fg.q * k.qty_per_unit) as sap_qty
      from fg cross join lateral public.fn_bom_direct_demand(fg.mat_no) k
     where not exists (select 1 from public.dr_products x where x.mat_no = k.mat_no and x.is_active and coalesce(x.is_operation, false))
     group by k.mat_no),
  esm as (
    select t.mat_no, max(t.part_name) as part_name, sum(t.qty) as esm_qty
      from public.line_stock_transactions t
     where t.type = 'consume' and t.created_by = 'auto' and t.ref_order_id in (select id from o)
       and not exists (select 1 from public.dr_products x where x.mat_no = t.mat_no and x.is_active and coalesce(x.is_operation, false))
     group by t.mat_no),
  eaten as (
    select distinct i.mat_no from public.dr_products s cross join lateral public.fn_op_inputs(s.mat_no) i
     where s.is_active and coalesce(s.is_operation, false) and not i.is_op_output)
  select coalesce(s.mat_no, e.mat_no), coalesce(s.part_name, e.part_name),
         coalesce(s.sap_qty, 0), coalesce(e.esm_qty, 0),
         exists (select 1 from eaten x where x.mat_no = coalesce(s.mat_no, e.mat_no))
    from sap s full join esm e on e.mat_no = s.mat_no;
$$;

grant execute on function public.fn_sap_view_consumption(date, date, text[]) to anon, authenticated;
