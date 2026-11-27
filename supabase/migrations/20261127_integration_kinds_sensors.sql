-- 🔌 ทะเบียนชนิดข้อมูลของศูนย์เชื่อมต่อ (เดิม hardcode ใน src/utils/integrationKinds.js) + ข้อมูลเซนเซอร์ทั่วไป
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-27 · คำสั่ง user "การเพิ่มชนิด ไม่ควร hardcode ควรเป็น modal ให้ CRUD ได้"
-- user เลือก: ① รับข้อมูลได้ทันที (ตารางเซนเซอร์กลาง) ② ชนิดเดิม 7 ตัวแก้ได้แค่ชื่อ/ไอคอน/คำอธิบาย ③ เก็บรายนาที 7 วัน + สรุปรายวัน
-- 📄 docs/modules/integration-hub.md §ชนิดข้อมูลแก้ได้
--
-- เขียนผ่าน edge integration-admin เท่านั้น (has_perm('integration:manage') ฝั่ง Main) — client DR = anon อ่านอย่างเดียว
-- ย้อนกลับ: drop table sensor_daily, sensor_readings, integration_kinds (ไม่มีตารางเดิมพึ่ง — ชนิดเดิมยังอยู่ในโค้ด)

create table if not exists public.integration_kinds (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label       text not null check (length(trim(label)) > 0),
  icon        text,
  unit        text,                                   -- หน่วยของค่า (°C · mm/s) — ใช้กับชนิดเซนเซอร์
  help        text,
  is_builtin  boolean not null default false,         -- ชนิดที่โค้ดมีปลายทางเฉพาะ: ห้ามลบ ห้ามเปลี่ยน key
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

insert into public.integration_kinds (key, label, icon, help, is_builtin, sort_order) values
  ('energy_readings', 'ค่าไฟรายนาที', '⚡', 'kW สูงสุด · เลขมิเตอร์ kWh · V · A ต่อตู้ ทุก 1 นาที', true, 1),
  ('energy_events',   'เหตุการณ์ไฟฟ้า', '🔔', 'เกินลิมิต / ไม่สมดุล ที่ต้นทางตัดสิน · ซ้ำ = ข้าม · เก็บ 30 วัน', true, 2),
  ('energy_daily',    'ยอดไฟรายวัน', '📅', 'เติมวันที่ ESM มีข้อมูลไม่ครบ (เฉพาะวันที่ผ่านไปแล้ว)', true, 3),
  ('energy_limits',   'ลิมิตตู้ไฟ', '🎚️', 'ต้นทางเป็นเจ้าของลิมิต · ESM ตามเองเมื่อค่าเปลี่ยน', true, 4),
  ('machine_state',   'สถานะเครื่อง (ช่วงหยุด)', '🏭', 'ช่วงหยุด + เหตุผลที่กดหน้าเครื่อง · เฟสเดินคู่: เทียบกับที่คนลง ยังไม่เข้าสูตร OEE · เก็บ 90 วัน', true, 5),
  ('piece_count',     'นับชิ้น', '🔢', 'ชิ้นต่อนาทีจากเครื่อง (+NG ที่กดหน้าเครื่อง) — เทียบกับยอดที่คนลง · ยังไม่เข้าสูตร OEE · เก็บ 90 วัน', true, 6),
  ('machine_live',    'สถานะสดของเครื่อง', '🟢', 'ตอนนี้เครื่องอยู่สถานะไหน มาตั้งแต่เมื่อไหร่ (ข้อความตามต้นทาง) · 1 แถว/เครื่อง ทับทุกนาที', true, 7)
on conflict (key) do nothing;

-- 📈 ค่าเซนเซอร์รายนาที (ชนิดที่เพิ่มเองทุกตัว · body.sensors ของ ingest-energy) — เก็บ 7 วัน
create table if not exists public.sensor_readings (
  source_id   uuid not null references public.integration_sources(id) on delete cascade,
  kind_key    text not null references public.integration_kinds(key) on update cascade,
  point       text not null,                           -- จุดวัด/เครื่องตามต้นทาง (ข้อความ)
  bucket_at   timestamptz not null,                    -- ปัดเป็นนาที
  value       numeric not null,
  received_at timestamptz not null default now(),
  primary key (source_id, kind_key, point, bucket_at)
);
create index if not exists sensor_readings_kind_time on public.sensor_readings (kind_key, bucket_at desc);

-- 📅 สรุปรายวันตามปฏิทินไทย (เก็บยาว) — trigger บวกทุกครั้งที่มีแถวรายนาทีใหม่ (ซ้ำนาทีเดิม = ไม่เข้า trigger เพราะ insert ไม่เกิด)
create table if not exists public.sensor_daily (
  source_id  uuid not null references public.integration_sources(id) on delete cascade,
  kind_key   text not null references public.integration_kinds(key) on update cascade,
  point      text not null,
  day        date not null,
  n          int not null default 0,
  v_sum      numeric not null default 0,               -- เฉลี่ย = v_sum / n (จอคิด)
  v_min      numeric,
  v_max      numeric,
  updated_at timestamptz not null default now(),
  primary key (source_id, kind_key, point, day)
);

create or replace function public.fn_sensor_daily_roll() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.sensor_daily as d (source_id, kind_key, point, day, n, v_sum, v_min, v_max, updated_at)
  values (new.source_id, new.kind_key, new.point, (new.bucket_at at time zone 'Asia/Bangkok')::date, 1, new.value, new.value, new.value, now())
  on conflict (source_id, kind_key, point, day) do update
    set n = d.n + 1, v_sum = d.v_sum + excluded.v_sum,
        v_min = least(d.v_min, excluded.v_min), v_max = greatest(d.v_max, excluded.v_max), updated_at = now();
  return new;
end $$;
drop trigger if exists trg_sensor_daily_roll on public.sensor_readings;
create trigger trg_sensor_daily_roll after insert on public.sensor_readings for each row execute function public.fn_sensor_daily_roll();

-- RLS: อ่านได้ (client DR = anon เสมอ) · เขียนผ่าน service role ใน edge เท่านั้น ⇒ ไม่มี policy เขียน
alter table public.integration_kinds enable row level security;
alter table public.sensor_readings  enable row level security;
alter table public.sensor_daily     enable row level security;
drop policy if exists integration_kinds_read on public.integration_kinds;
create policy integration_kinds_read on public.integration_kinds for select to anon, authenticated using (true);
drop policy if exists sensor_readings_read on public.sensor_readings;
create policy sensor_readings_read on public.sensor_readings for select to anon, authenticated using (true);
drop policy if exists sensor_daily_read on public.sensor_daily;
create policy sensor_daily_read on public.sensor_daily for select to anon, authenticated using (true);
grant select on public.integration_kinds, public.sensor_readings, public.sensor_daily to anon, authenticated;
