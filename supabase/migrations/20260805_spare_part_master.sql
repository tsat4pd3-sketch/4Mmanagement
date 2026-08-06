-- คลังอะไหล่ (Spare Part Master) — FM-JIG-009 Spare part list JIG + WI-JIG-010 การแบ่งหมวดหมู่ตามความสำคัญ
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-05
--
-- ที่มา: JIG Maintenance เก็บ spare part list เป็นไฟล์ Excel (FM-JIG-009) — ย้ายเข้าระบบเพื่อให้
--   ค้นหาอะไหล่/ตำแหน่งชั้นวางได้เร็ว, ยอดคงเหลือตรงกับการเบิกจริงในใบ MO, และจัด Rank A/B/C
--   ตาม WI-JIG-010 (Rev.00 · Effective 07/04/2026) โดยคำนวณจากข้อมูลจริงในระบบแทนการกรอกมือ
--
-- additive ทั้งไฟล์ — ตาราง mtn_spare_parts / mtn_stock_txns มีอยู่แล้วจาก 20260714_mtn_work_order.sql
--   + 20260714_mtn_stock_txns.sql (ของเดิมยังทำงานเหมือนเดิมทุกอย่าง)

-- ── 1) หมวดอะไหล่ (data-driven — เพิ่ม/แก้หมวดได้เองไม่ต้องแก้โค้ด) ─────────────
create table if not exists mtn_spare_categories (
  key             text primary key,
  label           text not null,
  icon            text,
  color           text,
  sort_order      int  not null default 0,
  is_active       bool not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz default now(),
  updated_by_name text
);

insert into mtn_spare_categories (key, label, icon, color, sort_order) values
  ('EE', 'ไฟฟ้า/อิเล็กทรอนิกส์', '⚡',  '#f59e0b', 1),
  ('PN', 'นิวเมติกส์/ระบบลม',    '💨',  '#38bdf8', 2),
  ('MC', 'ชิ้นงานกลึง-กัด',      '⚙️',  '#a78bfa', 3),
  ('LP', 'Locating Pin',         '📍',  '#22c55e', 4),
  ('GN', 'ทั่วไป/ฮาร์ดแวร์',      '🔩',  '#94a3b8', 5)
on conflict (key) do nothing;

-- ── 2) ฟิลด์ตามฟอร์ม FM-JIG-009 ──────────────────────────────────────────────
--   team = mtn_teams.key (maintenance/jig_maintenance/die_maintenance/production) — คลังใครคลังมัน
alter table mtn_spare_parts
  add column if not exists team           text not null default 'maintenance',
  add column if not exists mat_no         text,          -- เลข MAT SAP
  add column if not exists part_no        text,          -- Part no. ผู้ผลิต
  add column if not exists supplier       text,
  add column if not exists category       text,          -- → mtn_spare_categories.key
  add column if not exists shelf          text,          -- ตำแหน่งชั้นวาง (หัวใจของ WI: หาอะไหล่ให้เจอเร็ว)
  add column if not exists max_qty        numeric not null default 0,
  add column if not exists unit_price     numeric,
  add column if not exists lead_time_days int,           -- ใช้คำนวณ Rank (แกน Leadtime ตารางที่ 1)
  add column if not exists rank_override  text,          -- ทับ Rank ที่คำนวณได้ (หัวหน้าแผนก/วิศวกรตัดสิน)
  add column if not exists rank_note      text,          -- เหตุผลที่ override
  add column if not exists note           text,
  add column if not exists image_url      text,
  add column if not exists used_with      text;          -- ใช้กับเครื่อง/จิ๊กตัวไหน

do $$ begin
  alter table mtn_spare_parts add constraint mtn_spare_parts_rank_override_chk
    check (rank_override is null or rank_override in ('A', 'B', 'C'));
exception when duplicate_object then null; end $$;

create index if not exists mtn_spare_parts_team_idx     on mtn_spare_parts (team);
create index if not exists mtn_spare_parts_category_idx on mtn_spare_parts (category);
create index if not exists mtn_spare_parts_mat_idx      on mtn_spare_parts (mat_no);

-- ── 3) การใช้งานรายเดือน — แทนคอลัมน์ PI/PO ในไฟล์ Excel เดิม ─────────────────
--   source='system' = สะสมอัตโนมัติจาก ledger · source='manual' = ยอดย้อนหลังที่คีย์เข้ามาจาก Excel
--   (แยก source เพื่อให้ยอดที่ระบบนับเองไม่ถูกทับด้วยยอดที่คนกรอก และย้อนดูได้ว่าเลขมาจากไหน)
create table if not exists mtn_spare_usage_monthly (
  id         uuid primary key default gen_random_uuid(),
  part_id    uuid not null references mtn_spare_parts(id) on delete cascade,
  month_key  text not null,                        -- 'YYYY-MM' (เวลาไทย)
  qty_in     numeric not null default 0,
  qty_out    numeric not null default 0,
  source     text not null default 'system',
  updated_at timestamptz not null default now(),
  unique (part_id, month_key, source)
);
create index if not exists mtn_spare_usage_monthly_part_idx on mtn_spare_usage_monthly (part_id, month_key);

