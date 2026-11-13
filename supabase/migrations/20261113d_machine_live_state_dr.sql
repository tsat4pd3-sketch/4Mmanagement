-- 🟢 สถานะสดของเครื่อง (ตอนนี้เดิน/รอ/Alarm มาตั้งแต่เมื่อไหร่) — ชนิดข้อมูล machine_live ของศูนย์เชื่อมต่อ
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-13 · 📄 docs/modules/integration-hub.md §สถานะสด
-- ทำไมต้องมี: oee_stop ส่งได้เฉพาะ "ช่วงหยุดที่จบแล้ว" ⇒ ESM ไม่รู้ว่าตอนนี้เครื่องหยุดค้างอยู่หรือไม่
-- 🔴 เก็บ "ข้อความของต้นทาง" ตามจริง (state_text/alarm_text…) — ESM ยังไม่จับคู่รหัสสถานะ (MCStateMaster) ⇒ ห้ามเดาสี/ประเภท
-- 1 แถวต่อเครื่อง (ทับทุกครั้ง) · client อ่านอย่างเดียว · เขียนโดย edge ingest-energy · additive ล้วน

create table if not exists public.machine_live_state (
  source_id         uuid not null references public.integration_sources(id) on delete cascade,
  machine_tag       text not null,
  state_code        int,
  state_text        text,
  since             timestamptz,          -- เริ่มสถานะปัจจุบัน (ตามต้นทาง)
  alarm_text        text,
  onplan_text       text,
  unplan_text       text,
  production_enable boolean,
  total_product     bigint,
  source_updated_at timestamptz,          -- LastUpdate ของต้นทาง
  received_at       timestamptz not null default now(),
  primary key (source_id, machine_tag)
);
alter table public.machine_live_state enable row level security;
drop policy if exists machine_live_state_read on public.machine_live_state;
create policy machine_live_state_read on public.machine_live_state for select to anon, authenticated using (true);
revoke all on public.machine_live_state from anon, authenticated;
grant select on public.machine_live_state to anon, authenticated;
comment on table public.machine_live_state is 'สถานะสดของเครื่อง 1 แถว/เครื่อง (ทับทุกนาที) · เขียนโดย edge ingest-energy · ข้อความตามต้นทาง';

-- ตรวจ: select has_table_privilege('anon','public.machine_live_state','insert');  -- ต้อง false
-- ย้อน: drop table if exists public.machine_live_state;
