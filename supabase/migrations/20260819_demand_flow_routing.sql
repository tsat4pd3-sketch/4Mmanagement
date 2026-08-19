-- ต่อท่อ "ใบสั่งผลิตลูก → ไลน์ปั๊ม" ที่ขาดอยู่  (DR project)
--
-- ปัญหาที่เจอจาก audit loop การไหลของ demand (2026-08-19):
--   fn_explode_child_demand เขียน child_lot_requests.source_line = bom_items.source_line
--   แต่ `bom_items.source_line` ว่าง **ทั้ง 408 แถว** → ใบสั่งผลิตลูกที่ออกมา 54 ใบ
--   ไม่รู้ว่าต้องส่งให้ไลน์ไหนผลิต (0/54) = ข้อต่อ "Store sub part → Production sub part (Stamping)"
--   ขาดตอน ทั้งที่ระบบรู้คำตอบอยู่แล้วที่ `dr_products.line_name`
--
-- กติกาที่ใช้ (single source of truth เดียวกับทั้งระบบ):
--   "พาร์ทนี้ผลิตที่ไลน์ไหน" = `dr_products.line_name`  ← เจ้าของข้อมูลตัวจริง
--   `bom_items.source_line` = ค่า override รายสูตร (กรอกเองได้ ถ้ากรอกแล้วชนะเสมอ)
--
-- ⚠️ ไม่แตะกฎ lot_size โดยตั้งใจ — พาร์ทที่ไม่ได้ตั้ง lot_size ยังถูกข้ามเหมือนเดิม
--    เพราะ "สั่งครั้งละเท่าไหร่" เป็นการตัดสินใจของคน ห้ามให้ migration เดาแทน
--    (ทำให้ "เห็น" ผ่านวิว v_demand_flow_blocks ด้านล่างแทนการเดาค่าให้)
--
-- Rollback: ดูท้ายไฟล์

-- ── 1) ทริกเกอร์: เติมไลน์ปลายทางให้ใบสั่งผลิตลูก ──────────────────────────
create or replace function public.fn_explode_child_demand()
 returns trigger
 language plpgsql
as $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; r record; p record;
  v_gross numeric; v_onhand numeric; v_consume numeric; v_short numeric;
  v_lot integer; v_pending numeric; v_lotid uuid; v_supplier text; v_srcline text;
begin
  if NEW.status is distinct from 'confirmed' then return null; end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
  if NEW.qty is null or NEW.qty <= 0 then return null; end if;

  select ps.line_name, ps.work_date into v_line, v_workdate
    from production_sessions ps where ps.id = NEW.session_id;

  select id, name into v_fg, v_fgname from dr_products where mat_no = NEW.mat_no and is_active limit 1;
  if v_fg is null then return null; end if;

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
    -- ไม่ตั้ง lot_size = ยังสั่งไม่ได้ (คนต้องตัดสินใจก่อน) — ยอดค้างสะสมไว้ใน accumulator
    -- และโผล่ที่วิว v_demand_flow_blocks ให้ตามไปตั้งค่า **ห้ามเดาค่าให้ตรงนี้**
    if v_lot is null or v_lot <= 0 then continue; end if;
    select pending_qty into v_pending from child_demand_accumulator where child_mat_no = b.mat_no;
    while v_pending >= v_lot loop
      if b.mat_no like '3%' or b.mat_no like '5%' then
        select supplier into v_supplier from parts_master where mat_no = b.mat_no limit 1;
        insert into purchase_requests(work_date, mat_no, part_name, qty, dest_line, supplier, source_prod_no)
          values (v_workdate, b.mat_no, b.part_name, v_lot, v_line, v_supplier, NEW.prod_no);
      else
        -- ไลน์ที่ต้องผลิตพาร์ทลูกตัวนี้: กรอกไว้ในสูตรชนะก่อน ไม่งั้นถามทะเบียนสินค้า
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
    end loop;
    update child_demand_accumulator set pending_qty = v_pending, updated_at = now() where child_mat_no = b.mat_no;
  end loop;

  for p in select * from product_packaging where product_id = v_fg and is_active loop
    insert into packaging_withdrawal_requests(work_date, product_mat_no, product_name, source_line, packaging_code, packaging_name, qty, source_prod_no)
      values (v_workdate, NEW.mat_no, v_fgname, v_line, p.packaging_code, p.packaging_name,
              ceil(NEW.qty::numeric / greatest(p.pcs_per_pkg,1)), NEW.prod_no);
  end loop;

  return null;
end;
$function$;

-- ── 2) ซ่อมใบเก่าที่ออกไปแล้วโดยไม่รู้ไลน์ปลายทาง ─────────────────────────
-- แตะเฉพาะใบที่ยังไม่ปิด (pending/producing) และยังว่างอยู่เท่านั้น
update child_lot_requests c
   set source_line = d.line_name
  from dr_products d
 where d.mat_no = c.child_mat_no and d.is_active
   and coalesce(btrim(d.line_name),'') <> ''
   and coalesce(btrim(c.source_line),'') = ''
   and c.status in ('pending','producing');

-- ── 3) วิว "จุดที่ตัน" — ห้ามล้มเหลวเงียบ ────────────────────────────────
-- ความต้องการที่สะสมไว้แล้วแต่ออกใบสั่งไม่ได้ เพราะยังไม่ได้ตั้ง lot_size
-- คอลัมน์ suggested_lot = "1 กล่อง" ตามบรรจุจริง ใช้เป็น **ค่าเสนอให้คนกดยืนยัน**
-- ไม่ใช่ค่าที่ระบบตั้งเอง (ดูกฎด้านบน)
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
         where d.mat_no = a.child_mat_no and d.is_active limit 1) as maker_line
  from child_demand_accumulator a
  left join kanban_standards ks on ks.mat_no = a.child_mat_no and ks.is_active
  left join parts_master     pm on pm.mat_no = a.child_mat_no
  left join lateral (select part_name from bom_items
                      where mat_no = a.child_mat_no and is_active limit 1) bi on true
 where a.pending_qty > 0
   and coalesce(ks.lot_size, 0) <= 0;

comment on view public.v_demand_flow_blocks is
  'ความต้องการที่ค้างเพราะยังไม่ได้ตั้ง lot_size — ใช้เป็น worklist ให้ planner ไล่ตั้งค่า (ระบบไม่ตั้งให้เอง)';

grant select on public.v_demand_flow_blocks to anon, authenticated;

-- ── Rollback ─────────────────────────────────────────────────────────────
-- 1) คืนทริกเกอร์เดิม: เปลี่ยน v_srcline กลับเป็น b.source_line ตรงๆ
-- 2) ข้อ 2 ย้อนไม่ได้อัตโนมัติ (เป็นการเติมข้อมูลที่ขาด) — ถ้าต้องการล้าง:
--    update child_lot_requests set source_line = null where status in ('pending','producing');
-- 3) drop view public.v_demand_flow_blocks;
