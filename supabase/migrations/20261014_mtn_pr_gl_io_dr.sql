-- ═══════════════════════════════════════════════════════════════════════════
-- MTN REQUEST 14/10 — IO เครื่องจักร · ลูปใบขอซื้อ (PR) รันเลข · รหัส GL · จ่ายงานหลายช่าง
--                     · เส้นทางงานซ่อม · KPI "MO Closed on target" นับเฉพาะ Breakdown
-- DR project (eyhclzkifitbhbljgoav · ชื่อในจอ Supabase "Product DB")
-- additive ทั้งหมด (คอลัมน์ nullable · ตารางใหม่) ⇒ โค้ดเดิมไม่เห็นอะไรเปลี่ยน ยกเว้น KPI ข้อ 7 (ตั้งใจ)
-- ตาราง DR ตาม convention = anon-open (supabaseDR ไม่เคย authenticate — CLAUDE.md §Supabase Projects)
-- 📄 docs/modules/mtn-work-order.md §💳 PR / GL / IO (2026-10-14)
-- ✅ apply แล้ว 15/10 ผ่าน MCP (แบ่ง 6 ก้อนเพราะทั้งไฟล์ timeout · ผลตรวจ: fns=2 · trg_audit=2 · mo มี closed_all)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) เลข IO ประจำเครื่องจักร — ใบ MO ดึงไปเติมช่อง I/O ให้เอง (แก้ทับในใบได้)
alter table public.machines add column if not exists io_no text;
comment on column public.machines.io_no is
  'เลข I/O (Internal Order) ของเครื่อง — ใบ MO เติมช่อง io_no ให้อัตโนมัติตอนเลือกเครื่อง (2026-10-14)';

-- 2) ใบ MO: จ่ายงานหลายช่าง + เส้นทางงานซ่อม
alter table public.mtn_orders add column if not exists assigned_techs text[];
comment on column public.mtn_orders.assigned_techs is
  'ช่างที่ได้รับมอบหมาย (หลายคน) — assigned_to ยังเก็บชื่อต่อกันด้วย ", " ให้ผู้อ่านเดิม (ใบพิมพ์/edge/Excel) · ตัวตัดสิน = src/utils/mtnAssign.js';
alter table public.mtn_orders add column if not exists repair_path text;
comment on column public.mtn_orders.repair_path is
  'เส้นทางงานซ่อม: inhouse = ซ่อมเองไม่ต้องซื้อ · inhouse_pr = ซ่อมเองแต่ต้องเปิด PR สั่งอะไหล่ · outsource = ซ่อมไม่ได้ ส่งภายนอก (+PR) · null = ยังไม่ระบุ (ใบเก่า)';

-- 3) ทะเบียนรหัส GL — data-driven (หมวด = งานบริการ / อะไหล่โรงงาน / …) รอไฟล์จาก user มาเติม
create table if not exists public.mtn_gl_codes (
  id              uuid primary key default gen_random_uuid(),
  category        text not null,               -- service | spare_part | อื่นๆ (ข้อความอิสระ)
  gl_code         text not null,
  name            text,
  note            text,
  is_default      boolean not null default false,  -- รหัสตั้งต้นของหมวด (PR ใหม่เติมให้)
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  updated_at      timestamptz default now(),
  updated_by_name text,
  updated_by_uid  uuid
);
create unique index if not exists uq_mtn_gl_codes_code on public.mtn_gl_codes (gl_code);
alter table public.mtn_gl_codes enable row level security;
do $$ begin
  create policy mtn_gl_codes_all on public.mtn_gl_codes for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
grant all on public.mtn_gl_codes to anon, authenticated;

