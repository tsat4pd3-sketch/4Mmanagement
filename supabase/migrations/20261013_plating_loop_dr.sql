-- ═══ 🧪 งานชุบภายนอก (outsource plating) — ส่งออก / ค้างร้าน / ทยอยรับคืน / ส่งเข้า W/H / ตัดยอดสิ้นปี ═══
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-13 · คำสั่ง user
--   "planner ส่งออกไปชุบโดยดูเลข MAT 2xx ก่อนชุบ · สโตร์รับกลับด้วยเลข 2xx หลังชุบ · ส่งเข้า W/H ระบบแปลงเป็น 1xx เอง
--    · ให้ user เข้าไป set เอง อย่า hard code"
--
-- 🔴 เส้นทางชุบ = Product Master + BOM เท่านั้น (ไม่มีทะเบียนจับคู่แยก):
--    สินค้า "หลังชุบ" มี `outsource_vendor` (ร้านชุบ · จากทะเบียน suppliers) + BOM ลูก = "ก่อนชุบ"
--    ⇒ ส่ง = ลูกใน BOM · รับคืน = ตัวแม่ · ส่งเข้า W/H = แม่ของ "หลังชุบ" ที่เป็น FG (BOM อีกชั้น)
--    ไม่มีชื่อร้าน/เลข MAT/กระบวนการฝังในโค้ดหรือในฟังก์ชันนี้
-- 🔴 ทุกปุ่มเขียนผ่าน RPC ในไฟล์นี้ (ทำครบทุกแถวในทรานแซกชันเดียว · ล็อกใบก่อนแก้) — ห้ามเขียน 2 ตารางแยกจาก client
--
-- ย้อน (revert โค้ดก่อน แล้วค่อยรัน):
--   drop function if exists public.plating_setup_route(text,text,text,text,text,text);
--   drop function if exists public.plating_bom_insert_layer(uuid,text,text);
--   drop function if exists public.plating_bom_has_child(text,text);
--   drop function if exists public.plating_send(text,text,text,numeric,text,text,text,text);
--   drop function if exists public.plating_receive(text,text,numeric,text,text,text);
--   drop function if exists public.plating_writeoff(text,uuid[],text,text);
--   drop function if exists public.plating_to_wh(text,text,numeric,text,text,text,text);
--   drop table if exists public.plating_moves; drop table if exists public.plating_orders;
--   alter table public.dr_products drop column if exists outsource_vendor;
--   (แถวสต็อก: delete from line_stock_transactions where note like 'ชุบ:%';)

alter table public.dr_products add column if not exists outsource_vendor text;
comment on column public.dr_products.outsource_vendor is
  'ร้านจ้างทำภายนอก (ชื่อตามทะเบียน suppliers) — มีค่า = สินค้านี้ได้มาจากการส่งลูกใน BOM ไปทำข้างนอก (เช่นชุบ) · ว่าง = ผลิตเอง';

-- กระบวนการในทะเบียน (ข้อมูล ไม่ใช่โค้ด — แก้ชื่อ/สี/ปิดได้ที่หน้าทะเบียนกระบวนการ)
insert into public.process_types (key, label, icon, color, is_active, sort_order)
values ('outsource_plating', 'ชุบ (ภายนอก)', '🧪', '#06b6d4', true, 90)
on conflict (key) do nothing;

create table if not exists public.plating_orders (
  id               uuid primary key default gen_random_uuid(),
  vendor           text not null check (btrim(vendor) <> ''),
  vendor_loc       text not null,                 -- ที่เก็บเสมือนใน ledger: "ร้านชุบ · <vendor>"
  before_mat       text not null,                 -- ลูกใน BOM ที่ส่งออกไป
  after_mat        text not null,                 -- แม่ใน BOM ที่จะรับกลับ
  part_name        text,
  qty_sent         numeric not null check (qty_sent > 0),
  qty_received     numeric not null default 0 check (qty_received >= 0),
  qty_written_off  numeric not null default 0 check (qty_written_off >= 0),
  status           text not null default 'open' check (status in ('open','closed','cancelled')),
  from_loc         text not null,                 -- คลังที่ตัดของก่อนชุบออก
  doc_no           text,
  note             text,
  sent_at          timestamptz not null default now(),
  sent_by_name     text,
  closed_at        timestamptz,
  closed_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint plating_orders_qty_chk check (qty_received + qty_written_off <= qty_sent)
);
create index if not exists plating_orders_open_idx on public.plating_orders (vendor, after_mat, sent_at) where status = 'open';
create index if not exists plating_orders_sent_idx on public.plating_orders (sent_at desc);

