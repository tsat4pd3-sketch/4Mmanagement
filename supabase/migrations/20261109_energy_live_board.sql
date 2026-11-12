-- ⚡ บอร์ดค่าไฟสด (หน้า /energy แท็บ "ค่าไฟสด") — รับค่าจาก Node-RED ทุก 1 นาที
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-09 · คำสั่ง user "จัดเต็ม"
--
-- ที่มา: Die Shop มี Node-RED อ่านค่าไฟจาก PLC FX5U (server ในโรงงาน 10.0.119.21)
--   ⇒ Node-RED POST เข้า edge function `ingest-energy` เอง (คลาวด์เข้าไปดึง IP ในโรงงานไม่ได้)
--   แบบเต็ม: docs/ENERGY_MONITORING_DESIGN.md §15
--
-- additive ล้วน (เพิ่ม 4 อย่าง + ขยาย check ของ field) · ของเดิมทำงานเหมือนเดิมทุกอย่าง

-- ── (1) รับค่าแรงดัน V + กระแส A ด้วย ──────────────────────────────────────
alter table public.energy_meter_topics drop constraint if exists energy_meter_topics_field_check;
alter table public.energy_meter_topics add constraint energy_meter_topics_field_check
  check (field in ('kw','kwh_total','kvar','pf','v','a'));

-- ── (2) ทะเบียนมิเตอร์บนบอร์ดสด — ตู้ไหน · ลิมิต · สเกลเกจ ───────────────────
-- ⚠️ แยกจาก energy_points โดยตั้งใจ — energy_points คือจุดกรอกรายเดือน/ผังโรงงาน
--    ใส่ DB-ROBOT ฯลฯ ลงไปที่นั่น = โผล่เป็น "จุดที่ยังไม่ได้ตีกรอบบนผัง" ทั้งที่ไม่ได้ตั้งใจ
create table if not exists public.energy_live_meters (
  scope_kind   text not null default 'zone' check (scope_kind in ('line','zone')),
  scope_name   text not null,                 -- ต้องตรงกับ energy_meter_topics.scope_name
  panel        text not null,                 -- ตู้ที่จ่ายไฟ เช่น 'MDB-03' (ยอดตู้ = ผลรวมเครื่องลูก)
  subtitle     text,                          -- 'K1 · Robot Line'
  limit_kw     numeric,                       -- เกิน = แจ้งเตือน · null = ไม่ตัดสิน
  limit_a      numeric,
  gauge_max_kw numeric,                       -- สเกลเกจ · null = ใช้ลิมิต×1.5
  sort_order   int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (scope_kind, scope_name)
);

-- ── (3) ประวัติรายนาที (กราฟเส้นบนการ์ด) — 1 แถวต่อเครื่องต่อนาที ────────────
-- ⚠️ เก็บแบบ "แถวกว้าง" (kw/kwh/v/a ในแถวเดียว) = 3 เครื่อง × 1,440 แถว/วัน
--    edge function ลบแถวเก่ากว่า 7 วันเองทุกรอบ ⇒ ตารางค้างที่ ~30,000 แถว
--    ยอดระยะยาวอยู่ที่ energy_daily (ข้อ 4) ไม่ต้องพึ่งตารางนี้
create table if not exists public.energy_readings (
  scope_kind  text not null,
  scope_name  text not null,
  bucket_at   timestamptz not null,           -- ปัดลงเป็นต้นนาที
  kw          numeric,
  kwh_total   numeric,                        -- เลขสะสมหน้ามิเตอร์
  v           numeric,
  a           numeric,
  received_at timestamptz not null default now(),
  primary key (scope_kind, scope_name, bucket_at)
);
create index if not exists energy_readings_bucket_idx on public.energy_readings (bucket_at);

-- ── (4) สรุปรายวัน (ใช้ไฟวันนี้ / เดือนนี้ / peak) — โตวันละ 1 แถวต่อเครื่อง ───
-- "วัน" = วันตามปฏิทินไทย ตัด 00:00 (ตรงกับหน้า Node-RED เดิม "นับตั้งแต่ 00:00 น.")
create table if not exists public.energy_daily (
  scope_kind     text not null,
  scope_name     text not null,
  day            date not null,
  kwh            numeric not null default 0,  -- ผลรวม "ผลต่างที่เป็นบวก" ของเลขสะสม
  peak_kw        numeric,
  peak_at        timestamptz,
  last_kwh_total numeric,
  samples        int not null default 0,
  resets         int not null default 0,      -- เลขมิเตอร์ถอยหลัง (reset/เปลี่ยนมิเตอร์) กี่ครั้ง
  updated_at     timestamptz not null default now(),
  primary key (scope_kind, scope_name, day)
);