-- 4) ใบขอซื้อ (PR) ของงานช่าง — 1 MO มีได้หลาย PR · PR จากอะไหล่ต่ำกว่า min ไม่ผูก MO
create table if not exists public.mtn_purchase_requests (
  id               uuid primary key default gen_random_uuid(),
  pr_no            text,                       -- ระบบรันให้ (RPC mtn_assign_pr_no) · แก้เป็นเลขทางการได้
  source           text not null default 'mo', -- mo | spare_min | manual
  order_id         uuid references public.mtn_orders(id) on delete set null,
  part_id          uuid references public.mtn_spare_parts(id) on delete set null,
  item_name        text not null,
  qty              numeric not null check (qty > 0),
  unit             text,
  unit_price       numeric,
  amount           numeric,
  gl_category      text,
  gl_code          text,
  supplier         text,
  team             text,                       -- mtn_teams.key
  section          text,
  status           text not null default 'requested'
                   check (status in ('requested','ordered','received','cancelled')),
  note             text,
  requested_at     timestamptz not null default now(),
  requested_by     text,
  requested_by_uid uuid,
  ordered_at       timestamptz,
  ordered_by       text,
  po_no            text,
  received_at      timestamptz,
  received_by      text,
  received_qty     numeric,
  cancelled_at     timestamptz,
  cancelled_by     text,
  cancel_reason    text,
  updated_at       timestamptz default now()
);
create unique index if not exists uq_mtn_pr_no on public.mtn_purchase_requests (pr_no) where pr_no is not null;
create index if not exists idx_mtn_pr_order on public.mtn_purchase_requests (order_id);
create index if not exists idx_mtn_pr_part_open on public.mtn_purchase_requests (part_id) where status in ('requested','ordered');
alter table public.mtn_purchase_requests enable row level security;
-- ยกเลิก = status 'cancelled' + เหตุผล · ไม่เปิด DELETE (ห้ามลบประวัติการขอซื้อ)
do $$ begin
  create policy mtn_pr_select on public.mtn_purchase_requests for select to anon, authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mtn_pr_insert on public.mtn_purchase_requests for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy mtn_pr_update on public.mtn_purchase_requests for update to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
grant select, insert, update on public.mtn_purchase_requests to anon, authenticated;

-- audit (ใครแก้อะไรเมื่อไหร่) — pattern เดียวกับตาราง DR อื่น
do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    execute 'drop trigger if exists trg_audit on public.mtn_purchase_requests';
    execute 'create trigger trg_audit after insert or update or delete on public.mtn_purchase_requests for each row execute function fn_audit()';
    execute 'drop trigger if exists trg_audit on public.mtn_gl_codes';
    execute 'create trigger trg_audit after insert or update or delete on public.mtn_gl_codes for each row execute function fn_audit()';
  end if;
end $$;

-- 5) เลขรัน PR — ตั้งรูปแบบได้ (prefix + รีเซ็ตรายเดือน/ปี/ไม่รีเซ็ต) + ตั้ง "เลขล่าสุด" ต่อจากระบบเดิมได้
create table if not exists public.mtn_pr_seq (
  key        text primary key default 'PR',
  prefix     text not null default 'PR',
  reset      text not null default 'month' check (reset in ('month','year','never')),
  digits     int  not null default 4 check (digits between 3 and 8),
  period     text,                 -- งวดล่าสุดที่นับ (YYMM / YY / '') — เปลี่ยนงวด = เริ่ม 1 ใหม่
  last_no    int  not null default 0,
  updated_at timestamptz default now()
);
alter table public.mtn_pr_seq enable row level security;
do $$ begin
  create policy mtn_pr_seq_all on public.mtn_pr_seq for all to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
grant all on public.mtn_pr_seq to anon, authenticated;
insert into public.mtn_pr_seq (key) values ('PR') on conflict (key) do nothing;

