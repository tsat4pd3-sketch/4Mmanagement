-- 📡 ทะเบียน MQTT topic ของมิเตอร์ไฟฟ้า — ให้ทีมช่างเพิ่ม topic เองจากหน้าจอ
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-20
--
-- ที่มา (user): "ทำเป็นหน้าให้ user mtn สามารถเพิ่ม topic ที่จะให้ read เลยได้มั้ย"
-- แบบเต็ม + เหตุผลของทุกข้อ: docs/ENERGY_MONITORING_DESIGN.md §14
--
-- ⚠️⚠️ ตารางนี้เป็น "ทะเบียนตั้งค่า" เท่านั้น — **ยังไม่มีอะไรอ่านค่าเข้ามา**
--    ต้องมี (1) MQTT bridge บนเครื่องในโรงงาน (2) edge function ingest-energy ถึงจะมีข้อมูลจริง
--    หน้าจอต้องบอกเรื่องนี้ให้ชัด ไม่งั้นช่างเพิ่ม topic แล้วรอข้อมูลที่ไม่มีวันมา (ห้ามล้มเหลวเงียบ)

-- ── (1) ทะเบียน topic → จุดวัด ────────────────────────────────────────────
-- ⭐ ต้องเป็น "ข้อมูลในตาราง" ไม่ใช่ค่าใน code — เพิ่มมิเตอร์ใหม่ = เพิ่มแถว ไม่ต้อง deploy
--    และโรงงานอื่นตอน rollout ตั้ง topic คนละแบบได้ (pattern เดียวกับ machine_tag_map ของ SCADA)
create table if not exists public.energy_meter_topics (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null,                       -- 'plant/utility/steel/power'
  field       text not null default 'kw'           -- ค่าที่อ่านจาก topic นี้
                check (field in ('kw','kwh_total','kvar','pf')),
  -- ผูกกับ "จุดวัด" ที่มีอยู่แล้วในโมดูลพลังงาน (เดียวกับ energy_monthly / energy_points)
  scope_kind  text not null check (scope_kind in ('line','zone')),
  scope_name  text not null,
  json_path   text,                                -- payload เป็น JSON → ชี้ field ('$.data.activePower')
  scale       numeric not null default 1,          -- ตัวคูณ (มิเตอร์บางตัวส่งเป็น W หรือ ×10)
  note        text,
  is_active   boolean not null default true,
  updated_by_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- topic เดียวส่งได้หลายค่า (kw + kwh_total) แต่ห้ามผูกค่าเดิมซ้ำ
  unique (topic, field)
);
create index if not exists energy_meter_topics_scope_idx
  on public.energy_meter_topics (scope_kind, scope_name);

-- ── (2) ค่าล่าสุดที่อ่านได้ (bridge เขียนทับ) ──────────────────────────────
-- ⚠️ **แยกจากตารางตั้งค่าโดยตั้งใจ** — bridge อัปเดตทุก 15 นาที × ทุกมิเตอร์
--    ถ้าเก็บรวมในตารางตั้งค่าที่ผูก audit trigger จะได้ audit_log ~2,000 แถว/วัน (บวมฟรีๆ)
-- ⚠️ 1 แถวต่อ (จุดวัด × ค่า) · **UPDATE ทับ ไม่ INSERT** → ตารางไม่โตเลย
--    ประวัติราย 15 นาทีเป็นคนละตาราง (energy_interval — ยังไม่สร้าง รอเฟสที่มี bridge จริง)
create table if not exists public.energy_live (
  scope_kind  text not null,
  scope_name  text not null,
  field       text not null,
  value       numeric,
  unit        text,
  read_at     timestamptz not null default now(),  -- เวลาที่ "มิเตอร์" อ่านได้ (จาก payload ถ้ามี)
  received_at timestamptz not null default now(),  -- เวลาที่ระบบรับเข้า
  topic       text,
  primary key (scope_kind, scope_name, field)
);

-- ── (3) topic ที่ bridge เจอแต่ยังไม่มีใครผูก ──────────────────────────────
-- ⚠️ ห้ามให้ topic แปลกหายเงียบ — ต้องโผล่ในหน้าจอให้กดผูกได้
--    (หลักเดียวกับ "จุดที่กรอกค่าไฟไว้แต่ยังไม่ได้ตีกรอบบนผัง" §13.6)
create table if not exists public.energy_topic_unmapped (
  topic        text primary key,
  sample       text,                                -- payload ตัวอย่าง (ตัดสั้น) ช่วยให้ตั้ง json_path ถูก
  hits         int not null default 1,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

alter table public.energy_meter_topics   enable row level security;
alter table public.energy_live           enable row level security;
alter table public.energy_topic_unmapped enable row level security;
drop policy if exists energy_meter_topics_all on public.energy_meter_topics;
create policy energy_meter_topics_all on public.energy_meter_topics
  for all to anon, authenticated using (true) with check (true);
drop policy if exists energy_live_all on public.energy_live;
create policy energy_live_all on public.energy_live
  for all to anon, authenticated using (true) with check (true);
drop policy if exists energy_topic_unmapped_all on public.energy_topic_unmapped;
create policy energy_topic_unmapped_all on public.energy_topic_unmapped
  for all to anon, authenticated using (true) with check (true);

-- audit เฉพาะตารางตั้งค่า (ตารางค่าสดถูกเขียนทับถี่ ผูก audit = บวมเปล่า)
drop trigger if exists trg_energy_meter_topics_updated on public.energy_meter_topics;
create trigger trg_energy_meter_topics_updated before update on public.energy_meter_topics
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_energy_meter_topics_audit on public.energy_meter_topics;
create trigger trg_energy_meter_topics_audit after insert or update or delete on public.energy_meter_topics
  for each row execute function public.fn_audit();

comment on table public.energy_meter_topics is
  'ทะเบียน MQTT topic → จุดวัดพลังงาน · ตั้งจากหน้า /energy แท็บ 📡 · ต้องมี bridge ถึงจะมีข้อมูลเข้า';
comment on table public.energy_live is
  'ค่าล่าสุดต่อจุดวัด — UPDATE ทับเสมอ ไม่ INSERT (ตารางไม่โต) · ไม่ผูก audit โดยตั้งใจ';
comment on table public.energy_topic_unmapped is
  'topic ที่ bridge เจอแต่ยังไม่ได้ผูกกับจุดวัด — ต้องโผล่ในหน้าจอให้คนกดผูก ห้ามหายเงียบ';

-- Rollback:
--   drop table public.energy_topic_unmapped;
--   drop table public.energy_live;
--   drop table public.energy_meter_topics;
--   (additive ล้วน — ไม่มีตารางเดิมอ้างถึง ลบแล้วโมดูลพลังงานทำงานเหมือนเดิม)
