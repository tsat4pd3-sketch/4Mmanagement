-- DR project ("Product DB" · eyhclzkifitbhbljgoav)
-- 2026-10-19 · user เคาะ "ตั้งรายพาร์ทเอง" — โหมดกฎรับเข้า 🔧 "ปิดล็อตที่สโตร์" แทนการเดาจาก child_lot_requests
--
-- เหตุ: 20261006d ให้ fn_post_confirmed_output ข้าม MAT ที่ "เคยมีใบล็อต (ไม่นับ cancelled)" ตลอดไป
--   ⇒ GOR 297 (20058498) เลิกเปิดล็อตตั้งแต่ 09/09 แต่ยังผลิตทุกวัน → ยอดไม่เข้าคลังเลย
--     ตั้งแต่ 09/10: 317 ใบ / 4,438 ชิ้น (ไม่มีใบรอรับ ไม่มี ledger)
--   ทาง "นับเป็นล็อตเฉพาะตอนมีล็อตค้าง" ใช้ไม่ได้: สโตร์เปิดล็อตย้อนครอบของที่ผลิตไปแล้ว
--     (20066660 ล็อต 3,600 เปิด 13/10 ครอบยอดผลิต 02/10+07/10) ⇒ ลงซ้ำ 2 ทาง
--
-- ใหม่: กฎ MAT ตรงตัว mode='lot' = ข้าม (ยอดเข้าทางปิดล็อตที่บอร์ดสโตร์ทางเดียว · เหมือน 06/10)
--   · seed ทุก MAT ที่เคยมีใบล็อต (ไม่นับ cancelled) = พฤติกรรมเดิมเป๊ะ — ยกเว้น 20058498 ตั้งเป็น 🟡 ยืนยันรับ → STORE
--   · ล็อตใบแรกของ MAT ที่ยังไม่มีกฎ MAT → ลงทะเบียนโหมด lot ให้เอง (กันลงซ้ำแบบ 06/10) · มีกฎ MAT แล้ว = ไม่แตะ
--   · คลังในแถวกฎโหมด lot ไม่ถูกใช้ (จอ: inflowDestOf ข้ามกฎ lot → ถอยไป prefix เหมือนเดิม)
--   · แก้/ยกเลิกต่อพาร์ทได้ที่ /line-stock?tab=inflow (ไม่ hardcode)
--
-- ย้อน (ลำดับ): ① รันนิยาม fn_post_confirmed_output จาก 20261006d_child_lot_single_stock_path_dr.sql
--   ② drop trigger trg_child_lot_register_inflow on child_lot_requests; drop function fn_child_lot_register_inflow();
--   ③ delete from stock_inflow_rules where updated_by_name = 'ระบบ · กฎล็อต 19/10';
--      (constraint เดิม: check (mode = any (array['auto','confirm'])) — ลบแถว lot ทั้งหมดก่อนค่อยคืน)
--   ④ (ใบรอรับย้อนหลัง) update stock_receipts set status='cancelled', cancel_reason='ย้อน migration 19/10', cancelled_at=now()
--        where id in (select id from archive.fix_20261019_gor_backfill_receipts) and status='pending';

-- ✅ apply แล้ว 2026-10-19 (รันทีละขั้นผ่าน execute_sql · apply_migration ทั้งก้อนหมดเวลา 2 รอบแล้วย้อนเองหมด)
--    🔴 ลำดับสำคัญ: ① แทนฟังก์ชัน ⇒ ต้อง seed ③ ทันที (ช่องว่างระหว่างนั้น MAT ล็อตจะลงสต็อก — ตรวจแล้ว 0 ใบ)
--    ⇒ ไฟล์นี้เรียง constraint + seed ไว้ก่อนแทนฟังก์ชันแล้ว (รันซ้ำทั้งไฟล์ได้ · idempotent)
set lock_timeout = '5s';

create schema if not exists archive;
create table if not exists archive.stock_inflow_rules_before_20261019 as select now() backed_up_at, * from public.stock_inflow_rules;