-- ── trigger: แถวรายนาทีใหม่ → บวกเข้ายอดรายวัน ─────────────────────────────
-- 🔴 kWh ของวัน = Σ (ค่านี้ − ค่าก่อนหน้า) เฉพาะที่ ≥ 0
--    เลขถอยหลัง (มิเตอร์ reset/เปลี่ยนตัว) = ไม่บวก + นับ resets ไว้ให้จอบอก **ห้ามบันทึกเป็นค่าติดลบ**
-- ⚠️ ทำงานเฉพาะ INSERT — edge function ส่งแบบ "ซ้ำ = ข้าม" (ignoreDuplicates)
--    ⇒ Node-RED ยิงซ้ำนาทีเดิม ยอดไม่ถูกบวก 2 รอบ
-- ⚠️ ข้อจำกัดที่รู้: ส่งย้อนหลัง (นาทีที่เก่ากว่าแถวล่าสุด) จะนับผลต่างซ้ำ — Node-RED ส่งค่าสดเท่านั้น
--    · Node-RED หยุดข้ามเที่ยงคืน ผลต่างทั้งก้อนตกวันที่กลับมาส่ง (ไม่รู้ว่าใช้ไปวันไหน)
create or replace function public.fn_energy_readings_daily()
returns trigger language plpgsql as $$
declare
  prev   numeric;
  d      date := (new.bucket_at at time zone 'Asia/Bangkok')::date;
  delta  numeric := 0;
  reset  int := 0;
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
    (new.scope_kind, new.scope_name, d, delta, new.kw,
     case when new.kw is not null then new.bucket_at end, new.kwh_total, 1, reset, now())
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
end $$;

drop trigger if exists trg_energy_readings_daily on public.energy_readings;
create trigger trg_energy_readings_daily after insert on public.energy_readings
  for each row execute function public.fn_energy_readings_daily();

-- ── RLS: จออ่านได้ (anon — ฝั่ง DR ไม่มี JWT) · เขียนผ่าน edge function (service_role) เท่านั้น ──
alter table public.energy_live_meters enable row level security;
alter table public.energy_readings    enable row level security;
alter table public.energy_daily       enable row level security;
drop policy if exists energy_live_meters_read on public.energy_live_meters;
create policy energy_live_meters_read on public.energy_live_meters for select to anon, authenticated using (true);
drop policy if exists energy_readings_read on public.energy_readings;
create policy energy_readings_read on public.energy_readings for select to anon, authenticated using (true);
drop policy if exists energy_daily_read on public.energy_daily;
create policy energy_daily_read on public.energy_daily for select to anon, authenticated using (true);
grant select on public.energy_live_meters, public.energy_readings, public.energy_daily to anon, authenticated;

drop trigger if exists trg_energy_live_meters_updated on public.energy_live_meters;
create trigger trg_energy_live_meters_updated before update on public.energy_live_meters
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_energy_live_meters_audit on public.energy_live_meters;
create trigger trg_energy_live_meters_audit after insert or update or delete on public.energy_live_meters
  for each row execute function public.fn_audit();

-- ── seed: 3 ตู้ย่อยใต้ MDB-03 (ลิมิต/สเกลตามหน้า Node-RED เดิมของ Die Shop) ──
--    ตู้จ่ายไฟให้อะไร (user 09/11): ROBOT = robot ไลน์ HDF1-2 · CNC = Bending 4 เครื่อง ไลน์ HDF1-2 ·
--    LASER = LASER-345 + LASER-789 (ทั้งหมดอยู่ใต้ HYDROFORM · PD3) — subtitle แก้ใน DB แล้ว 09/11
insert into public.energy_live_meters (scope_kind, scope_name, panel, subtitle, limit_kw, limit_a, gauge_max_kw, sort_order) values
  ('zone', 'DB-ROBOT', 'MDB-03', 'K1 · Robot ไลน์ HDF1-2',            55, 125,  90, 1),
  ('zone', 'DB-CNC',   'MDB-03', 'K2 · Bending 4 เครื่อง ไลน์ HDF1-2', 20,  40,  60, 2),
  ('zone', 'DB-LASER', 'MDB-03', 'K3 · LASER-345 + LASER-789',        123, 260, 220, 3)
on conflict (scope_kind, scope_name) do nothing;

-- topic = ชื่อที่ Node-RED ต้องส่งมา "ตรงตัวอักษร" · แก้/เพิ่มได้ที่ /energy แท็บ มิเตอร์ / MQTT
insert into public.energy_meter_topics (topic, field, scope_kind, scope_name, note)
select 'dieshop/' || m || '/' || f, f, 'zone', m, 'Node-RED Die Shop (MDB-03)'
  from unnest(array['DB-ROBOT','DB-CNC','DB-LASER']) m, unnest(array['kw','kwh_total','v','a']) f
on conflict (topic, field) do nothing;

comment on table public.energy_live_meters is 'ทะเบียนมิเตอร์บนบอร์ดค่าไฟสด (/energy แท็บ ค่าไฟสด) · ตู้/ลิมิต/สเกลเกจ';
comment on table public.energy_readings is 'ค่ามิเตอร์รายนาที (กราฟเส้น) · edge ingest-energy ลบแถวเก่ากว่า 7 วันเอง';
comment on table public.energy_daily is 'ยอดรายวันจาก trigger ของ energy_readings · kWh = Σ ผลต่างบวกของเลขสะสม (ไม่นับเลขถอยหลัง)';

-- Rollback (ลบ edge function เวอร์ชันใหม่/ย้อนเวอร์ชันก่อน แล้วค่อยรัน):
--   drop table public.energy_daily; drop table public.energy_readings; drop table public.energy_live_meters;
--   drop function public.fn_energy_readings_daily();
--   delete from public.energy_meter_topics where note = 'Node-RED Die Shop (MDB-03)';
--   alter table public.energy_meter_topics drop constraint energy_meter_topics_field_check;
--   alter table public.energy_meter_topics add constraint energy_meter_topics_field_check
--     check (field in ('kw','kwh_total','kvar','pf'));