create table if not exists public.plating_moves (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.plating_orders(id) on delete cascade,
  kind       text not null check (kind in ('receive','writeoff')),
  qty        numeric not null check (qty > 0),
  to_loc     text,
  note       text,
  by_name    text,
  created_at timestamptz not null default now()
);
create index if not exists plating_moves_order_idx on public.plating_moves (order_id);

-- 🔴 DR = anon เสมอ (CLAUDE.md §Supabase Projects) ⇒ policy แบบเดียวกับตารางคลังอื่น (purchase_requests)
alter table public.plating_orders enable row level security;
alter table public.plating_moves  enable row level security;
drop policy if exists allow_all_plating_orders on public.plating_orders;
create policy allow_all_plating_orders on public.plating_orders for all using (true) with check (true);
drop policy if exists allow_all_plating_moves on public.plating_moves;
create policy allow_all_plating_moves on public.plating_moves for all using (true) with check (true);

drop trigger if exists trg_plating_orders_updated on public.plating_orders;
create trigger trg_plating_orders_updated before update on public.plating_orders
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_plating_orders_audit on public.plating_orders;
create trigger trg_plating_orders_audit after insert or update or delete on public.plating_orders
  for each row execute function public.fn_audit();

-- realtime: จอแท็บ 🧪 งานชุบ subscribe ตารางนี้ (ทะเบียน src/utils/realtimeTables.js)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'plating_orders') then
    alter publication supabase_realtime add table public.plating_orders;
  end if;
end $$;

-- ── BOM: "แม่ p_parent มีลูก p_child ไหม" — นิยามเดียวกับ buildBomIndex() (src/utils/bomTree.js)
--    แถวที่ parent_mat = แม่ (ชั้นย่อยในใบของสินค้าอื่น) หรือแถวในใบของแม่เองที่ parent_mat ว่าง
create or replace function public.plating_bom_has_child(p_parent text, p_child text)
returns boolean language sql stable as $$
  select exists (
    select 1 from bom_items b
     where b.mat_no = p_child and coalesce(b.is_active, true)
       and (b.parent_mat = p_parent
            or (b.parent_mat is null and b.product_id in (select id from dr_products where mat_no = p_parent))))
$$;

-- ── ส่งออกไปชุบ ──────────────────────────────────────────────────────────────────
create or replace function public.plating_send(
  p_vendor text, p_before text, p_after text, p_qty numeric,
  p_from_loc text, p_doc_no text, p_note text, p_by text)
returns uuid language plpgsql as $$
declare v_id uuid; v_loc text; v_name text; v_pid uuid; v_bname text;
begin
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนส่งต้องมากกว่า 0'; end if;
  if coalesce(btrim(p_vendor), '') = '' then raise exception 'ยังไม่ได้ระบุร้านชุบ'; end if;
  if coalesce(btrim(p_from_loc), '') = '' then raise exception 'ไม่รู้คลังต้นทาง'; end if;
  -- ไม่บังคับ is_active: สินค้าหลังชุบบางตัวถูกปิดไว้ไม่ให้โผล่ในจอผลิต (เช่น 20059822) แต่ยังเป็นเลข SAP ที่สโตร์รับจริง
  select id, name into v_pid, v_name from dr_products where mat_no = p_after order by is_active desc limit 1;
  if v_pid is null then raise exception 'ไม่พบสินค้าหลังชุบ % ในทะเบียนสินค้า', p_after; end if;
  if not public.plating_bom_has_child(p_after, p_before) then
    raise exception 'BOM ของ % ยังไม่มี % เป็นลูก — ตั้งเส้นทางชุบก่อน', p_after, p_before;
  end if;
  v_bname := coalesce((select name from dr_products where mat_no = p_before order by is_active desc limit 1), v_name);
  v_loc := 'ร้านชุบ · ' || btrim(p_vendor);
  insert into plating_orders (vendor, vendor_loc, before_mat, after_mat, part_name, qty_sent, from_loc, doc_no, note, sent_by_name)
  values (btrim(p_vendor), v_loc, p_before, p_after, v_name, p_qty, p_from_loc, nullif(btrim(p_doc_no), ''), nullif(btrim(p_note), ''), p_by)
  returning id into v_id;
  insert into line_stock_transactions (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by, reviewed_by, reviewed_at)
  values (p_from_loc, p_before, v_bname, p_qty, 'consume', work_date_bangkok(), 'approved',
          'ชุบ: ส่งไป ' || btrim(p_vendor) || ' (ใบ ' || left(v_id::text, 8) || ')', p_by, p_by, now()),
         (v_loc, p_before, v_bname, p_qty, 'issue', work_date_bangkok(), 'approved',
          'ชุบ: รับจาก ' || p_from_loc || ' (ใบ ' || left(v_id::text, 8) || ')', p_by, p_by, now());
  return v_id;
