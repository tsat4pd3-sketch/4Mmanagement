-- ⚡ เหตุการณ์จากระบบไฟ Node-RED (โหลดเกิน / กระแสไม่สมดุล ฯลฯ) → ESM
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-10 · คำสั่ง user (ข้อ 3 จากรายการที่ยังขาด)
--
-- ต้นทาง: MySQL db_user03.energy_event (Node-RED เป็นคนตัดสินเกินลิมิต/ไม่สมดุล · ESM แค่เก็บ+แสดง)
-- ตัวส่ง: flow Node-RED ทุก 1 นาที ส่งเหตุการณ์ 3 นาทีล่าสุด → edge `ingest-energy` (body.events)
--   ซ้ำ = ข้าม (คีย์ = id ของต้นทาง) ⇒ flow ไม่ต้องจำว่าส่งถึงไหน
-- ⚠️ ปริมาณ: ต้นทางเกิดหลายพันแถว/วัน (LASER แกว่งรอบลิมิต) ⇒ edge ลบแถวเก่ากว่า 30 วันเองทุกรอบ
-- additive ล้วน

create table if not exists public.energy_events (
  source_id   bigint primary key,                 -- energy_event.id ฝั่ง MySQL
  scope_kind  text not null default 'zone',
  scope_name  text not null,                      -- ชื่อตู้ (DB-ROBOT ฯลฯ) = machine ฝั่งต้นทาง
  ev_time     timestamptz not null,
  level       text,                               -- warn / ok / ...
  code        text,                               -- kw / imb / ...
  kind        text,                               -- START / CLEAR
  message     text,
  value       numeric,
  duration_s  int,
  received_at timestamptz not null default now()
);
create index if not exists energy_events_time_idx  on public.energy_events (ev_time desc);
create index if not exists energy_events_scope_idx on public.energy_events (scope_kind, scope_name, ev_time desc);

alter table public.energy_events enable row level security;
drop policy if exists energy_events_read on public.energy_events;
create policy energy_events_read on public.energy_events for select to anon, authenticated using (true);
grant select on public.energy_events to anon, authenticated;

comment on table public.energy_events is
  'เหตุการณ์ไฟจาก Node-RED (energy_event) · edge ingest-energy เขียน (ซ้ำ = ข้าม) · เก็บ 30 วัน';

-- Rollback: drop table public.energy_events;
