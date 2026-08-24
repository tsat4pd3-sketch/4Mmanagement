-- 🛡️ fn_explode_child_demand — กัน "ใบระเบิด" จาก lot_size ที่ตั้งเล็กผิดปกติ  (DR)
--
-- เคสจริงที่เจอ (audit 2026-08-21):
--   4/8 มีคนตั้ง kanban_standards.lot_size = 1 ให้ `50031601` (คอยล์ · กล่องละ 100)
--   พอปิดใบผลิตใบเดียว loop `while v_pending >= v_lot` วิ่ง **984 รอบ**
--   → ออก purchase_requests 984 ใบ ใบละ 1 ชิ้น ในวินาทีเดียว
--   → คิว "ใบสั่งซื้อค้าง" พองจาก 40 เป็น 1,024 ใบ (96% เป็นขยะ) จนคิวจริงถูกกลบมองไม่เห็น
--   แล้วมีคนล้าง lot_size กลับเป็น null วันเดียวกัน → ตั้งแต่นั้น**ไม่มีใบสั่งซื้อออกอีกเลย 17 วัน**
--
-- ⚠️ ต้นเหตุคือ loop ที่ไม่มีเพดาน — ไม่ใช่ค่า lot_size ที่ผิด (lot_size=1 อาจถูกต้องกับของแพง)
--    ระบบต้องทนค่าที่คนกรอกผิดได้ ไม่ใช่พังทั้งคิว
--
-- สิ่งที่เปลี่ยน: จำกัดจำนวนใบต่อการปิดออเดอร์ 1 ครั้งไว้ที่ MAX_LOTS (50 ใบ)
--   ส่วนที่เหลือ **ไม่หาย** — ค้างอยู่ใน child_demand_accumulator เหมือนเดิม
--   จึงยังโผล่ใน v_demand_flow_blocks / หน้า /flow-tower ให้คนเห็นว่ามีของค้าง
--   (หลัก "ห้ามล้มเหลวเงียบ" — ชะลอการออกใบ ดีกว่าถล่มคิวจนไม่มีใครกล้าแตะ)
--
-- ไม่แตะ: การหักมินิสโตร์ (consume) · การสะสม accumulator · packaging · สูตร BOM

create or replace function public.fn_explode_child_demand()
 returns trigger
 language plpgsql
as $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; r record; p record;
  v_gross numeric; v_onhand numeric; v_consume numeric; v_short numeric;
  v_lot integer; v_pending numeric; v_lotid uuid; v_supplier text; v_srcline text;
  v_made int;                       -- ออกใบไปกี่ใบแล้วสำหรับพาร์ทนี้ (กัน loop ระเบิด)
  MAX_LOTS constant int := 50;      -- เพดานใบต่อพาร์ทต่อการปิดออเดอร์ 1 ครั้ง
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
              ceil(NEW.qty::numeric / greatest(p.pcs_per_pkg,1)), NEW.prod_no);
  end loop;

  return null;
end;
$function$;

-- Rollback: เอา `and v_made < MAX_LOTS` / v_made ออก แล้ว create or replace กลับ (ดูของเดิมใน git)
