-- ============================================================================
-- Transport scale + vehicle speed → route distance(m) / time / simulation
-- ============================================================================
-- TARGET PROJECT: DR (eyhclzkifitbhbljgoav) — supabaseDR client. additive ล้วน.
--
-- ต่อยอด Transport Route Graph: แปลง "หน่วยผัง (%)" → เมตรจริง + ความเร็วยานพาหนะ
--   → คำนวณเวลาเส้นทางรอบส่ง + จำลองการวิ่ง (ดู CLAUDE.md §Transport Route Graph)
-- ============================================================================

-- ความเร็วต่อชนิดยานพาหนะ (km/h) — null = ใช้ค่า default ในโค้ด
alter table public.transport_vehicles add column if not exists speed_kmh numeric;

-- ค่าเริ่มต้นความเร็วโดยประมาณ (แก้ได้จากหน้า Transport)
update public.transport_vehicles set speed_kmh = 4  where code = 'handlift' and speed_kmh is null;
update public.transport_vehicles set speed_kmh = 8  where code = 'tow'      and speed_kmh is null;
update public.transport_vehicles set speed_kmh = 10 where code = 'forklift' and speed_kmh is null;
update public.transport_vehicles set speed_kmh = 4  where code = 'cart'     and speed_kmh is null;
update public.transport_vehicles set speed_kmh = 5  where code = 'amr'      and speed_kmh is null;

-- มาตราส่วนของผัง (แถวเดียว) — meters_per_unit = เมตรจริงต่อ 1 หน่วยผัง (%coord)
create table if not exists public.transport_settings (
  id              int primary key default 1 check (id = 1),
  meters_per_unit numeric,                 -- null = ยังไม่ตั้งมาตราส่วน (แสดงเป็นหน่วยผัง)
  dwell_min       numeric default 0,       -- เวลาแวะต่อจุดจอด (นาที) — default sim
  updated_by_name text,
  updated_at      timestamptz not null default now()
);
insert into public.transport_settings (id) values (1) on conflict (id) do nothing;

alter table public.transport_settings enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='transport_settings' and policyname='allow_all_transport_settings') then
    execute 'create policy allow_all_transport_settings on public.transport_settings for all to public using (true) with check (true)';
  end if;
end $$;
