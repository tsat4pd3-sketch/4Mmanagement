-- ⚡ Project: DR ("Product DB" · eyhclzkifitbhbljgoav) — 2026-11-25 คำสั่ง user "ทำค่าสูงสุดของเดือนด้วย" (Demand 15 นาที)
-- รายนาที (energy_readings) เก็บแค่ 7 วัน ⇒ เก็บ "พลังงานต่อช่วง 15 นาที ต่อมิเตอร์" ถาวรที่นี่
--   kwh = ผลรวมส่วนต่างเลขมิเตอร์ของนาทีในช่วง (นาที b เป็นของช่วง date_bin(15m, b) — ตรงกับ demandWindows() ฝั่งจอ)
--   covered_min = นาทีที่ส่วนต่างครอบ (ช่วงห่าง ≤ 3 นาทีเท่านั้น · ห่างกว่า/เลขถอยหลัง = ไม่นับ ไม่เดา)
--   ช่วงครบ = covered_min ≥ 15 · kW ของช่วง = kwh ÷ 0.25 ชม. คิดที่ JS (demandKwFromKwh · utils/energy.js)
-- เติมโดย trigger แยกตัวใหม่ (ไม่แตะ fn_energy_readings_daily) · AFTER INSERT ⇒ แถวซ้ำที่ ingest ข้าม (ignoreDuplicates) ไม่บวกซ้ำ
-- ย้อน: drop trigger trg_energy_readings_demand on public.energy_readings;
--       drop function public.fn_energy_readings_demand(); drop function public.fn_energy_demand_month(text[], timestamptz, timestamptz);
--       drop table public.energy_demand_15m;
create table if not exists public.energy_demand_15m (
  scope_kind   text not null default 'zone',
  scope_name   text not null,
  window_start timestamptz not null,
  kwh          numeric not null default 0,
  covered_min  int not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (scope_kind, scope_name, window_start)
);
alter table public.energy_demand_15m enable row level security;
drop policy if exists energy_demand_15m_read on public.energy_demand_15m;
create policy energy_demand_15m_read on public.energy_demand_15m for select to anon, authenticated using (true);
grant select on public.energy_demand_15m to anon, authenticated;

create or replace function public.fn_energy_readings_demand()
 returns trigger language plpgsql as $function$
declare
  pk numeric; pt timestamptz; gap numeric;
begin
  if new.kwh_total is null then return new; end if;
  select r.kwh_total, r.bucket_at into pk, pt
    from public.energy_readings r
   where r.scope_kind = new.scope_kind and r.scope_name = new.scope_name
     and r.bucket_at < new.bucket_at and r.kwh_total is not null
   order by r.bucket_at desc limit 1;
  if pk is null then return new; end if;
  gap := extract(epoch from new.bucket_at - pt) / 60;
  if gap > 3 or new.kwh_total < pk then return new; end if;     -- ขาดช่วง/มิเตอร์รีเซ็ต = ไม่นับ (ช่วงนั้นจะไม่ครบ)
  insert into public.energy_demand_15m as e (scope_kind, scope_name, window_start, kwh, covered_min, updated_at)
  values (new.scope_kind, new.scope_name, date_bin('15 minutes', new.bucket_at, '2000-01-01'::timestamptz),
          new.kwh_total - pk, round(gap)::int, now())
  on conflict (scope_kind, scope_name, window_start) do update set
    kwh = e.kwh + excluded.kwh, covered_min = e.covered_min + excluded.covered_min, updated_at = now();
  return new;
end $function$;

drop trigger if exists trg_energy_readings_demand on public.energy_readings;
create trigger trg_energy_readings_demand after insert on public.energy_readings
  for each row execute function public.fn_energy_readings_demand();

-- เติมย้อนหลังจากรายนาทีที่ยังมี (≤ 7 วัน) — กติกาเดียวกับ trigger
insert into public.energy_demand_15m (scope_kind, scope_name, window_start, kwh, covered_min)
select scope_kind, scope_name, date_bin('15 minutes', bucket_at, '2000-01-01'::timestamptz),
       sum(kwh_total - pk), sum(round(extract(epoch from bucket_at - pt) / 60))::int
from (
  select scope_kind, scope_name, bucket_at, kwh_total,
         lag(kwh_total) over w as pk, lag(bucket_at) over w as pt
  from public.energy_readings where kwh_total is not null
  window w as (partition by scope_kind, scope_name order by bucket_at)
) d
where pk is not null and bucket_at - pt <= interval '3 minutes' and kwh_total >= pk
group by 1, 2, 3
on conflict (scope_kind, scope_name, window_start) do nothing;

/* ช่วงที่สูงสุดของเดือน (ตู้ = มิเตอร์ชั้นบนสุดหลายตัว) — คืน "ผลรวม kWh" ไม่คิด kW (สูตรอยู่ JS)
   นับเฉพาะช่วงที่ทุกมิเตอร์ครบ 15 นาที · first_window/windows_n = ข้อมูลเริ่มเมื่อไร มีกี่ช่วงครบ (จอต้องบอก) */
create or replace function public.fn_energy_demand_month(p_names text[], p_from timestamptz, p_to timestamptz)
 returns table (window_start timestamptz, kwh numeric, first_window timestamptz, windows_n int)
 language sql stable as $$
  with w as (
    select d.window_start, sum(d.kwh) as kwh
      from public.energy_demand_15m d
     where d.scope_kind = 'zone' and d.scope_name = any(p_names)
       and d.window_start >= p_from and d.window_start < p_to and d.covered_min >= 15
     group by d.window_start
    having count(*) = cardinality(p_names)
  )
  select (select w2.window_start from w w2 order by w2.kwh desc, w2.window_start limit 1),
         (select max(w3.kwh) from w w3),
         (select min(w4.window_start) from w w4),
         (select count(*)::int from w w5);
$$;
grant execute on function public.fn_energy_demand_month(text[], timestamptz, timestamptz) to anon, authenticated;
