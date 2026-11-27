-- ⚡ Project: DR ("Product DB" · eyhclzkifitbhbljgoav) — 2026-11-23 คำสั่ง user "ล่าสุด + เก็บค่าสูงสุดแยก"
-- บอร์ดโชว์ค่า "ล่าสุด" (ตรงจอ Node-RED) · ค่าสูงสุดของนาที (โหลดกระชาก) เก็บแยกใน kw_max / a_max
-- peak รายวัน = coalesce(kw_max, kw) ⇒ ต้นทางที่ไม่ส่ง max = พฤติกรรมเดิมเป๊ะ
-- ย้อน: create or replace ฟังก์ชันเดิม (ใช้ new.kw) แล้ว alter table ... drop column kw_max, drop column a_max
alter table public.energy_readings
  add column if not exists kw_max numeric,
  add column if not exists a_max numeric;

create or replace function public.fn_energy_readings_daily()
 returns trigger language plpgsql as $function$
declare
  prev   numeric;
  d      date := (new.bucket_at at time zone 'Asia/Bangkok')::date;
  delta  numeric := 0;
  reset  int := 0;
  pk     numeric := coalesce(new.kw_max, new.kw);
begin
  if new.kwh_total is not null then
    select r.kwh_total into prev
      from public.energy_readings r
     where r.scope_kind = new.scope_kind and r.scope_name = new.scope_name
       and r.bucket_at < new.bucket_at and r.kwh_total is not null
     order by r.bucket_at desc limit 1;
    if prev is not null then
      if new.kwh_total >= prev then delta := new.kwh_total - prev; else reset := 1; end if;
    end if;
  end if;

  insert into public.energy_daily as e
    (scope_kind, scope_name, day, kwh, peak_kw, peak_at, last_kwh_total, samples, resets, updated_at)
  values
    (new.scope_kind, new.scope_name, d, delta, pk,
     case when pk is not null then new.bucket_at end, new.kwh_total, 1, reset, now())
  on conflict (scope_kind, scope_name, day) do update set
    kwh            = e.kwh + excluded.kwh,
    peak_at        = case when excluded.peak_kw is not null and excluded.peak_kw > coalesce(e.peak_kw, -1)
                          then excluded.peak_at else e.peak_at end,
    peak_kw        = greatest(e.peak_kw, excluded.peak_kw),
    last_kwh_total = coalesce(excluded.last_kwh_total, e.last_kwh_total),
    samples        = e.samples + 1,
    resets         = e.resets + excluded.resets,
    updated_at     = now();
  return new;
end $function$;