-- ⓪ โหมด lot ต้องผ่าน check constraint (เดิม auto/confirm) · lot ใช้ได้เฉพาะกฎ MAT (prefix = ทั้งตระกูลหายเงียบ)
alter table public.stock_inflow_rules drop constraint if exists stock_inflow_rules_mode_chk;
alter table public.stock_inflow_rules add constraint stock_inflow_rules_mode_chk
  check (mode = any (array['auto','confirm','lot']) and (mode <> 'lot' or match_type = 'mat'));

-- ③ seed — พฤติกรรมเดิมเป๊ะ ยกเว้น GOR 20058498 (ลงก่อนแทนฟังก์ชัน ไม่ให้มีช่องว่าง)
insert into stock_inflow_rules (match_type, match_value, dest_line_name, mode, is_active, updated_by_name)
select 'mat', l.child_mat_no,
       coalesce((select dest_line_name from stock_inflow_rules p
                  where p.match_type = 'prefix' and left(l.child_mat_no, length(p.match_value)) = p.match_value
                  order by length(p.match_value) desc limit 1), 'STORE'),
       'lot', true, 'ระบบ · กฎล็อต 19/10'
from (select distinct child_mat_no from child_lot_requests
       where status <> 'cancelled' and coalesce(child_mat_no, '') <> '' and child_mat_no <> '20058498') l
on conflict (match_type, match_value) do nothing;

insert into stock_inflow_rules (match_type, match_value, dest_line_name, mode, is_active, updated_by_name)
values ('mat', '20058498', 'STORE', 'confirm', true, 'ระบบ · กฎล็อต 19/10')
on conflict (match_type, match_value) do nothing;

-- ① trigger: เลิกถาม child_lot_requests · กฎ MAT โหมด lot = ข้าม
create or replace function public.fn_post_confirmed_output()
 returns trigger
 language plpgsql
as $function$
declare
  v_line text; v_workdate date; v_dest text; v_mode text; v_name text; v_qty numeric; v_is_op boolean;
  v_partial boolean := false;
begin
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

  select coalesce(is_operation, false) into v_is_op
    from dr_products where mat_no = NEW.mat_no limit 1;
  if coalesce(v_is_op, false) then return null; end if;

  if exists (select 1 from line_stock_transactions
             where ref_order_id = NEW.id and type = 'issue' and created_by = 'auto') then
    return null;
  end if;
  if exists (select 1 from stock_receipts
             where prod_order_id = NEW.id and status in ('pending', 'received')) then
    return null;
  end if;

  select dest_line_name, mode into v_dest, v_mode from stock_inflow_rules
   where is_active
     and ((match_type = 'mat' and match_value = NEW.mat_no)
       or (match_type = 'prefix' and left(NEW.mat_no, length(match_value)) = match_value))
   order by case when match_type = 'mat' then 0 else 1 end, length(match_value) desc
   limit 1;
  -- 19/10 — 🔧 ยอดเข้าทางปิดล็อตที่บอร์ดสโตร์ทางเดียว (ตั้งรายพาร์ทที่ /line-stock?tab=inflow)
  if v_mode = 'lot' then return null; end if;
  if v_dest is null then return null; end if;

  select ps.work_date, ps.line_name into v_workdate, v_line
    from production_sessions ps where ps.id = NEW.session_id;
  v_workdate := coalesce(v_workdate, work_date_bangkok());
  select name into v_name from dr_products where mat_no = NEW.mat_no and is_active limit 1;

  if v_mode = 'confirm' then
    insert into stock_receipts
      (prod_order_id, prod_no, mat_no, part_name, qty_expected, dest_line_name, source_line,
       ref_session_id, work_date, partial_reason)
    values
      (NEW.id, NEW.prod_no, NEW.mat_no, coalesce(v_name, NEW.part_name), v_qty, v_dest, v_line,
       NEW.session_id, v_workdate,
       case when v_partial then (case when NEW.status = 'cancelled' then 'ยกเลิกใบ' else 'ยกยอดข้ามกะ' end) end);
    return null;
  end if;

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

