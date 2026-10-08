-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- 📥 รับเข้าคลังแบบ "นับของจริงก่อนแล้วค่อยกดรับ" (2026-10-02 · คำสั่ง user)
--
-- user: *"ระบบรับอัตโนมัติถ้า ปิด จะเป็นยังไง คนรับจะต้องคอนเฟิมใช่มั้ย
--         เช็คหน้างานจริงก่อนถ้าตรงค่อยกดรับ"* → เสนอ 4 ข้อ → *"1 2 3 ตามนั้นเลย ·
--         4 คือที่เราพึ่งกดปิดอัตโนมัติไปเมื่อเช้า มีอยู่แล้วใช่มั้ย"*
--
-- 🔴 ต้นเหตุ: กฎ `stock_inflow_rules` มีแค่ เปิด/ปิด — แต่ "ปิด" **ไม่ได้แปลว่าต้องยืนยัน**
--    ปิดแล้ว `fn_post_confirmed_output` แค่ `return null` = ปิดใบผลิตแล้ว**ของไม่เข้าคลังเลย**
--    ไม่มีคิว ไม่มีแจ้งเตือน ยอดคลังต่ำกว่าของจริงไปเรื่อยๆ
--    เกิดจริง 02/10 11:48 ADMIN ปิดทั้ง FG WAREHOUSE + STORE (ตั้งใจให้ "คนรับยืนยัน")
--    ⇒ 5 ใบ/535 ชิ้นแรกหายเงียบ · ปกติเข้า FG ~76 ใบ/วัน · STORE ~44 ใบ/วัน
--
-- ⇒ กฎมี 3 ทางแทน 2:  🟢 auto (เดิม) · 🟡 confirm (ใหม่ — เข้าคิว `stock_receipts`) · ⚫ ปิด (ไม่เข้าเลย)
--    · 1 ปิดใบผลิต → ใบเข้าคิว "รอรับเข้า" (ยังไม่บวกสต็อก)
--    · 2 คนรับนับของจริง → `stock_receipt_confirm()` · ไม่ตรง = ต้องกรอกยอดที่นับได้ + เหตุผล
--    · 3 ค้างเกิน `stale_after_min` ของกฎ (default 240 น.) = จอขึ้นแดง
--
-- ⚠️ apply จริง 02/10 ผ่าน MCP ทีละคำสั่ง (ก้อนใหญ่ timeout) — ผล: ④ backfill ได้ ~120 ใบ (ทั้งกะ ไม่ใช่ 5 ใบที่นับตอนเช้า)
--
-- ย้อนกลับ (revert โค้ดฝั่งเว็บก่อน แล้วรันตามลำดับ):
--   update stock_inflow_rules set mode='auto';          -- ทุกกฎกลับเป็นรับอัตโนมัติ
--   ⚠️ ใบที่ค้าง pending ในคิวจะไม่ถูกโพสต์เอง — ต้องรับ/ยกเลิกให้หมดก่อน drop
--   แล้วรัน create or replace fn_post_confirmed_output ฉบับ 20260825_partial_output_and_explode_dedup.sql
--   drop function stock_receipt_confirm(uuid, numeric, text, text, uuid); drop table stock_receipts;
--   alter table stock_inflow_rules drop column mode, drop column stale_after_min;

