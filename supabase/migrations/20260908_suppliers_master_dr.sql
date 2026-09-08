-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ทะเบียนผู้ขาย/ผู้รับจ้าง (suppliers master) — 2026-09-08 · คำสั่ง user "ลุยเลย" หลัง single-source audit 2026-09-07
--
-- ที่มา: ชื่อ supplier ถูกพิมพ์เองใน parts_master.supplier · container_types.supplier · part_routings.vendor_name ·
-- mtn_spare_parts.supplier · npi_tooling_plans.maker_name (Main) — สะกดคนละแบบ (Maccall/MACALL) รวมยอดซื้อ/lead time ไม่ได้
-- โมเดล: **คอลัมน์ปลายทางยังเก็บ name (text) เหมือนเดิม ไม่ migrate ไม่ผูก FK** · code = คีย์ normalize
-- kind: material (เหล็ก/วัตถุดิบ) · parts (ชิ้นส่วน/อะไหล่) · tooling (แม่พิมพ์/จิ๊ก) · service (จ้างนอก) ·
--       internal (ผลิตเองในเครือ เช่น TSAT4-600T ที่ parts_master ใช้บอก "แหล่งที่มา") · other
-- ⚠️ NPI supplier portal (เฟส 4 — login ภายนอก) ต้องอยู่ Main + auth · ตารางนี้เป็นทะเบียนชื่อฝั่งโรงงานเท่านั้น
--    ถึงตอนนั้นให้ portal อ้าง code นี้ ไม่ต้องย้ายตาราง

create table if not exists public.suppliers (
  code            text primary key,
  name            text not null,
  kind            text not null default 'other' check (kind in ('material','parts','tooling','service','internal','other')),
  contact         text,
  phone           text,
  email           text,
  lead_time_days  integer,
  note            text,
  sort_order      integer not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
comment on table public.suppliers is
  'ทะเบียนผู้ขาย/ผู้รับจ้าง/แหล่งที่มา — คอลัมน์ supplier/vendor_name/maker_name ของตารางอื่นเก็บ name (text) เหมือนเดิม';

alter table public.suppliers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='suppliers' and policyname='suppliers_all') then
    create policy suppliers_all on public.suppliers for all using (true) with check (true); -- DR convention: anon-open
  end if;
end $$;

drop trigger if exists trg_suppliers_updated on public.suppliers;
create trigger trg_suppliers_updated before update on public.suppliers for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_suppliers_audit on public.suppliers;
create trigger trg_suppliers_audit after insert or update or delete on public.suppliers for each row execute function public.fn_audit();

-- ═══ seed จากค่าที่มีอยู่จริง 4 ตาราง (kind เดาจากแหล่ง — คนดูแลแก้ทีหลังได้) ═══
with src as (
  select supplier as raw, case when upper(supplier) like 'TSA%' then 'internal' else 'material' end as kind, count(*) as n
    from public.parts_master where supplier is not null and btrim(supplier) <> '' group by 1, 2
  union all
  select supplier, 'parts', count(*) from public.mtn_spare_parts where supplier is not null and btrim(supplier) <> '' group by 1
  union all
  select supplier, 'other', count(*) from public.container_types where supplier is not null and btrim(supplier) <> '' group by 1
  union all
  select vendor_name, 'service', count(*) from public.part_routings where vendor_name is not null and btrim(vendor_name) <> '' group by 1
), norm as (
  select upper(regexp_replace(btrim(raw), '\s+', ' ', 'g')) as code, btrim(raw) as name, kind, n from src
), pick as (
  select code, (array_agg(name order by n desc, name))[1] as name, (array_agg(kind order by n desc, name))[1] as kind, sum(n) as n
  from norm group by code
)
insert into public.suppliers (code, name, kind, sort_order)
select code, name, kind, 100 - least(n, 90)::int from pick
on conflict (code) do nothing;