-- ── 4) สะสมยอดใช้รายเดือนอัตโนมัติจาก ledger ─────────────────────────────────
--   best-effort: ถ้า bucket ล้มเหลว ห้ามทำให้การตัด/รับสต็อกพัง (pattern เดียวกับ fn_audit)
create or replace function fn_spare_usage_bucket() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_month text := to_char((new.created_at at time zone 'Asia/Bangkok'), 'YYYY-MM');
  v_in numeric := 0;
  v_out numeric := 0;
begin
  if new.part_id is null then return new; end if;
  if new.type in ('in') then
    v_in := abs(coalesce(new.qty, 0));
  elsif new.type in ('issue', 'consume') then   -- 'consume' = การเบิกใช้ในใบ MO (ชื่อเดิมในระบบ)
    v_out := abs(coalesce(new.qty, 0));
  else
    return new;                                  -- adjust ไม่นับเป็นการใช้งาน (ไม่ให้ปรับยอดดัน Rank)
  end if;

  insert into mtn_spare_usage_monthly (part_id, month_key, qty_in, qty_out, source)
  values (new.part_id, v_month, v_in, v_out, 'system')
  on conflict (part_id, month_key, source) do update
    set qty_in  = mtn_spare_usage_monthly.qty_in  + excluded.qty_in,
        qty_out = mtn_spare_usage_monthly.qty_out + excluded.qty_out,
        updated_at = now();
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists trg_spare_usage_bucket on mtn_stock_txns;
create trigger trg_spare_usage_bucket after insert on mtn_stock_txns
  for each row execute function fn_spare_usage_bucket();

-- ── 5) เคลื่อนไหวสต็อกแบบ atomic (RPC) ───────────────────────────────────────
--   เดิม client อ่าน stock_qty แล้วเขียนกลับ (read-modify-write) — 2 เครื่องเบิกพร้อมกันยอดเพี้ยน
--   และเบิกเกินสต็อกได้ · ย้ายมาทำใน DB: ล็อกแถวด้วย FOR UPDATE + กันติดลบ + ลง ledger ในทรานแซกชันเดียว
create or replace function mtn_stock_move(
  p_part_id uuid, p_type text, p_qty numeric,
  p_note text default null, p_by_name text default null, p_ref_order uuid default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_old numeric;
  v_new numeric;
  v_delta numeric;
begin
  if p_type not in ('in', 'issue', 'adjust') then
    raise exception 'ชนิดรายการไม่ถูกต้อง: %', p_type;
  end if;
  if p_qty is null or (p_type <> 'adjust' and p_qty <= 0) then
    raise exception 'จำนวนต้องมากกว่า 0';
  end if;
  if p_type = 'adjust' and p_qty < 0 then
    raise exception 'ยอดคงเหลือติดลบไม่ได้';
  end if;

  select stock_qty into v_old from mtn_spare_parts where id = p_part_id for update;
  if not found then raise exception 'ไม่พบอะไหล่'; end if;

  if p_type = 'in' then
    v_delta := p_qty;
  elsif p_type = 'issue' then
    v_delta := -p_qty;
    if v_old + v_delta < 0 then
      raise exception 'สต๊อกไม่พอ (คงเหลือ %)', v_old;
    end if;
  else                                   -- adjust: p_qty = ยอดนับจริงที่ต้องการให้เป็น
    v_delta := p_qty - coalesce(v_old, 0);
  end if;

  v_new := coalesce(v_old, 0) + v_delta;
  update mtn_spare_parts
     set stock_qty = v_new, updated_at = now(), updated_by_name = coalesce(p_by_name, updated_by_name)
   where id = p_part_id;

  insert into mtn_stock_txns (part_id, type, qty, balance, note, by_name, ref_order_id)
  values (p_part_id, p_type, v_delta, v_new, p_note, p_by_name, p_ref_order);

  return v_new;
end $$;

-- ── 6) RLS + audit ───────────────────────────────────────────────────────────
--   ฝั่ง DR เป็น anon เสมอ (ดูกฎเหล็ก supabaseDR ใน CLAUDE.md) — allow-all ตาม convention ของ project นี้
alter table mtn_spare_categories  enable row level security;
alter table mtn_spare_usage_monthly enable row level security;
do $$ begin
  create policy mtn_spare_categories_all on mtn_spare_categories for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mtn_spare_usage_monthly_all on mtn_spare_usage_monthly for all using (true) with check (true);
exception when duplicate_object then null; end $$;

drop trigger if exists trg_mtn_spare_categories_updated on mtn_spare_categories;
create trigger trg_mtn_spare_categories_updated before update on mtn_spare_categories
  for each row execute function fn_set_updated_at();

-- master table ที่แก้ไขได้ ต้องมี audit (กฎ Traceability ใน CLAUDE.md)
drop trigger if exists trg_audit on mtn_spare_categories;
create trigger trg_audit after insert or update or delete on mtn_spare_categories
  for each row execute function fn_audit();
