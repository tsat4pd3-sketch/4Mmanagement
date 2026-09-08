-- 🎴 โหมดล็อตของพาร์ทลูก: "สะสมล็อต" vs "ไม่สะสมล็อต" — เลิกใช้ lot_size = 1 แทนความหมาย "ไม่สะสม"
-- ⚠️ DR project / "Product DB" (eyhclzkifitbhbljgoav)
--
-- ที่มา (user 2026-09-08): "lot size 1 จริงๆ มันไม่มีหรอก มันมีแต่แบบสะสมล็อตกับแบบไม่ต้องสะสมล็อต
--   แต่ก็ไม่ได้หมายความว่า lot size = 1"
-- บั๊กที่เกิด (รอบที่ 2 ของบั๊กหน่วย lot_size): หน้า Kanban Std เคยเขียนบอกว่า "ใส่ 1 = ผลิตตามสั่ง ไม่รอสะสม"
--   planner ทำตาม ~90 พาร์ท (27–28/08) → ทริกเกอร์ `while pending >= lot` ออก **ใบละ 1 ชิ้น** 400 ใบใน 3 วัน
--   (ล้างแล้วที่ 20260908_void_junk_child_lot_requests.sql)
--
-- ออกแบบ (mini-ADR):
--   เรื่อง: จะเก็บ "ไม่สะสมล็อต" ยังไง          วันที่: 2026-09-08
--   ทางเลือก: A) lot_size=1 ตามเดิม  B) คอลัมน์ lot_mode ใน kanban_standards  C) ใช้ dr_products.posting_mode
--   เลือก: B — A คือต้นเหตุบั๊ก · C ใช้ไม่ได้เพราะ 240/366 mat ใน kanban_standards ไม่มีใน dr_products
--     และ posting_mode เป็นเรื่อง "การโพสต์ใบผลิต FG" คนละแกน (ตอนนี้ไม่มีโค้ดอ่านเลย = ทิ้งไว้ก่อน ห้ามผูก)
--   ผลข้างเคียงที่ยอมรับ: มี lot_mode + lot_size 2 คอลัมน์ต้องตีความคู่กัน — กติกาอยู่ในทริกเกอร์นี้ที่เดียว
--   ถ้าจะเปลี่ยนใจ: จุดที่อ่าน lot_mode = ทริกเกอร์ · v_demand_flow_blocks · ProductMaster KanbanStd · FlowTower · PlannerSales
--
-- กติกา (source of truth = ทริกเกอร์ตัวนี้):
--   lot_mode = 'direct'      → ไม่สะสม: ปิดใบ FG 1 ครั้ง = ออกใบ 1 ใบ เท่ายอดที่ขาด (ไม่ผ่าน accumulator) · lot_size ต้องว่าง
--   lot_mode = 'accumulate'  → สะสมครบ lot_size (≥2 ชิ้น) ค่อยออกใบ (พฤติกรรมเดิม · เพดาน MAX_LOTS=50)
--   lot_mode ว่าง            → ยังไม่ตั้ง = ค้างใน accumulator (โผล่ใน v_demand_flow_blocks ให้ planner ตั้ง)
--   lot_size = 1 ห้าม (check constraint) — "สั่งครั้งละ 1 ชิ้น" ของแพงใช้โหมด direct แทน (กฎเดิม 21/08 ที่ห้ามบล็อกค่าต่ำ
--     เขียนไว้ตอนยังไม่มีโหมด direct — ยกเลิกข้อนั้นเพราะตอนนี้มีที่ให้บอกความตั้งใจแล้ว)
--   ลูกใน BOM ที่เป็น OP (`dr_products.is_operation`) → ข้ามทั้งหมด (ไม่หักมินิสโตร์ ไม่สะสม ไม่ออกใบ) — OP ห้ามอยู่ใน BOM
--     ตามกฎเดิม แต่ข้อมูลจริงยังมี (BOM แบน) · เดิมทริกเกอร์ข้ามเฉพาะ FG ที่เป็น OP ไม่ได้ข้ามลูกที่เป็น OP
--
-- backfill: lot_size = 1 (ทุกแถว ~90) → lot_mode='direct' + lot_size=null (ความตั้งใจของคนกรอกตามจอเดิม)
--           lot_size ≥ 2 → lot_mode='accumulate' · null → คงว่าง
-- backward-compatible: คอลัมน์ใหม่ nullable · โค้ดเก่าที่ไม่ส่ง lot_mode ยังทำงาน (ค่าว่าง = พฤติกรรมเดิม)
-- Rollback: create or replace fn_explode_child_demand จาก 20260904_explode_consume_ref_order.sql ·
--           วิวจาก 20260825_demand_blocks_show_capped.sql · คอลัมน์ปล่อยไว้ได้ (nullable) ·
--           ค่าเดิมของ lot_size อยู่ใน kanban_standards_bak_lot1_20260908

begin;

