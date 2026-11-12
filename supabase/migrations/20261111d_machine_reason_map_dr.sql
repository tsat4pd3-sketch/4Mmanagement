-- 🔗 จับคู่ "เหตุผลหยุดของต้นทาง" (Node-RED OnplanMaster / UnplanMaster) → ประเภท downtime ของ ESM (dr_downtime_types)
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-11 · คำสั่ง user "น่าจะมีหลายตัวตรงกับ ESM เราที่ต้องเลือก"
-- 📄 docs/modules/integration-hub.md §OEE Line D3
--
-- 🔴 คนเลือกเท่านั้น — ระบบเสนอได้ แต่ห้ามเขียนผลเดาลงตารางนี้ (เขียนผ่าน edge integration-admin action map_reason)
-- 🔴 ยังไม่มีใครเอาไปเขียน downtime_logs — ใช้ "แสดงชื่อเหตุผลแบบ ESM" ในจอเทียบเท่านั้น (เฟสเดินคู่)
-- reason_kind: onplan = ต้นทางจัดเป็นหยุดตามแผน (PLANNED_STOP/NO_PLAN → OnplanMaster)
--              unplan = หยุดนอกแผน (FAULT/IDLE → UnplanMaster) — รหัสเลขเดียวกันคนละ master ⇒ ต้องแยกด้วย kind
-- additive ล้วน · ย้อน: ท้ายไฟล์

create table if not exists public.machine_reason_map (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.integration_sources(id) on delete cascade,
  reason_kind       text not null check (reason_kind in ('onplan','unplan')),
  reason_code       int  not null,
  reason_text       text,                                            -- ชื่อเหตุผลฝั่งต้นทาง ณ ตอนจับคู่ (ไว้อ่าน)
  downtime_type_id  uuid references public.dr_downtime_types(id),    -- null = ยืนยันแล้วว่า "ไม่มีตัวตรงใน ESM"
  confirmed_by      text,
  confirmed_at      timestamptz,
  unique (source_id, reason_kind, reason_code)
);

alter table public.machine_reason_map enable row level security;
drop policy if exists machine_reason_map_read on public.machine_reason_map;
create policy machine_reason_map_read on public.machine_reason_map for select to anon, authenticated using (true);
revoke all on public.machine_reason_map from anon, authenticated;
grant select on public.machine_reason_map to anon, authenticated;

comment on table public.machine_reason_map is
  'เหตุผลหยุดของต้นทาง → dr_downtime_types · คนยืนยันผ่าน edge integration-admin · ยังไม่ถูกใช้เขียน downtime_logs';

-- ตรวจ:
--   select has_table_privilege('anon','public.machine_reason_map','insert');   -- ต้อง false
-- ย้อน:
--   drop table if exists public.machine_reason_map;
