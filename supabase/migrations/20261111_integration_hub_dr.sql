-- 🔌 ศูนย์เชื่อมต่อ Node-RED / เครื่องจักร — ทะเบียนต้นทาง + สถิติการรับรายชั่วโมง
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-11 · คำสั่ง user (ย้ายหน้า MQTT ไปหมวดตั้งค่า ใช้ได้กับทุกข้อมูลจาก Node-RED)
-- 📄 docs/modules/integration-hub.md
--
-- 🔴 ความปลอดภัย (DR = anon-open ตามกฎ supabaseDR):
--   · รหัสลับของต้นทางเก็บเป็น sha256 เท่านั้น (`key_hash`) และ **anon อ่านคอลัมน์นี้ไม่ได้** (grant รายคอลัมน์)
--   · client ไม่มีสิทธิ์ insert/update/delete — เขียนผ่าน edge `integration-admin` (ตรวจ token Main + has_perm)
--     และ edge `ingest-energy` (service role) เท่านั้น ⇒ ถือ anon key อย่างเดียวสร้างต้นทางปลอม/ยิงข้อมูลปลอมไม่ได้
--   · ต้นทางเดิม (Die Shop) ใช้ secret กลาง INGEST_SECRET ต่อไปได้ (`legacy_secret=true`) — ไม่ต้องแตะ Node-RED ตอนนี้
-- additive ล้วน · ย้อน: ท้ายไฟล์

create table if not exists public.integration_sources (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name          text not null,
  note          text,                                  -- ที่อยู่เครื่อง / ฐานข้อมูลต้นทาง / ผู้ดูแล
  kinds         text[] not null default '{}',          -- ชนิดข้อมูลที่ต้นทางนี้ส่ง (ทะเบียนชนิด = src/utils/integrationKinds.js)
  key_hash      text,                                  -- sha256 hex ของรหัสลับ · null = ยังไม่ได้ออกรหัส
  key_hint      text,                                  -- 4 ตัวท้ายของรหัส (ไว้ให้คนเทียบว่าใช้ตัวไหนอยู่)
  legacy_secret boolean not null default false,        -- true = ยังรับ INGEST_SECRET กลางแทนรหัสของตัวเอง
  is_paused     boolean not null default false,        -- พักการรับ = ตอบ 423 ไม่เขียนข้อมูล
  last_seen_at  timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  last_result   jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create table if not exists public.integration_hourly (
  source_id   uuid not null references public.integration_sources(id) on delete cascade,
  hour_at     timestamptz not null,                    -- ปัดลงต้นชั่วโมง
  ok_count    int not null default 0,
  fail_count  int not null default 0,
  saved_rows  int not null default 0,
  primary key (source_id, hour_at)
);
create index if not exists integration_hourly_hour_idx on public.integration_hourly (hour_at);

alter table public.integration_sources enable row level security;
alter table public.integration_hourly  enable row level security;
drop policy if exists integration_sources_read on public.integration_sources;
create policy integration_sources_read on public.integration_sources for select to anon, authenticated using (true);
drop policy if exists integration_hourly_read on public.integration_hourly;
create policy integration_hourly_read on public.integration_hourly for select to anon, authenticated using (true);

-- 🔴 อ่านได้ทุกคอลัมน์ "ยกเว้น key_hash" · ไม่มีสิทธิ์เขียนจาก client เลย
revoke all on public.integration_sources from anon, authenticated;
grant select (id, code, name, note, kinds, key_hint, legacy_secret, is_paused,
              last_seen_at, last_ok_at, last_error, last_result, created_at, updated_at, updated_by)
  on public.integration_sources to anon, authenticated;
revoke all on public.integration_hourly from anon, authenticated;
grant select on public.integration_hourly to anon, authenticated;

/* นับผลการรับ 1 ครั้ง — เรียกจาก edge ingest-energy (service role) เท่านั้น
   อัปเดตสถานะล่าสุดของต้นทาง + บวกตัวนับรายชั่วโมง + ลบสถิติเก่ากว่า 30 วัน */
create or replace function public.fn_integration_tick(p_source uuid, p_ok boolean, p_saved int, p_error text, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update integration_sources set
    last_seen_at = now(),
    last_ok_at   = case when p_ok then now() else last_ok_at end,
    last_error   = case when p_ok then null else left(p_error, 300) end,
    last_result  = p_result
  where id = p_source;
  insert into integration_hourly (source_id, hour_at, ok_count, fail_count, saved_rows)
  values (p_source, date_trunc('hour', now()), case when p_ok then 1 else 0 end, case when p_ok then 0 else 1 end, coalesce(p_saved, 0))
  on conflict (source_id, hour_at) do update set
    ok_count   = integration_hourly.ok_count   + excluded.ok_count,
    fail_count = integration_hourly.fail_count + excluded.fail_count,
    saved_rows = integration_hourly.saved_rows + excluded.saved_rows;
  delete from integration_hourly where hour_at < now() - interval '30 days';
end $$;
revoke all on function public.fn_integration_tick(uuid, boolean, int, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_integration_tick(uuid, boolean, int, text, jsonb) to service_role;

-- ต้นทางแรก = Node-RED Die Shop (ส่งอยู่แล้วด้วย INGEST_SECRET กลาง)
insert into public.integration_sources (code, name, note, kinds, legacy_secret)
values ('dieshop', 'Node-RED Die Shop', '10.0.119.21 · PLC FX5U → MySQL db_user03',
        array['energy_readings','energy_events','energy_daily','energy_limits'], true)
on conflict (code) do nothing;

comment on table public.integration_sources is
  'ศูนย์เชื่อมต่อ: ทะเบียนต้นทาง (Node-RED ฯลฯ) · รหัสลับเก็บเป็น hash · เขียนผ่าน edge integration-admin/ingest-energy เท่านั้น';

-- ตรวจหลังรัน:
--   select code, name, kinds, legacy_secret, key_hint from integration_sources;
--   set role anon; select key_hash from integration_sources;  -- ต้อง error: permission denied
-- ย้อน:
--   drop function if exists public.fn_integration_tick(uuid, boolean, int, text, jsonb);
--   drop table if exists public.integration_hourly; drop table if exists public.integration_sources;