end $$;

-- ── รับคืนจากร้าน (ทยอยได้ · ตัดใบเก่าสุดก่อน) ─────────────────────────────────────────
create or replace function public.plating_receive(
  p_vendor text, p_after text, p_qty numeric, p_to_loc text, p_note text, p_by text)
returns jsonb language plpgsql as $$
declare r record; v_left numeric := p_qty; v_take numeric; v_open numeric; v_n int := 0; v_name text;
begin
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนรับต้องมากกว่า 0'; end if;
  if coalesce(btrim(p_to_loc), '') = '' then raise exception 'ไม่รู้คลังปลายทาง'; end if;
  select coalesce(sum(qty_sent - qty_received - qty_written_off), 0) into v_open
    from plating_orders where vendor = p_vendor and after_mat = p_after and status = 'open';
  if p_qty > v_open then
    raise exception 'รับเกินยอดค้างร้าน: ค้าง % แต่รับ % — ตรวจนับอีกครั้ง', v_open, p_qty;
  end if;
  for r in select * from plating_orders where vendor = p_vendor and after_mat = p_after and status = 'open'
           order by sent_at, id for update loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty_sent - r.qty_received - r.qty_written_off);
    continue when v_take <= 0;
    update plating_orders set qty_received = qty_received + v_take,
      status = case when qty_received + v_take + qty_written_off >= qty_sent then 'closed' else status end,
      closed_at = case when qty_received + v_take + qty_written_off >= qty_sent then now() else closed_at end,
      closed_reason = case when qty_received + v_take + qty_written_off >= qty_sent then 'รับครบ' else closed_reason end
    where id = r.id;
    insert into plating_moves (order_id, kind, qty, to_loc, note, by_name) values (r.id, 'receive', v_take, p_to_loc, nullif(btrim(p_note), ''), p_by);
    insert into line_stock_transactions (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by, reviewed_by, reviewed_at)
    values (r.vendor_loc, r.before_mat,
            coalesce((select name from dr_products where mat_no = r.before_mat order by is_active desc limit 1), r.part_name),
            v_take, 'consume', work_date_bangkok(), 'approved',
            'ชุบ: ร้านส่งคืน เป็น ' || r.after_mat || ' (ใบ ' || left(r.id::text, 8) || ')', p_by, p_by, now());
    v_left := v_left - v_take; v_n := v_n + 1; v_name := r.part_name;
  end loop;
  -- กันรับพร้อมกัน 2 เครื่อง: ยอดค้างเช็คก่อนล็อก ⇒ ตัดใบไม่ครบ = ยกเลิกทั้งก้อน (ห้ามลงยอดเข้าคลังเกินที่ตัดจากร้าน)
  if v_left > 0 then raise exception 'ยอดค้างร้านเปลี่ยนระหว่างบันทึก — โหลดใหม่แล้วลองอีกครั้ง'; end if;
  insert into line_stock_transactions (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by, reviewed_by, reviewed_at)
  values (p_to_loc, p_after, v_name, p_qty, 'issue', work_date_bangkok(), 'approved',
          'ชุบ: รับคืนจาก ' || p_vendor || coalesce(' · ' || nullif(btrim(p_note), ''), ''), p_by, p_by, now());
  return jsonb_build_object('orders', v_n, 'qty', p_qty);
end $$;

-- ── ตัดยอดค้างร้าน (สิ้นปี · ต้องมีเหตุผล) ─────────────────────────────────────────────
create or replace function public.plating_writeoff(p_vendor text, p_order_ids uuid[], p_reason text, p_by text)
returns jsonb language plpgsql as $$
declare r record; v_rem numeric; v_n int := 0; v_sum numeric := 0;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'ต้องใส่เหตุผลการตัดยอด'; end if;
  for r in select * from plating_orders where vendor = p_vendor and status = 'open'
           and (p_order_ids is null or id = any(p_order_ids)) order by sent_at for update loop
    v_rem := r.qty_sent - r.qty_received - r.qty_written_off;
    continue when v_rem <= 0;
    update plating_orders set qty_written_off = qty_written_off + v_rem, status = 'closed', closed_at = now(),
      closed_reason = 'ตัดยอดค้างร้าน: ' || btrim(p_reason) where id = r.id;
    insert into plating_moves (order_id, kind, qty, note, by_name) values (r.id, 'writeoff', v_rem, btrim(p_reason), p_by);
    insert into line_stock_transactions (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by, reviewed_by, reviewed_at)
    values (r.vendor_loc, r.before_mat,
            coalesce((select name from dr_products where mat_no = r.before_mat order by is_active desc limit 1), r.part_name),
            -v_rem, 'adjust', work_date_bangkok(), 'approved',
            'ชุบ: ตัดยอดค้างร้าน — ' || btrim(p_reason) || ' (ใบ ' || left(r.id::text, 8) || ')', p_by, p_by, now());
    v_n := v_n + 1; v_sum := v_sum + v_rem;
  end loop;
  return jsonb_build_object('orders', v_n, 'qty', v_sum);
