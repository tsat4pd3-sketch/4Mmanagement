-- แก้ 2 สีแดงของ QC flow-audit 2026-08-25 ในไฟล์เดียว (ต้องรันคู่กัน — แตะ 2 ฟังก์ชัน + trigger ชุดเดียวกัน)
-- Project: DR (eyhclzkifitbhbljgoav) · patch จาก pg_get_functiondef ที่ dump จาก DB จริง 2026-08-25
--
-- #10/#18 — ยอดผลิตบางส่วนของใบที่ "ยกยอด/ยกเลิก" ไม่เคยเข้าคลัง/ไม่เคย backflush เลย:
--   ใบยกยอดข้ามกะ กะแรกทำได้ 18/35 → สต็อก+backflush ของ 18 ชิ้นนั้นหายถาวร
--   (กะถัดไปใบใหม่ qty = 17 ที่เหลือ — โพสต์เฉพาะส่วนที่เหลือตอนปิดใบสุดท้าย)
-- #11/#17 — ถอยใบ (↩️) แล้วสแกนปิดใหม่ = fn_explode_child_demand ระเบิด BOM ซ้ำ 2 เท่า:
--   ฝั่ง inflow มี guard (เช็คแถว ledger ref_order_id) แต่ฝั่ง explode ไม่มี dedup ต่อใบเลย
--   → หักมินิสโตร์ซ้ำ + demand สะสมซ้ำ + ใบสั่งซื้อ/ใบล็อตออกซ้ำ
--
-- ⚠️ รันทั้งไฟล์ในครั้งเดียว (SQL Editor วางทั้งก้อน) — แบ่งรันครึ่งเดียวจะได้ trigger/function ไม่ครบชุด

-- ── A) ตาราง marker กันระเบิดซ้ำ — 1 ใบผลิต ระเบิด BOM ได้ครั้งเดียวตลอดชีวิตใบ ──
-- (ถอยใบเป็นการ update แถวเดิม ไม่ insert ใหม่ → marker ตาม id ครอบทั้ง revert+reclose)
create table if not exists public.child_demand_explosions (
  order_id    uuid primary key references public.prod_orders(id) on delete cascade,
  exploded_at timestamptz not null default now()
);

-- seed marker ให้ใบที่ระเบิดไปแล้วในอดีต:
--   confirmed = เคยผ่าน trigger แน่นอน · reopen_count > 0 = เคย confirmed มาก่อน (ถูกถอยใบ)
--   → ใบพวกนี้ปิดใหม่ต้อง "ไม่" ระเบิดซ้ำ
insert into public.child_demand_explosions(order_id)
  select id from public.prod_orders
   where status = 'confirmed' or coalesce(reopen_count, 0) > 0
on conflict (order_id) do nothing;

-- ── B) fn_explode_child_demand — เพิ่ม dedup ต่อใบ + branch ยอดบางส่วน + OP guard ──
CREATE OR REPLACE FUNCTION public.fn_explode_child_demand()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_line text; v_workdate date; v_fg uuid; v_fgname text; b record; r record; p record;
  v_gross numeric; v_onhand numeric; v_consume numeric; v_short numeric;
  v_lot integer; v_pending numeric; v_lotid uuid; v_supplier text; v_srcline text;
  v_made int; v_qty numeric; v_is_op boolean;
  MAX_LOTS constant int := 50;
begin
  /* 2 ทางเข้า (QC flow-audit #18):
     1) ปิดใบปกติ (→ confirmed)            → ระเบิดจาก qty เต็มใบ (พฤติกรรมเดิม)
     2) ยกยอด/ยกเลิกตอนปิดกะ (→ carry_over/cancelled) ที่มี qty_actual > 0
        → ระเบิดจาก "ยอดที่ผลิตจริงบางส่วน" — ใบกะถัดไป (แถวใหม่ qty = ส่วนที่เหลือ)
          จะระเบิดส่วนที่เหลือตอนปิด รวมกันได้เท่ายอดจริงพอดี ไม่ซ้ำไม่ขาด */
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

  /* dedup ต่อใบ (QC flow-audit #11/#17) — insert marker เป็นตัว claim แบบ atomic:
     ใบเดียวกันยิงพร้อมกัน 2 ทรานแซกชัน ตัวที่สองชน unique แล้วออกเงียบ
     · ถอยใบแล้วปิดใหม่ = marker ยังอยู่ → ไม่ระเบิดซ้ำ (ตัว revert ไม่เคยถอน demand คืน) */
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
  -- 🔩 รายการขั้นตอน (OP) ไม่ใช่พาร์ทจริง — ห้ามระเบิด BOM/หักมินิสโตร์ (guard เดียวกับฝั่ง inflow)
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
              ceil(v_qty::numeric / greatest(p.pcs_per_pkg,1)), NEW.prod_no);
  end loop;

  return null;
end;
$function$;

-- ── C) fn_post_confirmed_output — เพิ่ม branch โพสต์ยอดบางส่วนของใบยกยอด/ยกเลิก ──
CREATE OR REPLACE FUNCTION public.fn_post_confirmed_output()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_line text; v_workdate date; v_dest text; v_name text; v_qty numeric; v_is_op boolean;
  v_partial boolean := false;
