-- ══ OBEYA เฟส 1 — แกน Safety + หน้าบอร์ด SQCDM รายส่วนงาน (Main · 2026-08-27 · คำสั่งนายใหญ่) ══
-- "กระดาษ OBEYA KPI monitoring หน้างานต้องถูกยุบเข้าโปรแกรม"
--
-- ตรวจก่อนทำแล้วพบว่า 5 ใน 6 แกนของบอร์ด (Q/C/D/M/P) ต่อจากข้อมูลที่วิ่งทุกกะได้เลย
-- แต่ **แกน S (Safety) ไม่มีที่เก็บในระบบเลย** — วัดจริง 2026-08-27:
--   · ไม่มีตารางชื่อ accident/incident/injury/safety สักตัว
--   · PPE จาก daily_production_logs: NG 2 แถว จาก 6,028 คน-วัน = ไม่มีสัญญาณให้ทำ KPI
--   · BBS: 3 ใบ ทั้งหมด auto-fill จาก PPE + คนกรอกเอง 1 แถว = ยังไม่ได้ใช้จริง
-- → ตารางนี้คือที่เก็บ "เหตุการณ์ความปลอดภัย" ตัวจริง
--
-- กติกา:
-- - 1 แถว = 1 เหตุการณ์ · ผูก "ส่วนงาน" เป็นหลัก (บอร์ด OBEYA แยกรายส่วนงานตามที่ user สั่ง)
--   line_name เป็น optional (บางเหตุเกิดนอกไลน์ เช่น ทางเดิน/คลัง)
-- - kind ไล่ตามพีระมิดความปลอดภัยสากล: near_miss → property → first_aid → medical → restricted → lti
--   **ไม่มี check constraint โดยตั้งใจ** — โรงงานอื่นตอน rollout อาจแบ่งชั้นไม่เหมือนกัน
--   source of truth ของลิสต์อยู่ src/utils/obeya.js (pattern เดียวกับ line_type / die_status)
-- - ชื่อพนักงานเก็บเป็น snapshot (text) ไม่ FK — ใบเก่าต้องอ่านออกแม้คนลาออก
--   (pattern เดียวกับ ojt_training_attendees.emp_name / lpa_audit_answers.question_text)
-- - ลบ = soft delete (is_active=false) — บันทึกความปลอดภัยห้ามหายจากประวัติ
-- - RLS data-driven ผ่าน has_perm() ตามกฎ "RLS ก็ต้อง data-driven"
-- - audit + updated_at ตามกฎ "ตาราง master/editable ต้องมี audit"

create table if not exists public.safety_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  occurred_at timestamptz,              -- เวลาที่เกิด (ถ้ารู้) — ไม่รู้ = null ห้ามเดา
  shift text,                           -- day/night (ถ้ารู้)
  section text,                         -- ส่วนงาน (PD1..PD4 / QA / MTN …) — แกนหลักของบอร์ด
  line_name text,                       -- ไลน์ (optional)
  kind text not null default 'near_miss',
  lost_days int not null default 0,     -- วันหยุดงานจริง (ใช้กับ lti)
  employee_name text,                   -- snapshot
  employee_code text,                   -- snapshot
  description text not null,            -- เกิดอะไรขึ้น (บังคับ — เหตุการณ์ที่ไม่มีรายละเอียดใช้ต่อไม่ได้)
  body_part text,
  cause text,                           -- สาเหตุ (เติมทีหลังได้)
  countermeasure text,                  -- มาตรการแก้ไข
  status text not null default 'open',  -- open | closed
  closed_at timestamptz,
  reported_by_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_safety_events_date on public.safety_events (event_date desc);
create index if not exists idx_safety_events_section on public.safety_events (section, event_date desc);

-- ── RLS: อ่าน = ทุกคนที่ login (บอร์ดติดผนังทุกคนต้องเห็น) · เขียน = has_perm('safety:record') ──
alter table public.safety_events enable row level security;
drop policy if exists safety_events_read on public.safety_events;
create policy safety_events_read on public.safety_events
  for select to authenticated using (true);
drop policy if exists safety_events_write on public.safety_events;
create policy safety_events_write on public.safety_events
  for all to authenticated
  using (public.has_perm('safety:record'))
  with check (public.has_perm('safety:record'));

-- ── audit + updated_at ──
drop trigger if exists trg_safety_events_audit on public.safety_events;
create trigger trg_safety_events_audit after insert or update or delete on public.safety_events
  for each row execute function public.fn_audit();
drop trigger if exists trg_safety_events_updated on public.safety_events;
create trigger trg_safety_events_updated before update on public.safety_events
  for each row execute function public.fn_set_updated_at();

-- ── ทะเบียนสิทธิ์ (กฎ: action ใหม่ต้องลง permission_catalog ไม่งั้น admin ปรับจาก UI ไม่ได้) ──
-- group_name ต้องเป็นชื่อหมวดตาม NAV_GROUP_ORDER · หมวดภาพรวม = ช่วง 1xx (110 factory_map · 120 kpi → ใช้ 130)
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'safety', 'record', 'OBEYA — บันทึก/แก้เหตุการณ์ความปลอดภัย (อุบัติเหตุ · near miss)', 'ภาพรวม', 130
where not exists (
  select 1 from public.permission_catalog where resource = 'safety' and action = 'record'
);

-- ── seed สิทธิ์: ระบุ role ชัดเจน ห้าม enum_range (กับดัก role ใหม่ fail-closed) ──
-- คนที่อยู่หน้างานและรู้เหตุทันที = หัวหน้าไลน์ขึ้นไป · dept_admin = bucket ให้แอดมินหน่วยงานบันทึกของตัวเอง
insert into public.role_permissions (role, permission_key, allowed)
select v.r::user_role, 'safety:record', true
from (values ('manager'), ('supervisor'), ('leader'), ('dept_admin')) v(r)
where not exists (
  select 1 from public.role_permissions
  where role = v.r::user_role and permission_key = 'safety:record'
);

-- ── สิทธิ์เข้าหน้า /obeya — บอร์ดติดผนัง ทุกคนดูได้ (pattern เดียวกับ /factory-map) ──
-- ⚠️ ไม่ seed ให้ dept_admin: เป็น bucket ที่โค้ด hasPermission() บล็อก key ขึ้นต้น 'page:' ไว้อยู่แล้ว
insert into public.role_permissions (role, permission_key, allowed)
select v.r::user_role, 'page:/obeya', true
from (values ('admin'), ('manager'), ('supervisor'), ('leader'), ('qa'), ('document_control'),
             ('sale'), ('mtn'), ('engineer'), ('planner_store'), ('display')) v(r)
where not exists (
  select 1 from public.role_permissions
  where role = v.r::user_role and permission_key = 'page:/obeya'
);