-- ═══ 1) คอลัมน์โหมด + backfill ═══
alter table public.kanban_standards add column if not exists lot_mode text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'kanban_standards_lot_mode_chk') then
    alter table public.kanban_standards add constraint kanban_standards_lot_mode_chk
      check (lot_mode is null or lot_mode in ('accumulate', 'direct'));
  end if;
end $$;

create table if not exists public.kanban_standards_bak_lot1_20260908 as
select * from public.kanban_standards where false;
insert into public.kanban_standards_bak_lot1_20260908
select k.* from public.kanban_standards k
 where k.lot_size = 1
   and not exists (select 1 from public.kanban_standards_bak_lot1_20260908 b where b.id = k.id);

update public.kanban_standards set lot_mode = 'direct', lot_size = null where lot_size = 1;
update public.kanban_standards set lot_mode = 'accumulate' where lot_mode is null and lot_size >= 2;

-- lot_size = 1 ห้ามอีกต่อไป (ต้องอยู่หลัง backfill ไม่งั้น constraint ชนของเดิม)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'kanban_standards_lot_size_chk') then
    alter table public.kanban_standards add constraint kanban_standards_lot_size_chk
      check (lot_size is null or lot_size >= 2);
  end if;
end $$;

comment on column public.kanban_standards.lot_mode is
  'accumulate = สะสมครบ lot_size ค่อยออกใบสั่ง · direct = ไม่สะสม ออกใบเท่ายอดขาดทุกครั้งที่ปิดใบ FG · null = ยังไม่ตั้ง (ค้างใน accumulator) — กติกาอยู่ที่ fn_explode_child_demand';

-- ═══ 2) จุดออกใบจุดเดียว (ของซื้อ → purchase_requests · ผลิตเอง → child_lot_requests + ใบเบิกวัตถุดิบ) ═══
-- เดิม logic นี้ถูกเขียน 1 ชุดในลูป while — พอมีสาย direct เพิ่มจะกลายเป็น 2 ก๊อปที่ drift ได้ จึงแยกออกมา
create or replace function public.fn_emit_child_demand_slip(
  p_mat text, p_part_name text, p_qty numeric, p_line text, p_workdate date, p_prod_no text, p_source_line text)
returns void language plpgsql as $$
declare v_supplier text; v_srcline text; v_lotid uuid; r record;
begin
  if p_qty is null or p_qty <= 0 then return; end if;
  if p_mat like '3%' or p_mat like '5%' then
    -- ของซื้อ (3xx ชิ้นส่วนซื้อ / 5xx เหล็ก) → Planning สั่งซื้อ ไม่ระเบิด BOM ต่อ
    select supplier into v_supplier from parts_master where mat_no = p_mat limit 1;
    insert into purchase_requests(work_date, mat_no, part_name, qty, dest_line, supplier, source_prod_no)
      values (p_workdate, p_mat, p_part_name, p_qty, p_line, v_supplier, p_prod_no);
  else
    -- ผลิตเอง (2xx) → ใบสั่งผลิตให้ไลน์ที่ผลิตพาร์ทนั้น (bom_items.source_line ชนะ · fallback dr_products.line_name)
    v_srcline := coalesce(
      nullif(btrim(p_source_line), ''),
      (select nullif(btrim(d.line_name), '') from dr_products d where d.mat_no = p_mat and d.is_active limit 1));
    insert into child_lot_requests(work_date, child_mat_no, part_name, source_line, lot_qty, source_prod_no)
      values (p_workdate, p_mat, p_part_name, v_srcline, p_qty, p_prod_no) returning id into v_lotid;
    for r in select bi.mat_no, bi.part_name, bi.qty_per_unit
               from dr_products cp join bom_items bi on bi.product_id = cp.id and bi.is_active
              where cp.mat_no = p_mat and cp.is_active loop
      insert into raw_withdrawal_requests(lot_request_id, raw_mat_no, part_name, qty)
        values (v_lotid, r.mat_no, r.part_name, p_qty * r.qty_per_unit);
    end loop;
  end if;
end $$;