begin
  /* 2 ทางเข้า (QC flow-audit #10):
     1) ปิดใบ (→ confirmed)                       → โพสต์ qty_ok ?? qty (พฤติกรรมเดิม)
     2) ยกยอด/ยกเลิกตอนปิดกะ ที่ qty_actual > 0    → โพสต์ยอดที่ผลิตจริงบางส่วน
        (ใบกะถัดไปเป็นแถวใหม่ qty = ส่วนที่เหลือ → โพสต์ส่วนที่เหลือตอนปิด รวม = ยอดจริง) */
  if NEW.status = 'confirmed' then
    if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
    v_qty := coalesce(NEW.qty_ok, NEW.qty);
  elsif TG_OP = 'UPDATE' and NEW.status in ('carry_over', 'cancelled')
        and OLD.status is distinct from NEW.status then
    v_qty := NEW.qty_actual;
    v_partial := true;
  else
    return null;
  end if;
  if v_qty is null or v_qty <= 0 or NEW.mat_no is null then return null; end if;

  -- 🔩 รายการขั้นตอน (OP) ไม่ใช่ของในคลัง — ข้ามเสมอ ห้ามพึ่งว่าชื่อจะไม่ตรง prefix rules
  select coalesce(is_operation, false) into v_is_op
    from dr_products where mat_no = NEW.mat_no limit 1;
  if coalesce(v_is_op, false) then return null; end if;

  -- กันโพสต์ซ้ำต่อใบ (ตัวเดียวกันนี้คือจุดที่ "↩️ ถอยใบ" ลบแถวเพื่อให้สแกนปิดใหม่โพสต์ได้อีก)
  if exists (select 1 from line_stock_transactions
             where ref_order_id = NEW.id and type = 'issue' and created_by = 'auto') then
    return null;
  end if;

  select dest_line_name into v_dest from stock_inflow_rules
   where is_active
     and ((match_type = 'mat' and match_value = NEW.mat_no)
       or (match_type = 'prefix' and left(NEW.mat_no, length(match_value)) = match_value))
   order by case when match_type = 'mat' then 0 else 1 end, length(match_value) desc
   limit 1;
  if v_dest is null then return null; end if;

  select ps.work_date, ps.line_name into v_workdate, v_line
    from production_sessions ps where ps.id = NEW.session_id;
  -- fallback = work date ไทย (ตัด 08:00) — ห้าม current_date (UTC)
  v_workdate := coalesce(v_workdate, work_date_bangkok());
  select name into v_name from dr_products where mat_no = NEW.mat_no and is_active limit 1;

  insert into line_stock_transactions
    (line_name, mat_no, part_name, qty, type, ref_session_id, ref_order_id, work_date, note, created_by)
  values
    (v_dest, NEW.mat_no, coalesce(v_name, NEW.part_name), v_qty, 'issue',
     NEW.session_id, NEW.id, v_workdate,
     case when v_partial
       then 'auto: '||(case when NEW.status = 'cancelled' then 'ยกเลิกใบ' else 'ยกยอดข้ามกะ' end)
            ||' '||coalesce(NEW.prod_no, '')||' — ยอดทำจริงบางส่วน '||round(v_qty)||' ชิ้น จากไลน์ '||coalesce(v_line, '-')
       else 'auto: ปิดออเดอร์ '||coalesce(NEW.prod_no, '')||' จากไลน์ '||coalesce(v_line, '-')
     end, 'auto');
  return null;
end; $function$;

-- ── D) trigger — สร้างใหม่ให้ยิงทุก status transition (branch ใหม่ต้องเห็น carry_over/cancelled) ──
-- drop ทุก trigger บน prod_orders ที่ชี้ 2 ฟังก์ชันนี้ (ไม่ต้องเดาชื่อเดิม) แล้วสร้างชื่อ canonical
do $$
declare t record;
begin
  for t in
    select tgname from pg_trigger
     where tgrelid = 'public.prod_orders'::regclass and not tgisinternal
       and tgfoid in ('public.fn_post_confirmed_output()'::regprocedure,
                      'public.fn_explode_child_demand()'::regprocedure)
  loop
    execute format('drop trigger %I on public.prod_orders', t.tgname);
  end loop;
end $$;

create trigger trg_post_confirmed_output
  after insert or update on public.prod_orders
  for each row execute function public.fn_post_confirmed_output();

create trigger trg_explode_child_demand
  after insert or update on public.prod_orders
  for each row execute function public.fn_explode_child_demand();

-- ── ตรวจหลังรัน ──────────────────────────────────────────────────────────
-- 1) trigger ต้องเหลือ 2 ตัวชื่อ canonical:
--    select tgname from pg_trigger where tgrelid='public.prod_orders'::regclass
--      and not tgisinternal and tgfoid in ('public.fn_post_confirmed_output()'::regprocedure,
--                                          'public.fn_explode_child_demand()'::regprocedure);
-- 2) marker seed แล้ว (ควร ≈ จำนวนใบ confirmed):
--    select count(*) from child_demand_explosions;
-- 3) ของเก่า: ใบ carry_over/cancelled ในอดีตที่มี qty_actual แต่ไม่เคยเข้าคลัง — **ไม่ backfill ให้**
--    (สต็อกช่วงนั้นถูกชดเชย/นับจริงไปแล้ว การยัดยอดเก่าเข้า ledger ตอนนี้จะทำยอดปัจจุบันเพี้ยน)
--    ดูขนาดได้ด้วย:
--    select count(*) n, sum(qty_actual) pcs from prod_orders
--      where status in ('carry_over','cancelled','imported') and coalesce(qty_actual,0) > 0
--        and not exists (select 1 from line_stock_transactions t
--                         where t.ref_order_id = prod_orders.id and t.type='issue' and t.created_by='auto');
--
-- Rollback: รัน 20260825_sync_fn_post_confirmed_output.sql (คืนเวอร์ชันก่อนหน้า) +
--   เวอร์ชันเดิมของ fn_explode_child_demand อยู่ในคอมเมนต์ git history ของไฟล์นี้ ·
--   drop table child_demand_explosions; (marker ไม่มีใครอ่านนอกจาก trigger)
