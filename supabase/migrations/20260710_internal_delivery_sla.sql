-- Internal Delivery SLA — เกณฑ์เวลาส่งงานภายในโรงงาน (ใช้กับบอร์ดเวลา Rack Center)
-- ★ Applied on DR project (eyhclzkifitbhbljgoav) via MCP — ไฟล์นี้เก็บไว้เป็นประวัติ
-- ⚠️ DR project อ่านผ่าน client anon เท่านั้น — RLS ต้องเป็น to public ห้ามเปลี่ยนเป็น TO authenticated

create table if not exists internal_delivery_sla (
  kind text primary key,                    -- ประเภทงานส่งภายใน เช่น 'rack'
  prepare_within_min int not null default 15,  -- ต้องเริ่มจัดเตรียม/รับเรื่องภายใน (นาที)
  deliver_within_min int not null default 45,  -- ต้องส่งถึงปลายทางภายใน (นาที)
  updated_at timestamptz not null default now()
);

alter table internal_delivery_sla enable row level security;

drop policy if exists "internal_delivery_sla_select" on internal_delivery_sla;
create policy "internal_delivery_sla_select" on internal_delivery_sla
  for select to public using (true);

drop policy if exists "internal_delivery_sla_write" on internal_delivery_sla;
create policy "internal_delivery_sla_write" on internal_delivery_sla
  for all to public using (true) with check (true);

insert into internal_delivery_sla (kind, prepare_within_min, deliver_within_min)
values ('rack', 15, 45)
on conflict (kind) do nothing;

-- Rollback:
--   drop table if exists internal_delivery_sla;
