-- รับงานเข้า stock อัตโนมัติทันทีที่ปิดออเดอร์ (scan close → prod_orders.status='confirmed')
-- ไม่ต้องรอปิดกะ: MAT เบอร์ 1xxx (FG) → FG WAREHOUSE · เบอร์ 2xxx (child) → STORE
-- ปลายทางปรับได้จากหน้า Store management → ⚙️ รับเข้าอัตโนมัติ (ตาราง stock_inflow_rules)
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — RLS to public ตามกฎ DR (client anon เท่านั้น)

create table if not exists stock_inflow_rules (
  id uuid primary key default gen_random_uuid(),
  match_type text not null check (match_type in ('prefix','mat')),  -- prefix = ขึ้นต้นด้วย / mat = ตรงตัว
  match_value text not null,
  dest_line_name text not null,             -- line_name ปลายทางใน line_stock_transactions
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (match_type, match_value)
);

alter table stock_inflow_rules enable row level security;
drop policy if exists "stock_inflow_rules_select" on stock_inflow_rules;
create policy "stock_inflow_rules_select" on stock_inflow_rules for select to public using (true);
drop policy if exists "stock_inflow_rules_write" on stock_inflow_rules;
create policy "stock_inflow_rules_write" on stock_inflow_rules for all to public using (true) with check (true);

insert into stock_inflow_rules (match_type, match_value, dest_line_name) values
  ('prefix', '1', 'FG WAREHOUSE'),
  ('prefix', '2', 'STORE'),
  ('prefix', '3', 'STORE')   -- เบอร์ 300 = พาร์ทย่อยเช่นเดียวกับ 200 (เพิ่ม 2026-07-22 — ⚠️ แถวนี้ยังไม่ apply บน DR: เพิ่มเองได้จาก Store management → ⚙️ รับเข้าอัตโนมัติ หรือรัน insert นี้)
on conflict (match_type, match_value) do nothing;

-- คอลัมน์อ้างอิง order ต้นทาง (nullable — แถวเดิม/การกรอกมือไม่กระทบ) ใช้กันโพสต์ซ้ำ + ตามรอย
alter table line_stock_transactions add column if not exists ref_order_id uuid;
alter table line_stock_transactions add column if not exists ref_session_id uuid;
create index if not exists idx_lst_ref_order on line_stock_transactions (ref_order_id) where ref_order_id is not null;

-- trigger คู่กับ trg_explode_child_demand (ขาหักวัตถุดิบ) — อันนี้คือขารับผลผลิตเข้า
create or replace function fn_post_confirmed_output() returns trigger as $$
declare
  v_line text; v_workdate date; v_dest text; v_name text; v_qty numeric;
begin
  if NEW.status is distinct from 'confirmed' then return null; end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'confirmed' then return null; end if;
  v_qty := coalesce(NEW.qty_ok, NEW.qty);
  if v_qty is null or v_qty <= 0 or NEW.mat_no is null then return null; end if;

  -- กันโพสต์ซ้ำกรณีสถานะถูกอัปเดตเป็น confirmed ซ้ำ
  if exists (select 1 from line_stock_transactions
             where ref_order_id = NEW.id and type = 'issue' and created_by = 'auto') then
    return null;
  end if;

  -- หา rule: จับคู่ mat ตรงตัวชนะ prefix, prefix ยาวกว่าชนะสั้นกว่า
  select dest_line_name into v_dest from stock_inflow_rules
   where is_active
     and ((match_type = 'mat' and match_value = NEW.mat_no)
       or (match_type = 'prefix' and left(NEW.mat_no, length(match_value)) = match_value))
   order by case when match_type = 'mat' then 0 else 1 end, length(match_value) desc
   limit 1;
  if v_dest is null then return null; end if;

  select ps.work_date, ps.line_name into v_workdate, v_line
    from production_sessions ps where ps.id = NEW.session_id;
  select name into v_name from dr_products where mat_no = NEW.mat_no and is_active limit 1;

  insert into line_stock_transactions
    (line_name, mat_no, part_name, qty, type, ref_session_id, ref_order_id, work_date, note, created_by)
  values
    (v_dest, NEW.mat_no, coalesce(v_name, NEW.part_name), v_qty, 'issue',
     NEW.session_id, NEW.id, coalesce(v_workdate, current_date),
     'auto: ปิดออเดอร์ ' || coalesce(NEW.prod_no, '') || ' จากไลน์ ' || coalesce(v_line, '-'), 'auto');
  return null;
end; $$ language plpgsql;

drop trigger if exists trg_post_confirmed_output on prod_orders;
create trigger trg_post_confirmed_output
  after insert or update of status on prod_orders
  for each row execute function fn_post_confirmed_output();

-- Rollback:
--   drop trigger if exists trg_post_confirmed_output on prod_orders;
--   drop function if exists fn_post_confirmed_output();
--   drop table if exists stock_inflow_rules;
--   คอลัมน์ ref_order_id/ref_session_id เก็บไว้ได้ (nullable ไม่กระทบระบบเดิม)
--   (แถว stock ที่ post ไปแล้ว: ลบ/แก้ได้จากหน้า Line Stock ตามปกติ — created_by = 'auto')
