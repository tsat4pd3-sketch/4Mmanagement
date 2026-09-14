-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ทะเบียนลูกค้า (customers master) — 2026-09-08 · คำสั่ง user "ลุยเลย" หลัง single-source audit 2026-09-07
--
-- ที่มา: ชื่อลูกค้าเป็น text ใน dr_products.customer และถูกพิมพ์เองซ้ำ ≥10 ฟอร์ม (Product Master · QA part/claim ·
-- PE doc set · NPI project/template · MO · Kanban Std · ship_to_plants) ขณะที่ forecast/shipping/claims จัดกลุ่มด้วย
-- สตริงนี้ → "FORD"/"Ford"/"FORD MOTOR" แตกเป็นคนละลูกค้า · เดิม <CustomerSelect> derive รายชื่อจาก distinct dr_products
-- ตอนนี้ตารางนี้เป็นเจ้าของรายชื่อ (โค้ดอ่านผ่าน src/utils/useCustomers.js — fallback derive เดิมเมื่อตารางว่าง)
--
-- โมเดล: **คอลัมน์ customer ของตารางอื่นยังเก็บ "name" (text) เหมือนเดิม — ไม่ migrate ไม่ผูก FK**
--   code    = คีย์ normalize (upper · ยุบช่องว่าง) ใช้เทียบ/dedupe เท่านั้น
--   name    = สะกดหลักที่แสดงและบันทึกลงคอลัมน์ customer
--   aliases = สะกดอื่นที่เคยเจอ → picker แม็ปเข้า name หลักให้ (ค่าเก่าในฐานยังอ่านออก)
-- seed = ทุกค่าที่มีอยู่จริงตอนนี้ (รวมค่าที่ดูไม่ใช่ลูกค้า เช่น "ASSY LWRBAR" — ให้คนดูแลปิดใช้/รวมเอง ไม่ล้างเงียบ)

create table if not exists public.customers (
  code            text primary key,
  name            text not null,
  aliases         text[] not null default '{}',
  note            text,
  sort_order      integer not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
comment on table public.customers is
  'ทะเบียนลูกค้า — เจ้าของรายชื่อที่ทุกฟอร์มเลือก · คอลัมน์ customer ของตารางอื่นเก็บ name (text) เหมือนเดิม · code = คีย์ normalize';

alter table public.customers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customers' and policyname='customers_all') then
    create policy customers_all on public.customers for all using (true) with check (true); -- DR convention: anon-open (supabaseDR ไม่ authenticate)
  end if;
end $$;

drop trigger if exists trg_customers_updated on public.customers;
create trigger trg_customers_updated before update on public.customers for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_customers_audit on public.customers;
create trigger trg_customers_audit after insert or update or delete on public.customers for each row execute function public.fn_audit();

-- ═══ seed จากค่าที่มีอยู่จริง (รันซ้ำได้ — on conflict do nothing ไม่ทับที่คนแก้แล้ว) ═══
with src as (
  select customer as raw, count(*) as n from public.dr_products where customer is not null and btrim(customer) <> '' group by 1
  union all
  select customer_name, 0 from public.ship_to_plants where customer_name is not null and btrim(customer_name) <> ''
), norm as (
  select upper(regexp_replace(btrim(raw), '\s+', ' ', 'g')) as code, btrim(raw) as name, n from src
), pick as (
  select code, (array_agg(name order by n desc, name))[1] as name, sum(n) as n,
         array_remove(array_agg(distinct name), (array_agg(name order by n desc, name))[1]) as aliases
  from norm group by code
)
insert into public.customers (code, name, aliases, sort_order)
select code, name, coalesce(aliases, '{}'), 100 - least(n, 90)::int from pick
on conflict (code) do nothing;