-- ออกเลข PR — idempotent (มีเลขแล้วคืนเลขเดิม) · atomic (ล็อกแถว seq) · รูปแบบ <prefix><งวด>-<รัน>
--   ค่าตั้งต้น: PR2610-0001 (= 11 ตัว พอดีช่อง PR.No. บนฟอร์ม FM-MTN-006)
create or replace function public.mtn_assign_pr_no(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_existing text; s public.mtn_pr_seq%rowtype; v_period text; v_no int; v_txt text;
begin
  select pr_no into v_existing from public.mtn_purchase_requests where id = p_id;
  if not found then raise exception 'ไม่พบใบขอซื้อ'; end if;
  if v_existing is not null and v_existing <> '' then return v_existing; end if;

  select * into s from public.mtn_pr_seq where key = 'PR' for update;
  if not found then
    insert into public.mtn_pr_seq (key) values ('PR') returning * into s;
  end if;
  v_period := case s.reset
    when 'month' then to_char(now() at time zone 'Asia/Bangkok', 'YYMM')
    when 'year'  then to_char(now() at time zone 'Asia/Bangkok', 'YY')
    else '' end;
  v_no := case when coalesce(s.period, '') = v_period then s.last_no + 1 else 1 end;
  -- ⚠️ เปลี่ยน reset ทีหลังแล้วเลขชนของเก่า = วนหาเลขว่างถัดไป (unique index กันซ้ำอยู่แล้ว)
  loop
    v_txt := s.prefix || v_period || case when v_period <> '' then '-' else '' end || lpad(v_no::text, s.digits, '0');
    exit when not exists (select 1 from public.mtn_purchase_requests where pr_no = v_txt);
    v_no := v_no + 1;
  end loop;
  update public.mtn_pr_seq set period = v_period, last_no = v_no, updated_at = now() where key = 'PR';
  update public.mtn_purchase_requests set pr_no = v_txt, updated_at = now() where id = p_id;
  return v_txt;
end $$;
grant execute on function public.mtn_assign_pr_no(uuid) to anon, authenticated;

-- รับของเข้า — CAS 'ordered'/'requested' → 'received' + (ถ้าผูกอะไหล่) รับเข้าสต็อกผ่าน mtn_stock_move
--   ในทรานแซกชันเดียว ⇒ "สถานะรับแล้วแต่สต็อกไม่เข้า" เกิดไม่ได้ (กฎเหล็ก DB ข้อ 6)
create or replace function public.mtn_pr_receive(p_id uuid, p_qty numeric, p_by_name text default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare r public.mtn_purchase_requests%rowtype; v_bal numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนรับต้องมากกว่า 0'; end if;
  select * into r from public.mtn_purchase_requests where id = p_id for update;
  if not found then raise exception 'ไม่พบใบขอซื้อ'; end if;
  if r.status not in ('requested', 'ordered') then
    raise exception 'ใบนี้อยู่สถานะ % — รับเข้าไม่ได้ (อาจมีคนกดรับไปแล้ว)', r.status;
  end if;
  update public.mtn_purchase_requests
     set status = 'received', received_at = now(), received_by = p_by_name, received_qty = p_qty, updated_at = now()
   where id = p_id;
  if r.part_id is not null then
    v_bal := public.mtn_stock_move(r.part_id, 'in', p_qty,
      'รับเข้าจาก PR ' || coalesce(r.pr_no, '(ยังไม่มีเลข)') || coalesce(' · PO ' || r.po_no, ''), p_by_name, r.order_id);
  end if;
  return v_bal;   -- null = ไม่ผูกอะไหล่ในทะเบียน (งานบริการ/ของนอกทะเบียน) ไม่มีสต็อกให้เข้า
end $$;
grant execute on function public.mtn_pr_receive(uuid, numeric, text) to anon, authenticated;

-- 6) KPI "MO Closed on target" — นับเฉพาะใบประเภท Breakdown (prefix BM ใน mtn_repair_types · data-driven)
--    คำสั่ง user 14/10: "ที่ถูกน่าจะต้องนับเฉพาะ MO ที่เป็นประเภท breakdown — ทุกทีมช่างใช้เหมือนกัน"
--    + `closed_all` = ใบที่ซ่อมเสร็จทุกประเภท ให้จอบอกว่า "นับ BM X จากทั้งหมด Y ใบ" (ห้ามตัดเงียบ)
create or replace function public.kpi_mtn_rollup(p_from date, p_to date)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
with bm as (
  select name from mtn_repair_types where upper(coalesce(prefix, '')) = 'BM'
),
mo as (
  select to_char(o.repair_done_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m,
         coalesce(o.mtn_dept, 'unknown') as team,
         count(*) filter (where o.repair_type in (select name from bm)) as closed,
         count(*) filter (where o.repair_type in (select name from bm)
                            and o.target_done_at is not null and o.repair_done_at <= o.target_done_at) as on_target,
         count(*) filter (where o.repair_type in (select name from bm) and o.target_done_at is null) as no_target,
         count(*) as closed_all
  from mtn_orders o
  where o.repair_done_at is not null
    and (o.repair_done_at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and coalesce(o.status, '') <> 'rejected'
  group by 1, 2
),
dtl as (
  select to_char(d.started_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m,
         coalesce(mc.equipment_kind, 'unknown') as kind,
         case when d.duration_min is not null then d.duration_min::numeric
              when d.ended_at is not null then greatest(0, extract(epoch from (d.ended_at - d.started_at)) / 60)
              else null end as mins
  from downtime_logs d
  left join dr_downtime_types t on t.id = d.downtime_type_id
  left join lateral (
    select m2.equipment_kind from machines m2
    where m2.machine_no = d.machine_no
    order by m2.is_active desc nulls last limit 1
  ) mc on true
  where d.started_at is not null
    and (d.started_at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and coalesce(t.category, '') <> 'planned'
    and (d.ended_at is not null or d.duration_min is not null)
),
dt as (
  select m, kind, count(*) as events, sum(mins) as breakdown_min
  from dtl group by 1, 2
),
mach as (
  select coalesce(equipment_kind, 'unknown') as kind, count(*) as n
  from machines where coalesce(is_active, true)
  group by 1
),
mon as (
  select distinct to_char(d.started_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m
  from downtime_logs d
  where d.started_at is not null and (d.started_at at time zone 'Asia/Bangkok')::date between p_from and p_to
)
select jsonb_build_object(
  'mo',       coalesce((select jsonb_agg(to_jsonb(mo) order by m, team) from mo), '[]'::jsonb),
  'dt',       coalesce((select jsonb_agg(to_jsonb(dt) order by m, kind) from dt), '[]'::jsonb),
  'machines', coalesce((select jsonb_agg(to_jsonb(mach) order by kind) from mach), '[]'::jsonb),
  'months',   coalesce((select jsonb_agg(m order by m) from mon), '[]'::jsonb),
  'mo_scope', 'breakdown'
);
$function$;

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════════════════
--   select column_name from information_schema.columns where table_name='machines' and column_name='io_no';           -- 1 แถว
--   select column_name from information_schema.columns where table_name='mtn_orders' and column_name in ('assigned_techs','repair_path'); -- 2
--   select * from mtn_pr_seq;                                                                                         -- PR · month · 0
--   select kpi_mtn_rollup('2026-09-01','2026-09-30')->'mo';                                                            -- มี closed_all
--
-- ═══ ROLLBACK (ย้อนโค้ดก่อน แล้วค่อยรัน) ════════════════════════════════════
--   KPI: รัน pg_get_functiondef ฉบับ 20260924_kpi_mtn_rollup_dr.sql อีกครั้ง (นับทุกประเภท)
--   drop function if exists public.mtn_pr_receive(uuid, numeric, text);
--   drop function if exists public.mtn_assign_pr_no(uuid);
--   drop table if exists public.mtn_purchase_requests; drop table if exists public.mtn_pr_seq; drop table if exists public.mtn_gl_codes;
--   alter table public.mtn_orders drop column if exists assigned_techs, drop column if exists repair_path;
--   alter table public.machines drop column if exists io_no;