end $$;

-- ── ส่งงานหลังชุบเข้า W/H = แปลงเป็น FG ตาม BOM ──────────────────────────────────────
create or replace function public.plating_to_wh(
  p_after text, p_fg text, p_qty numeric, p_from_loc text, p_to_loc text, p_note text, p_by text)
returns jsonb language plpgsql as $$
declare v_fg uuid; v_fgname text; v_qpu numeric; v_aname text; v_fgqty numeric;
begin
  if coalesce(p_qty, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
  if coalesce(btrim(p_from_loc), '') = '' or coalesce(btrim(p_to_loc), '') = '' then raise exception 'ไม่รู้คลังต้นทาง/ปลายทาง'; end if;
  select id, name into v_fg, v_fgname from dr_products where mat_no = p_fg order by is_active desc limit 1;
  if v_fg is null then raise exception 'ไม่พบ FG % ในทะเบียน', p_fg; end if;
  select coalesce(nullif(b.qty_per_unit, 0), 1), b.part_name into v_qpu, v_aname
    from bom_items b where b.mat_no = p_after and coalesce(b.is_active, true)
     and (b.parent_mat = p_fg or (b.parent_mat is null and b.product_id = v_fg))
   order by (b.parent_mat is null and b.product_id = v_fg) desc limit 1;
  if v_qpu is null then raise exception 'BOM ของ % ไม่มี % เป็นลูก — แปลงไม่ได้', p_fg, p_after; end if;
  -- FG ที่มีลูกชั้นบนตัวอื่นด้วย = ต้องประกอบที่ไลน์ (ส่งงานหลังชุบไปไลน์ตามปกติ) ห้ามแปลงตรงที่คลัง
  if exists (select 1 from bom_items b where b.mat_no <> p_after and coalesce(b.is_active, true)
              and (b.parent_mat = p_fg or (b.parent_mat is null and b.product_id = v_fg))) then
    raise exception '% มีชิ้นส่วนอื่นใน BOM — ต้องประกอบที่ไลน์ ส่งเข้า W/H ตรงไม่ได้', p_fg;
  end if;
  v_fgqty := p_qty / v_qpu;
  insert into line_stock_transactions (line_name, mat_no, part_name, qty, type, work_date, status, note, created_by, reviewed_by, reviewed_at)
  values (p_from_loc, p_after, v_aname, p_qty, 'consume', work_date_bangkok(), 'approved',
          'ชุบ: ส่งเข้า ' || p_to_loc || ' เป็น ' || p_fg, p_by, p_by, now()),
         (p_to_loc, p_fg, v_fgname, v_fgqty, 'issue', work_date_bangkok(), 'approved',
          'ชุบ: รับจาก ' || p_from_loc || ' (' || p_after || ' หลังชุบ)' || coalesce(' · ' || nullif(btrim(p_note), ''), ''), p_by, p_by, now());
  return jsonb_build_object('fg', p_fg, 'fg_qty', v_fgqty);
end $$;

-- ── ตั้งเส้นทางชุบ (คนตั้งเองที่จอ ⚙️ — ไม่มีอะไรฝังในโค้ด) ─────────────────────────────
--    สร้าง/อัปเดตสินค้าหลังชุบใน Product Master + ร้าน · ถ้า BOM ยังไม่มีขา "หลังชุบ ← ก่อนชุบ" ⇒ เพิ่มในใบ BOM ของสินค้าหลังชุบ
--    สินค้าหลังชุบที่มีอยู่แล้ว: แก้แค่ร้าน (ไม่แตะชื่อ/สถานะ/กระบวนการที่คนอื่นตั้งไว้)
create or replace function public.plating_setup_route(
  p_before text, p_after text, p_after_name text, p_vendor text, p_process_type text, p_by text)
returns jsonb language plpgsql as $$
declare v_b record; v_aid uuid; v_new boolean := false; v_bom boolean := false; v_item int;
begin
  p_before := btrim(coalesce(p_before, '')); p_after := btrim(coalesce(p_after, ''));
  if p_before = '' or p_after = '' then raise exception 'ต้องระบุทั้งเลขก่อนชุบและหลังชุบ'; end if;
  if p_before = p_after then raise exception 'เลขหลังชุบต้องเป็นคนละเลขกับก่อนชุบ (ชุบแล้ว SAP เปลี่ยนเลขเสมอ)'; end if;
  if coalesce(btrim(p_vendor), '') = '' then raise exception 'ยังไม่ได้ระบุร้านชุบ'; end if;
  select id, name, p_no, customer into v_b from dr_products where mat_no = p_before order by is_active desc limit 1;
  if v_b.id is null then raise exception 'ไม่พบ % (ก่อนชุบ) ในทะเบียนสินค้า', p_before; end if;
  select id into v_aid from dr_products where mat_no = p_after order by is_active desc limit 1;
  if v_aid is null then
    insert into dr_products (mat_no, name, p_no, customer, process_type, is_active, outsource_vendor)
    values (p_after, coalesce(nullif(btrim(p_after_name), ''), v_b.name), v_b.p_no, v_b.customer,
            nullif(btrim(p_process_type), ''), true, btrim(p_vendor))
    returning id into v_aid;
    v_new := true;
  else
    update dr_products set outsource_vendor = btrim(p_vendor) where id = v_aid;
  end if;
  if not public.plating_bom_has_child(p_after, p_before) then
    select coalesce(max(item_no), 0) + 10 into v_item from bom_items where product_id = v_aid and parent_mat is null;
    insert into bom_items (product_id, mat_no, part_name, qty_per_unit, uom, item_no, created_by)
    values (v_aid, p_before, v_b.name, 1, 'PC', v_item, p_by);
    v_bom := true;
  end if;
  return jsonb_build_object('product_created', v_new, 'bom_created', v_bom, 'after_id', v_aid);
end $$;

-- ── แทรกชั้น "หลังชุบ" เหนือบรรทัด BOM ที่ยังใช้ "ก่อนชุบ" ตรงๆ (ทำในทรานแซกชันเดียว) ───────────
--    แบบเดียวกับที่ PE จัดไว้แล้วใน 10092454: แม่ → หลังชุบ (ใหม่ · qty เดิม) → ก่อนชุบ (qty 1 · ลูกหลานเดิมตามมาครบ)
create or replace function public.plating_bom_insert_layer(p_row_id uuid, p_after text, p_by text)
returns uuid language plpgsql as $$
declare r record; v_id uuid; v_aname text;
begin
  select * into r from bom_items where id = p_row_id for update;
  if r.id is null then raise exception 'ไม่พบบรรทัด BOM นี้ (อาจถูกแก้ไปแล้ว)'; end if;
  if r.mat_no = p_after then raise exception 'บรรทัดนี้เป็นหลังชุบอยู่แล้ว'; end if;
  if r.parent_mat = p_after then raise exception 'บรรทัดนี้อยู่ใต้ % แล้ว', p_after; end if;
  select name into v_aname from dr_products where mat_no = p_after order by is_active desc limit 1;
  if v_aname is null then raise exception 'ไม่พบ % ในทะเบียนสินค้า — ตั้งเส้นทางชุบก่อน', p_after; end if;
  -- ย้ายบรรทัดเดิมลงไปก่อน แล้วค่อยวางชั้นใหม่ลงช่องเดิม (unique: product_id + parent_mat + item_no)
  update bom_items set parent_mat = p_after, qty_per_unit = 1 where id = r.id;
  insert into bom_items (product_id, mat_no, part_name, qty_per_unit, uom, item_no, parent_mat, op_no, created_by)
  values (r.product_id, p_after, v_aname, r.qty_per_unit, r.uom, r.item_no, r.parent_mat, r.op_no, p_by)
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.plating_bom_has_child(text,text) to anon, authenticated;
grant execute on function public.plating_setup_route(text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.plating_bom_insert_layer(uuid,text,text) to anon, authenticated;
grant execute on function public.plating_send(text,text,text,numeric,text,text,text,text) to anon, authenticated;
grant execute on function public.plating_receive(text,text,numeric,text,text,text) to anon, authenticated;
grant execute on function public.plating_writeoff(text,uuid[],text,text) to anon, authenticated;
grant execute on function public.plating_to_wh(text,text,numeric,text,text,text,text) to anon, authenticated;

-- ตรวจ:
--   select count(*) from plating_orders;  -- 0 หลัง apply
--   select key, label from process_types where key = 'outsource_plating';
--   select column_name from information_schema.columns where table_name='dr_products' and column_name='outsource_vendor';