-- ═══ 3) ทริกเกอร์ — เพิ่มสาย direct + ข้ามลูกที่เป็น OP · ส่วนอื่นเหมือน 20260904 ทุกประการ ═══
create or replace function public.fn_explode_child_demand()
returns trigger
language plpgsql
as $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; p record;
  v_gross numeric; v_onhand numeric; v_consume numeric; v_short numeric;
  v_lot integer; v_mode text; v_pending numeric; v_made int; v_qty numeric; v_is_op boolean; v_child_op boolean;
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
    -- 2026-09-08: ลูกที่เป็น OP (ขั้นตอนกลาง) ไม่ใช่ของที่สั่งผลิต/สั่งซื้อได้ — ข้ามทั้งแถว
    v_child_op := false;
    select coalesce(is_operation, false) into v_child_op from dr_products where mat_no = b.mat_no and is_active limit 1;
    if coalesce(v_child_op, false) then continue; end if;

    v_gross := v_qty * b.qty_per_unit;
    select coalesce(qty_on_hand,0) into v_onhand
      from line_stock_summary where line_name = v_line and mat_no = b.mat_no;
    if v_onhand is null then v_onhand := 0; end if;
    v_consume := least(v_onhand, v_gross);
    if v_consume < 0 then v_consume := 0; end if;
    v_short := v_gross - v_consume;
    if v_consume > 0 then
      insert into line_stock_transactions(line_name, mat_no, part_name, qty, type, work_date, note, created_by,
                                          ref_order_id, ref_session_id)
        values (v_line, b.mat_no, b.part_name, v_consume, 'consume', v_workdate,
                'auto: FG '||coalesce(NEW.prod_no,'')||' ใช้ mini-store', 'auto',
                NEW.id, NEW.session_id);
    end if;
    if v_short <= 0 then continue; end if;

    v_lot := null; v_mode := null;
    select lot_size, lot_mode into v_lot, v_mode from kanban_standards where mat_no = b.mat_no and is_active limit 1;

    -- ไม่สะสมล็อต: 1 การปิดใบ = 1 ใบสั่ง เท่ายอดที่ขาด (ปัดขึ้น) · ไม่แตะ accumulator
    if v_mode = 'direct' then
      perform public.fn_emit_child_demand_slip(b.mat_no, b.part_name, ceil(v_short), v_line, v_workdate, NEW.prod_no, b.source_line);
      continue;
    end if;

    -- สะสมล็อต (หรือยังไม่ตั้ง = สะสมค้างไว้ให้เห็นใน v_demand_flow_blocks)
    insert into child_demand_accumulator(child_mat_no, pending_qty, updated_at)
      values (b.mat_no, v_short, now())
    on conflict (child_mat_no) do update
      set pending_qty = child_demand_accumulator.pending_qty + excluded.pending_qty, updated_at = now();
    if v_lot is null or v_lot <= 0 then continue; end if;
    select pending_qty into v_pending from child_demand_accumulator where child_mat_no = b.mat_no;
    v_made := 0;
    while v_pending >= v_lot and v_made < MAX_LOTS loop
      perform public.fn_emit_child_demand_slip(b.mat_no, b.part_name, v_lot, v_line, v_workdate, NEW.prod_no, b.source_line);
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

-- ═══ 4) วิวจุดตัน v3 — โหมด direct ที่ยังมียอดค้างจากก่อนสลับโหมด ต้องมองเห็น (ไม่ใช่ "ยังไม่ตั้งล็อต") ═══
create or replace view public.v_demand_flow_blocks as
select a.child_mat_no                                as mat_no,
       coalesce(bi.part_name, pm.part_name)          as part_name,
       round(a.pending_qty)                          as pending_qty,
       a.updated_at,
       case when a.child_mat_no like '3%' or a.child_mat_no like '5%'
            then 'purchase' else 'produce' end       as demand_kind,
       ks.qty_per_kanban                             as suggested_lot,
       (ks.mat_no is not null)                       as has_kanban_row,
       (select d.line_name from dr_products d
         where d.mat_no = a.child_mat_no and d.is_active limit 1) as maker_line,
       case when ks.lot_mode = 'direct'          then 'direct_backlog'
            when coalesce(ks.lot_size, 0) <= 0   then 'no_lot_size'
            else 'backlog_capped' end                as block_reason,
       ks.lot_size                                   as lot_size,
       ks.lot_mode                                   as lot_mode
  from child_demand_accumulator a
  left join kanban_standards ks on ks.mat_no = a.child_mat_no and ks.is_active
  left join parts_master     pm on pm.mat_no = a.child_mat_no
  left join lateral (select part_name from bom_items
                      where mat_no = a.child_mat_no and is_active limit 1) bi on true
 where a.pending_qty > 0
   and (ks.lot_mode = 'direct' or coalesce(ks.lot_size, 0) <= 0 or a.pending_qty >= ks.lot_size);

comment on view public.v_demand_flow_blocks is
  'ความต้องการที่ค้างไม่กลายเป็นใบสั่ง — no_lot_size: ยังไม่ตั้งโหมด/ขนาดล็อต · backlog_capped: ตั้งแล้วแต่เกินเพดานออกใบต่อรอบ (MAX_LOTS) · direct_backlog: โหมดไม่สะสม แต่มียอดค้างจากก่อนสลับโหมด (planner ตัดสินใจเอง ระบบไม่ออกใบให้)';

grant select on public.v_demand_flow_blocks to anon, authenticated;

commit;

-- เช็คผลหลังรัน:
--   select lot_mode, count(*), count(*) filter (where lot_size = 1) lot1_left from kanban_standards where is_active group by 1;
--   select block_reason, count(*), sum(pending_qty) from v_demand_flow_blocks group by 1;