-- ① กฎ: โหมด + เกณฑ์ค้าง ─────────────────────────────────────────────────────
alter table public.stock_inflow_rules
  add column if not exists mode text not null default 'auto',
  add column if not exists stale_after_min integer not null default 240;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stock_inflow_rules_mode_chk') then
    alter table public.stock_inflow_rules add constraint stock_inflow_rules_mode_chk check (mode in ('auto', 'confirm'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_inflow_rules_stale_chk') then
    alter table public.stock_inflow_rules add constraint stock_inflow_rules_stale_chk check (stale_after_min > 0);
  end if;
end $$;
comment on column public.stock_inflow_rules.mode is
  'auto = ปิดใบผลิตแล้วเข้าสต็อกทันที · confirm = เข้าคิว stock_receipts รอคนนับแล้วกดรับ (is_active=false = ไม่เข้าเลย)';
comment on column public.stock_inflow_rules.stale_after_min is
  'ใบรอรับเข้าที่ค้างนานกว่านี้ (นาที) จอขึ้นสีแดง';

-- ② คิวรอรับเข้า ─────────────────────────────────────────────────────────────
create table if not exists public.stock_receipts (
  id              uuid primary key default gen_random_uuid(),
  -- ⚠️ ไม่ผูก FK ไป prod_orders โดยตั้งใจ — สร้าง FK ต้องล็อก prod_orders (ตารางร้อนที่สุดของ DR)
  --    apply จริง 02/10 ค้าง timeout ทุกครั้งที่มี FK · ใบในคิวถูกสร้างโดย trigger ของ prod_orders เท่านั้นอยู่แล้ว
  prod_order_id   uuid not null,
  prod_no         text,
  mat_no          text not null,
  part_name       text,
  qty_expected    numeric not null check (qty_expected > 0),
  dest_line_name  text not null,
  source_line     text,
  ref_session_id  uuid,
  work_date       date not null,
  partial_reason  text,                       -- null = ปิดใบปกติ · มีค่า = ยอดบางส่วนจากใบที่ยกเลิก/ยกยอด
  status          text not null default 'pending',
  qty_received    numeric,
  diff_reason     text,
  received_by     text,
  received_by_uid uuid,
  received_at     timestamptz,
  stock_txn_id    uuid,
  cancel_reason   text,
  cancelled_by    text,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  updated_by_uid  uuid,
  constraint stock_receipts_status_chk check (status in ('pending', 'received', 'cancelled')),
  constraint stock_receipts_qty_chk check (qty_received is null or qty_received >= 0),
  -- รับแล้วต้องมียอดที่นับได้ · ยอดไม่ตรงต้องมีเหตุผล (กันกดผ่านโดยไม่ได้นับ)
  constraint stock_receipts_received_chk check (status <> 'received' or (qty_received is not null and received_at is not null)),
  constraint stock_receipts_diff_chk check (qty_received is null or qty_received = qty_expected
                                            or coalesce(btrim(diff_reason), '') <> ''),
  constraint stock_receipts_cancel_chk check (status <> 'cancelled' or coalesce(btrim(cancel_reason), '') <> '')
);
comment on table public.stock_receipts is
  'คิวรับเข้าคลังจากการปิดใบผลิต (กฎ stock_inflow_rules.mode=confirm) — สต็อกเข้าตอนคนนับแล้วกดรับเท่านั้น';
-- ใบผลิต 1 ใบ มีใบรอรับที่ "ยังมีผล" ได้ใบเดียว (ยกเลิกแล้วออกใบใหม่ได้ เช่นถอยใบแล้วปิดใหม่)
create unique index if not exists stock_receipts_one_live_per_order
  on public.stock_receipts (prod_order_id) where status <> 'cancelled';
create index if not exists stock_receipts_status_dest_idx on public.stock_receipts (status, dest_line_name, created_at);

alter table public.stock_receipts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stock_receipts' and policyname='stock_receipts_all') then
    create policy stock_receipts_all on public.stock_receipts for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;
drop trigger if exists trg_stock_receipts_updated on public.stock_receipts;
create trigger trg_stock_receipts_updated before update on public.stock_receipts for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_stock_receipts_audit on public.stock_receipts;
create trigger trg_stock_receipts_audit after insert or update or delete on public.stock_receipts for each row execute function public.fn_audit();

-- realtime — จอคิวรอรับเข้าต้องเห็นใบใหม่ทันทีที่ไลน์ปิดใบ (ไม่งั้นพึ่ง poll กันเหนียวอย่างเดียว)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stock_receipts') then
    alter publication supabase_realtime add table public.stock_receipts;
  end if;
end $$;

-- ③ trigger ปิดใบผลิต: กฎ confirm = เข้าคิว แทนการโพสต์สต็อก ─────────────────────
create or replace function public.fn_post_confirmed_output()
returns trigger language plpgsql as $function$
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

  -- กันซ้ำ 2 ทาง: โพสต์อัตโนมัติไปแล้ว · หรือมีใบรอรับ/รับแล้วของใบผลิตนี้อยู่
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

-- ④ กดรับ — ทำในธุรกรรมเดียว (ล็อกใบ → ลงสต็อก → ปิดใบ) ห้ามแยก 2 คำสั่งจาก client
--    (กฎเหล็ก DB ข้อ 6: claim ก่อนเขียน ledger แล้ว ledger ล้ม = สถานะค้างโกหก)
create or replace function public.stock_receipt_confirm(
  p_id uuid, p_qty numeric, p_reason text, p_by text, p_by_uid uuid default null)
returns public.stock_receipts language plpgsql as $function$
declare
  r public.stock_receipts;
  v_txn uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into r from public.stock_receipts where id = p_id for update;
  if not found then raise exception 'ไม่พบใบรอรับเข้า'; end if;
  if r.status <> 'pending' then
    raise exception 'ใบนี้ถูก % ไปแล้ว — รีเฟรชจอ', case r.status when 'received' then 'รับเข้า' else 'ยกเลิก' end;
  end if;
  if p_qty is null or p_qty < 0 then raise exception 'จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป'; end if;
  if p_qty <> r.qty_expected and v_reason is null then
    raise exception 'ยอดที่นับได้ (%) ไม่ตรงกับใบ (%) — ต้องใส่เหตุผล', p_qty, r.qty_expected;
  end if;
  if coalesce(btrim(p_by), '') = '' then raise exception 'ไม่รู้ว่าใครเป็นคนรับ'; end if;

  if p_qty > 0 then
    insert into public.line_stock_transactions
      (line_name, mat_no, part_name, qty, type, ref_session_id, ref_order_id, work_date, note, created_by, created_by_uid)
    values
      (r.dest_line_name, r.mat_no, r.part_name, p_qty, 'issue', r.ref_session_id, r.prod_order_id, r.work_date,
       'รับเข้า (นับแล้ว): ปิดออเดอร์ '||coalesce(r.prod_no, '')||' จากไลน์ '||coalesce(r.source_line, '-')
         ||case when p_qty <> r.qty_expected
                then ' · นับได้ '||p_qty||' จากใบ '||r.qty_expected||' — '||v_reason else '' end,
       p_by, p_by_uid)
    returning id into v_txn;
  end if;

  update public.stock_receipts
     set status = 'received', qty_received = p_qty, diff_reason = v_reason,
         received_by = p_by, received_by_uid = p_by_uid, received_at = now(),
         stock_txn_id = v_txn, updated_by_name = p_by, updated_by_uid = p_by_uid
   where id = p_id
  returning * into r;
  return r;
end; $function$;
grant execute on function public.stock_receipt_confirm(uuid, numeric, text, text, uuid) to anon, authenticated;

-- ⑤ ตั้งกฎ 2 ตัวที่ถูกปิดเมื่อเช้า ให้เป็น "ต้องยืนยันรับ" ตามที่ user ตั้งใจ ─────────────────
update public.stock_inflow_rules
   set mode = 'confirm', is_active = true, updated_at = now(), updated_by_name = 'migration 20261002 (คำสั่ง user)'
 where match_type = 'prefix' and match_value in ('1', '2');

-- ⑥ ใบที่ปิดไปตั้งแต่กฎถูกปิด (02/10 11:48 น.) แล้วของไม่เข้าคลัง → เข้าคิวรอรับ (ไม่โพสต์ให้เอง)
insert into public.stock_receipts
  (prod_order_id, prod_no, mat_no, part_name, qty_expected, dest_line_name, source_line, ref_session_id, work_date)
select o.id, o.prod_no, o.mat_no, coalesce(p.name, o.part_name), coalesce(o.qty_ok, o.qty),
       ru.dest_line_name, s.line_name, o.session_id, coalesce(s.work_date, work_date_bangkok())
  from public.prod_orders o
  join public.production_sessions s on s.id = o.session_id
  left join lateral (select name, coalesce(is_operation, false) is_op from public.dr_products
                      where mat_no = o.mat_no limit 1) p on true
  join lateral (select dest_line_name from public.stock_inflow_rules
                 where is_active and ((match_type = 'mat' and match_value = o.mat_no)
                    or (match_type = 'prefix' and left(o.mat_no, length(match_value)) = match_value))
                 order by case when match_type = 'mat' then 0 else 1 end, length(match_value) desc
                 limit 1) ru on true
 where o.status = 'confirmed'
   and o.confirmed_at >= '2026-10-02 04:48:37+00'
   and coalesce(o.qty_ok, o.qty) > 0
   and not coalesce(p.is_op, false)
   and not exists (select 1 from public.line_stock_transactions t
                    where t.ref_order_id = o.id and t.type = 'issue' and t.created_by = 'auto')
   and not exists (select 1 from public.stock_receipts x
                    where x.prod_order_id = o.id and x.status in ('pending', 'received'));

notify pgrst, 'reload schema';

-- ── ตรวจหลังรัน (DR) ──
-- select match_value, dest_line_name, is_active, mode, stale_after_min from stock_inflow_rules;  -- 2 แถว confirm/active
-- select status, dest_line_name, count(*), sum(qty_expected) from stock_receipts group by 1,2;     -- ใบที่ตกหล่นเข้าคิวแล้ว