-- ② ล็อตใบแรกของ MAT ที่ยังไม่มีกฎ MAT → ลงทะเบียนโหมด lot (มีกฎ MAT แล้ว = คนตัดสินไปแล้ว ไม่ทับ)
--   🔴 ใบล็อตเกิดจาก trigger บน prod_orders (client anon) ⇒ ห้ามให้ RLS ของ stock_inflow_rules ทำการปิดใบผลิตล้ม
--      security definer + ห่อ exception (ล้ม = ข้ามการลงทะเบียน · trigger ยังข้ามไม่ได้ ⇒ เห็นเป็นใบรอรับ ไม่เงียบ)
create or replace function public.fn_child_lot_register_inflow()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
as $function$
begin
  if NEW.status = 'cancelled' or coalesce(NEW.child_mat_no, '') = '' then return null; end if;
  begin
    insert into stock_inflow_rules (match_type, match_value, dest_line_name, mode, is_active, updated_by_name)
    select 'mat', NEW.child_mat_no,
           coalesce((select dest_line_name from stock_inflow_rules p
                      where p.match_type = 'prefix' and left(NEW.child_mat_no, length(p.match_value)) = p.match_value
                      order by length(p.match_value) desc limit 1), 'STORE'),
           'lot', true, 'ระบบ · ล็อตใบแรก ' || to_char(work_date_bangkok(), 'DD/MM')
    on conflict (match_type, match_value) do nothing;
  exception when others then
    raise warning 'fn_child_lot_register_inflow: % (%)', sqlerrm, NEW.child_mat_no;
  end;
  return null;
end; $function$;

drop trigger if exists trg_child_lot_register_inflow on public.child_lot_requests;
create trigger trg_child_lot_register_inflow after insert on public.child_lot_requests
  for each row execute function public.fn_child_lot_register_inflow();

-- ④ ใบรอรับย้อนหลังของ GOR (user เคาะ "ออกใบรอรับย้อนหลังให้สโตร์นับรับ") — สโตร์นับของจริงแล้วกดรับเอง
--   ผลจริง 19/10: 323 ใบ / 4,522 ชิ้น (work_date 09/10–18/10)
create table if not exists archive.fix_20261019_gor_backfill_receipts (id uuid primary key, prod_order_id uuid, qty numeric, created_at timestamptz default now());
with ins as (
  insert into stock_receipts (prod_order_id, prod_no, mat_no, part_name, qty_expected, dest_line_name, source_line, ref_session_id, work_date)
  select o.id, o.prod_no, o.mat_no, coalesce(p.name, o.part_name), coalesce(o.qty_ok, o.qty), 'STORE', s.line_name, o.session_id, s.work_date
  from prod_orders o
  join production_sessions s on s.id = o.session_id
  left join lateral (select name from dr_products where mat_no = o.mat_no and is_active limit 1) p on true
  where o.mat_no = '20058498' and o.status = 'confirmed' and s.work_date >= '2026-10-06'
    and coalesce(o.qty_ok, o.qty) > 0
    and not exists (select 1 from stock_receipts r where r.prod_order_id = o.id and r.status <> 'cancelled')
    and not exists (select 1 from line_stock_transactions x where x.ref_order_id = o.id and x.type = 'issue')
  returning id, prod_order_id, qty_expected)
insert into archive.fix_20261019_gor_backfill_receipts (id, prod_order_id, qty)
select id, prod_order_id, qty_expected from ins;

-- ตรวจ:
--   select mode, count(*) from stock_inflow_rules where match_type='mat' group by 1;
--   select count(*), sum(qty) from archive.fix_20261019_gor_backfill_receipts;
--   select status, count(*), sum(qty_expected) from stock_receipts where mat_no='20058498' and created_at > now()-interval '1 day' group by 1;
