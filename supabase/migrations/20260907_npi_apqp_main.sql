-- ═══ 🚀 NPI — พาร์ทใหม่ APQP / PPAP / Drawing Rev / ECI / Tooling Plan (เฟส 1-3) · Main project ═══
-- 2026-09-07 · คำสั่ง user: "ให้ ESM ครอบคลุมทั้งหมดของ E-SPT — ไล่ทำเรื่องที่ยังไม่ต้องยุ่งกับ supplier ก่อน
--   อยู่ในหมวด engineering"  · ที่มา: รีวิวเดค E-SPT (VR Intelligence) + IATF gap review ข้อ APQP/PPAP/ECN
-- แบบเต็ม: docs/modules/npi-apqp.md
--
-- โปรเจคปลายทาง: **Main (ewhdfqwfwofivojtsizn)** — เหตุผลเดียวกับ pe_*: เอกสารควบคุมมี workflow อนุมัติ
--   ต้องอยู่ฝั่ง authenticated · และเฟส 4 (supplier portal) จะเปิดให้คนนอก login ซึ่งทำได้เฉพาะฝั่งที่มี auth
--   ⚠️ ห้ามย้ายตารางชุดนี้ไป DR (anon-open) — supplier จะเห็นข้อมูลผลิตทั้งโรงงานผ่าน anon key
--
-- หลักออกแบบ (mini-ADR):
--   1. เฟส/รายการเอกสาร = **แม่แบบ data-driven ต่อลูกค้า** (npi_templates) ไม่ hardcode SPTT0-4 แบบ E-SPT
--      → โตโยต้า = SPTT/CF/ATIS · Ford = APQP/PPAP (AIAG) · ลูกค้าใหม่ = เพิ่มแม่แบบ ไม่แก้โค้ด
--   2. พาร์ท "instantiate" สำเนาจากแม่แบบ (snapshot) — แก้แม่แบบทีหลังไม่ย้อนแก้พาร์ทที่กำลังวิ่ง
--      (เอกสารที่ส่งลูกค้าไปแล้วต้องนิ่ง) · ปุ่ม 🔄 sync เติมเฉพาะรายการที่ยังไม่มี
--   3. สถานะไฟสี (เขียว/เหลือง/แดง) **ไม่เก็บใน DB** — คำนวณจาก due/status ใน src/utils/npi.js เสมอ
--   4. ECI ที่ปิดว่า "implemented" ต้องมีของจริงผูกทุกขา (แบบใหม่/คำขอแก้ PE/ใบ 4M/แผน tooling)
--      — DB check บังคับ กัน "ติ๊กว่าทำแล้ว" เฉยๆ (หลักเดียวกับ pe_change_requests.applied)
--   5. ผู้ทำแม่พิมพ์ (maker) เก็บเป็น text ก่อน — supplier master = เฟส 4 · ตอนนั้นเพิ่ม supplier_id เป็น additive
--
-- Rollback (ลำดับปลอดภัย: revert โค้ดก่อน แล้วค่อยรันบล็อกนี้):
--   drop table if exists public.npi_tooling_steps, public.npi_tooling_plans, public.npi_tooling_step_templates,
--     public.npi_change_requests, public.npi_drawing_revisions, public.npi_tasks, public.npi_deliverables,
--     public.npi_part_phases, public.npi_parts, public.npi_projects,
--     public.npi_template_deliverables, public.npi_template_phases, public.npi_templates cascade;
--   delete from public.role_permissions where permission_key in ('npi:edit','npi:approve','npi:manage_templates','page:/npi');
--   delete from public.permission_catalog where resource = 'npi';
--   delete from public.doc_forms where doc_key = 'npi_ppap_checklist';
--   delete from public.notification_rules where event_key in ('npi_eci_decided','npi_ppap_submitted');
--   (bucket npi-files ปล่อยไว้ได้ — ไม่มีโค้ดเดิมอ้าง)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) แม่แบบเฟส + รายการเอกสาร (ต่อลูกค้า/สไตล์) — master data-driven
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.npi_templates (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,           -- 'apqp_aiag' / 'toyota_sptt' — สร้างแล้วห้ามแก้ (โค้ด/URL อ้าง)
  label       text not null,
  customer    text,                           -- null = ใช้ได้ทั่วไป
  description text,
  is_active   boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.npi_templates is 'แม่แบบเฟสพัฒนาพาร์ทใหม่ต่อลูกค้า (APQP/SPTT) — เพิ่มลูกค้าใหม่ = เพิ่มแถว ไม่แก้โค้ด';

create table if not exists public.npi_template_phases (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.npi_templates(id) on delete cascade,
  code        text not null,                  -- 'p1'..'p5' / 'sptt0'..'sop'
  label       text not null,
  seq         int not null default 0,
  color       text,                           -- สีคอลัมน์บนบอร์ด (null = สีตามลำดับ)
  description text,
  unique (template_id, code)
);

create table if not exists public.npi_template_deliverables (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.npi_templates(id) on delete cascade,
  phase_code  text not null,                  -- เฟสที่ต้องส่งมอบ (อ้าง npi_template_phases.code ของแม่แบบเดียวกัน)
  seq         int not null default 0,
  code        text not null,                  -- 'ppap_07' / 'sptt_cf_concept' — ใช้จับคู่ตอน sync
  label       text not null,
  doc_kind    text not null default 'other'
              check (doc_kind in ('pfc','fmea','cp','drawing','ppap','tooling','inspection','capacity','packaging','other')),
  required    boolean not null default true,
  ppap_element boolean not null default false, -- อยู่ในชุดเอกสาร PPAP ที่ส่งลูกค้า (18 elements AIAG)
  owner_role  text,                           -- ทีมเจ้าของโดย default: engineer/qa/production/planning/sales/purchasing/mtn
  is_active   boolean not null default true,
  unique (template_id, code)
);
create index if not exists npi_tdeliv_tpl_idx on public.npi_template_deliverables (template_id, phase_code, seq);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) โปรเจครุ่นใหม่ + พาร์ท + เฟสรายพาร์ท + เอกสารส่งมอบ (= ทะเบียน PPAP) + งานที่มอบหมาย
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.npi_projects (
  id            uuid primary key default gen_random_uuid(),
  project_code  text not null unique,         -- 'NPI-2026-001' (สร้างจากแอป)
  name          text not null,                -- 'P703 MCA 2027'
  customer      text,
  model         text,                         -- 'P703' — จุดโยง pe_doc_sets.model / dr_products
  template_id   uuid not null references public.npi_templates(id) on delete restrict,
  kickoff_date  date,
  sop_date      date,                         -- วัน SOP ที่ลูกค้ากำหนด — ทุกเฟสนับถอยหลังจากวันนี้
  status        text not null default 'planning'
                check (status in ('planning','active','on_hold','completed','cancelled')),
  leader_name   text,
  description   text,
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.npi_parts (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.npi_projects(id) on delete cascade,
  part_no       text not null,                -- เลขพาร์ทลูกค้า เช่น MB3B-16E060-CH
  part_name     text,
  mat_no        text,                         -- MAT SAP ภายใน (โยง dr_products ฝั่ง DR เป็น text)
  line_name     text,                         -- ไลน์ที่วางแผนผลิต (โยง production_lines/ข้อมูลผลิตตอน SOP)
  pe_set_id     uuid references public.pe_doc_sets(id) on delete set null,  -- ชุด PFC/FMEA/CP ของพาร์ทนี้
  qa_part_id    uuid references public.qa_parts(id)   on delete set null,   -- มาตรฐานตรวจ + drawing balloon ฝั่ง QA
  die_set_code  text,                         -- die_sets.set_code ฝั่ง DR (หลัง transfer แม่พิมพ์เข้าโรงงาน)
  ppap_level    int not null default 3 check (ppap_level between 1 and 5),
  ppap_status   text not null default 'not_started'
                check (ppap_status in ('not_started','in_progress','submitted','approved','interim','rejected')),
  psw_no        text,                         -- เลข Part Submission Warrant
  psw_submitted_at date,
  psw_approved_at  date,
  status        text not null default 'active'
                check (status in ('active','on_hold','completed','cancelled')),
  owner_name    text,
  remark        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, part_no)
);
create index if not exists npi_parts_project_idx on public.npi_parts (project_id);
create index if not exists npi_parts_part_no_idx on public.npi_parts (part_no);

create table if not exists public.npi_part_phases (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references public.npi_parts(id) on delete cascade,
  phase_code    text not null,
  label         text not null,                -- snapshot จากแม่แบบ (แม่แบบเปลี่ยนชื่อทีหลังไม่กระทบ)
  seq           int not null default 0,
  plan_start    date,
  plan_end      date,
  actual_start  date,
  actual_end    date,
  status        text not null default 'not_started'
                check (status in ('not_started','in_progress','completed','skipped')),
  owner_name    text,
  note          text,
  updated_at    timestamptz not null default now(),
  unique (part_id, phase_code)
);

create table if not exists public.npi_deliverables (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references public.npi_parts(id) on delete cascade,
  template_deliverable_id uuid references public.npi_template_deliverables(id) on delete set null,
  phase_code    text not null,
  seq           int not null default 0,
  code          text not null,                -- snapshot code (ใช้ sync กับแม่แบบ)
  label         text not null,
  doc_kind      text not null default 'other'
                check (doc_kind in ('pfc','fmea','cp','drawing','ppap','tooling','inspection','capacity','packaging','other')),
  required      boolean not null default true,
  ppap_element  boolean not null default false,
  status        text not null default 'not_started'
                check (status in ('not_required','not_started','in_progress','submitted','approved','rejected')),
  due_date      date,
  done_at       date,
  approved_by   text,
  approved_at   timestamptz,
  owner_name    text,
  owner_role    text,
  -- หลักฐาน: ชี้ของจริงในระบบ (ชุด PE / แบบ / แผน tooling / QA part) หรือไฟล์/ลิงก์
  ref_kind      text check (ref_kind in ('pe_set','drawing','tooling','qa_part','file','url','other')),
  ref_id        text,
  file_url      text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (part_id, code),
  -- ⚠️ approved ต้องมีคนอนุมัติ — กัน "ติ๊กผ่าน" โดยไม่มีใครรับผิดชอบ
  constraint npi_deliv_approved_needs_by check (status <> 'approved' or coalesce(btrim(approved_by), '') <> '')
);
create index if not exists npi_deliv_part_idx on public.npi_deliverables (part_id, phase_code, seq);
create index if not exists npi_deliv_due_idx  on public.npi_deliverables (due_date) where status not in ('approved','not_required');

create table if not exists public.npi_tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.npi_projects(id) on delete cascade,
  part_id       uuid references public.npi_parts(id) on delete set null,
  deliverable_id uuid references public.npi_deliverables(id) on delete set null,
  phase_code    text,
  title         text not null,
  detail        text,
  assignee_name text,
  assignee_uid  uuid,                         -- profiles.id (แจ้งเตือนเข้ากระดิ่งคนนั้นตรงๆ)
  due_date      date,
  status        text not null default 'open' check (status in ('open','doing','done','cancelled')),
  done_at       timestamptz,
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists npi_tasks_project_idx on public.npi_tasks (project_id, status, due_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) ทะเบียน revision แบบ (2D/3D) + ECI (Engineering Change Instruction)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.npi_drawing_revisions (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references public.npi_parts(id) on delete cascade,
  kind          text not null default '2d' check (kind in ('2d','3d','spec','other')),
  rev           text not null,                -- 'A' / 'Rev.03' / suffix ลูกค้า
  rev_date      date,
  eci_no        text,                         -- เลข ECI/ECN ลูกค้าที่ทำให้เกิด rev นี้
  description   text,
  file_url      text,                         -- PDF/รูป ใน bucket npi-files (3D ไม่เก็บไฟล์ — ใส่ external_url แทน)
  file_name     text,
  external_url  text,                         -- ลิงก์ PLM/แชร์ไดรฟ์ของไฟล์ 3D/ต้นฉบับ
  status        text not null default 'draft' check (status in ('draft','released','obsolete')),
  is_current    boolean not null default false,
  released_by   text,
  released_at   date,
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (part_id, kind, rev),
  constraint npi_dwg_released_needs_by check (status <> 'released' or coalesce(btrim(released_by), '') <> '')
);
-- rev ปัจจุบันมีได้ตัวเดียวต่อ (พาร์ท, ชนิด)
create unique index if not exists npi_dwg_current_uniq on public.npi_drawing_revisions (part_id, kind) where is_current;

create table if not exists public.npi_change_requests (
  id            uuid primary key default gen_random_uuid(),
  eci_no        text not null,                -- เลข ECI/ECN (ลูกค้าให้มา หรือ ECI-YYYYMM-### ภายใน)
  project_id    uuid not null references public.npi_projects(id) on delete cascade,
  part_id       uuid references public.npi_parts(id) on delete set null,
  source        text not null default 'customer' check (source in ('customer','internal')),
  title         text not null,
  description   text,
  requested_by  text,
  requested_date date,
  target_date   date,                         -- ลูกค้าต้องการให้มีผลเมื่อไหร่
  effective_date date,                        -- มีผลจริง (lot/วันแรกที่ใช้ของใหม่)
  status        text not null default 'open'
                check (status in ('open','evaluating','approved','implemented','rejected')),
  -- ผลกระทบ — ติ๊กแล้วต้องมี "ของจริง" ผูกก่อนปิด implemented
  affects_drawing boolean not null default false,
  affects_pe      boolean not null default false,   -- PFC / PFMEA / Control Plan
  affects_process boolean not null default false,   -- วิธีการผลิตหน้างาน = 4M Method
  affects_tooling boolean not null default false,
  impact_note   text,
  drawing_revision_id   uuid references public.npi_drawing_revisions(id) on delete set null,
  pe_change_request_id  uuid references public.pe_change_requests(id) on delete set null,
  four_m_log_id         uuid references public.four_m_logs(id) on delete set null,
  tooling_plan_id       uuid,                 -- FK เพิ่มด้านล่างหลังสร้าง npi_tooling_plans
  decided_by    text,
  decided_at    timestamptz,
  reject_reason text,
  implemented_at date,
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, eci_no),
  constraint npi_eci_reject_needs_reason check (status <> 'rejected' or coalesce(btrim(reject_reason), '') <> ''),
  -- ⚠️ implemented = ทุกขาที่ติ๊กว่ากระทบ ต้องผูกของจริง (แบบใหม่ / คำขอแก้ PE / ใบ 4M / แผน tooling)
  constraint npi_eci_implemented_needs_links check (
    status <> 'implemented' or (
      implemented_at is not null
      and (not affects_drawing or drawing_revision_id is not null)
      and (not affects_pe      or pe_change_request_id is not null)
      and (not affects_process or four_m_log_id is not null)
      and (not affects_tooling or tooling_plan_id is not null)
    )
  )
);
create index if not exists npi_eci_project_idx on public.npi_change_requests (project_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) แผนพัฒนาเครื่องมือ (แม่พิมพ์/จิ๊ก/checking fixture/เกจ) + ขั้นงาน (Gantt) + แม่แบบขั้นงาน
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.npi_tooling_step_templates (
  id            uuid primary key default gen_random_uuid(),
  tool_kind     text not null check (tool_kind in ('die','jig','checking_fixture','gauge','mold','other')),
  seq           int not null default 0,
  name          text not null,
  default_days  int,                          -- ระยะเวลาโดยประมาณ (ใช้เสนอวันแผนตอนสร้าง — คนแก้ได้)
  is_active     boolean not null default true,
  unique (tool_kind, seq)
);

create table if not exists public.npi_tooling_plans (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references public.npi_parts(id) on delete cascade,
  tool_name     text not null,                -- 'OP10 DRAW DIE' / 'CHECKING FIXTURE RH'
  tool_kind     text not null default 'die' check (tool_kind in ('die','jig','checking_fixture','gauge','mold','other')),
  maker_name    text,                         -- ผู้ทำ (text ก่อน — supplier master = เฟส 4 จะเพิ่ม supplier_id)
  maker_kind    text not null default 'external' check (maker_kind in ('internal','external')),
  po_no         text,
  die_set_code  text,                         -- ผูก die_sets.set_code (DR) หลัง transfer เข้าโรงงาน
  plan_start    date,
  plan_end      date,
  actual_start  date,
  actual_end    date,
  status        text not null default 'planned'
                check (status in ('planned','in_progress','tryout','completed','cancelled')),
  owner_name    text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists npi_tooling_part_idx on public.npi_tooling_plans (part_id);

create table if not exists public.npi_tooling_steps (
  id            uuid primary key default gen_random_uuid(),
  tooling_id    uuid not null references public.npi_tooling_plans(id) on delete cascade,
  seq           int not null default 0,
  name          text not null,
  plan_start    date,
  plan_end      date,
  actual_start  date,
  actual_end    date,
  progress_pct  int not null default 0 check (progress_pct between 0 and 100),
  responsible_name text,
  status        text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  note          text,
  updated_at    timestamptz not null default now()
);
create index if not exists npi_tsteps_tool_idx on public.npi_tooling_steps (tooling_id, seq);

alter table public.npi_change_requests
  drop constraint if exists npi_eci_tooling_fk;
alter table public.npi_change_requests
  add constraint npi_eci_tooling_fk foreign key (tooling_plan_id)
  references public.npi_tooling_plans(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RLS + updated_at + audit (pattern เดียวกับ pe_* — สิทธิ์ทำงานคุมที่ UI ผ่าน can())
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'npi_templates','npi_template_phases','npi_template_deliverables',
    'npi_projects','npi_parts','npi_part_phases','npi_deliverables','npi_tasks',
    'npi_drawing_revisions','npi_change_requests',
    'npi_tooling_step_templates','npi_tooling_plans','npi_tooling_steps']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_write', t);
    if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
      execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
      execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.fn_set_updated_at()', t);
    end if;
    -- กฎเหล็ก traceability: ตาราง master/editable ต้องมี audit (ใครเปลี่ยนสถานะ PPAP / ปล่อยแบบ / ปิด ECI)
    if exists (select 1 from pg_proc where proname = 'fn_audit') then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Storage — ไฟล์แบบ (PDF/รูป) + หลักฐานเอกสารส่งมอบ · 20MB · ไม่รับไฟล์ 3D (ใหญ่ + ไม่มี viewer → ใช้ external_url)
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('npi-files', 'npi-files', true, 20971520,
        array['application/pdf','image/jpeg','image/png','image/webp',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do nothing;
drop policy if exists npi_files_read   on storage.objects;
create policy npi_files_read   on storage.objects for select using (bucket_id = 'npi-files');
drop policy if exists npi_files_write  on storage.objects;
create policy npi_files_write  on storage.objects for insert to authenticated with check (bucket_id = 'npi-files');
drop policy if exists npi_files_update on storage.objects;
create policy npi_files_update on storage.objects for update to authenticated using (bucket_id = 'npi-files');
drop policy if exists npi_files_delete on storage.objects;
create policy npi_files_delete on storage.objects for delete to authenticated using (bucket_id = 'npi-files');

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) สิทธิ์ — catalog (โผล่ใน /permissions แท็บสิทธิ์การทำงาน) + seed role ระบุชัด (ห้าม enum_range)
--    ช่วง sort หมวด 'คุณภาพ & วิศวกรรม' = 7xx (ใช้ถึง 750 แล้ว → เริ่ม 755)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.permission_catalog (resource, action, label, group_name, sort) values
  ('npi', 'edit',             'NPI: สร้าง/แก้โปรเจครุ่นใหม่ · พาร์ท · เอกสารส่งมอบ · แบบ · ECI · แผน tooling · งาน', 'คุณภาพ & วิศวกรรม', 755),
  ('npi', 'approve',          'NPI: อนุมัติเอกสารส่งมอบ/PPAP · ปล่อยแบบ (release) · ตัดสิน ECI',              'คุณภาพ & วิศวกรรม', 756),
  ('npi', 'manage_templates', 'NPI: จัดการแม่แบบเฟส/รายการเอกสารต่อลูกค้า',                                 'คุณภาพ & วิศวกรรม', 757)
on conflict (resource, action) do nothing;

-- แก้ = ทีมที่ทำเอกสารจริง (PE/QA/หัวหน้าผลิต/ผู้จัดการ) · engineer = หน่วยงานวิศวกรรมกระบวนการ (เจ้าของโมดูล)
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'npi:edit', true
from (values ('admin'::user_role),('manager'::user_role),('engineer'::user_role),('qa'::user_role),('supervisor'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = 'npi:edit');

insert into public.role_permissions (role, permission_key, allowed)
select r.role, k.key, true
from (values ('admin'::user_role),('manager'::user_role),('engineer'::user_role)) as r(role)
cross join (values ('npi:approve'),('npi:manage_templates')) as k(key)
where not exists (select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = k.key);

-- เข้าหน้า /npi — ทุก role (ดูอย่างเดียว) · ปรับปิดได้ที่ /permissions
-- ⚠️ ต้องมี page:/npi ใน PAGE_GROUPS (PermissionsManagement.jsx) ในคอมมิทเดียวกับ route
insert into public.role_permissions (role, permission_key, allowed)
select r.role, 'page:/npi', true
from (values ('admin'::user_role),('manager'::user_role),('supervisor'::user_role),('leader'::user_role),
             ('mtn'::user_role),('engineer'::user_role),('qa'::user_role),('planner_store'::user_role),
             ('sale'::user_role),('document_control'::user_role),('display'::user_role)) as r(role)
where not exists (select 1 from public.role_permissions rp where rp.role = r.role and rp.permission_key = 'page:/npi');

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) ทะเบียนเอกสาร — ใบ PPAP checklist ที่พิมพ์จากหน้า /npi (กฎ: export ทุกตัวต้องมี doc_key)
--    ยังไม่มีเลขฟอร์มทางการ → form_code = null ให้ doc_control ตั้งเองที่ /doc-forms
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.doc_forms (doc_key, form_code, title, rev, effective_date, paper, paper_size, orientation, layout_locked, used_route, sig_blocks)
values ('npi_ppap_checklist', null, 'PPAP Submission Checklist (รายการเอกสาร PPAP ต่อพาร์ท)',
        null, null, 'A4 แนวตั้ง', 'A4', 'portrait', false, '/npi',
        '["Prepared By","Checked By","Approved By"]'::jsonb)
on conflict (doc_key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) กติกาแจ้งเตือน (edge send-event-notification อ่านจากที่นี่ — ไม่มีแถว = ไม่ส่ง)
--    ผู้รับในแอปตั้งที่ /notification-config · ห้อง Telegram ตั้งเอง
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.notification_rules (event_key, label, category, is_enabled, sort_order, inapp_roles)
values
  ('npi_eci_decided',    '🔁 ECI ถูกตัดสิน (อนุมัติ/ปฏิเสธ/ปิดงาน)', 'quality', true, 390, array['engineer','qa','manager','admin']::text[]),
  ('npi_ppap_submitted', '📦 ส่ง PPAP ให้ลูกค้า / ผลอนุมัติ PPAP',   'quality', true, 391, array['engineer','qa','manager','admin']::text[])
on conflict (event_key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) Seed แม่แบบ — 2 สไตล์ที่เจอจริง (idempotent)
--   A) APQP (AIAG) 5 เฟส + PPAP 18 elements — ใช้กับ Ford/GM/ลูกค้าสาย AIAG (ลูกค้าหลักของ TSAT)
--   B) Toyota SPTT0-4 → SOP — รายการเอกสารถอดจากเดค E-SPT (BKF) · จัดเฟสโดยประมาณ ปรับได้ที่แท็บแม่แบบ
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.npi_templates (code, label, customer, description, sort) values
  ('apqp_aiag',   'APQP (AIAG) 5 เฟส + PPAP 18 elements', null,
   'มาตรฐาน AIAG APQP 2nd ed. / PPAP 4th ed. — ใช้กับ Ford / GM / ลูกค้าที่อ้าง AIAG', 10),
  ('toyota_sptt', 'Toyota SPTT0 → SPTT4 → SOP', 'TOYOTA',
   'ถอดรายการเอกสารจากระบบ SPTT ของโตโยต้า (เดค E-SPT) — จัดเฟสโดยประมาณ ปรับได้ที่แท็บแม่แบบ', 20)
on conflict (code) do nothing;

with t as (select id from public.npi_templates where code = 'apqp_aiag')
insert into public.npi_template_phases (template_id, code, label, seq, color, description)
select t.id, v.code, v.label, v.seq, v.color, v.d from t, (values
  ('p1', 'P1 Plan & Define',                       1, '#3b82f6', 'รับข้อกำหนดลูกค้า · เป้าหมายออกแบบ · timing chart'),
  ('p2', 'P2 Product Design & Dev.',               2, '#8b5cf6', 'แบบ/สเปค · DFMEA (ถ้ารับผิดชอบออกแบบ) · feasibility'),
  ('p3', 'P3 Process Design & Dev.',               3, '#f59e0b', 'PFC · PFMEA · Control Plan (pre-launch) · tooling · packaging'),
  ('p4', 'P4 Product & Process Validation',        4, '#22c55e', 'trial run · MSA · dimensional · capability · PPAP submit'),
  ('p5', 'P5 Feedback & Launch',                   5, '#14b8a6', 'Run@Rate · lesson learned · Control Plan production')
) as v(code, label, seq, color, d)
on conflict (template_id, code) do nothing;

with t as (select id from public.npi_templates where code = 'apqp_aiag')
insert into public.npi_template_deliverables (template_id, phase_code, seq, code, label, doc_kind, required, ppap_element, owner_role)
select t.id, v.ph, v.seq, v.code, v.label, v.kind, v.req, v.ppap, v.owner from t, (values
  -- P1
  ('p1', 10, 'apqp_customer_input',   'Customer input / ข้อกำหนดลูกค้า + design goals',        'other',     true,  false, 'sales'),
  ('p1', 20, 'apqp_timing_chart',     'Timing chart / แผนงานโครงการ',                          'other',     true,  false, 'engineer'),
  ('p1', 30, 'apqp_prelim_bom',       'Preliminary BOM',                                       'other',     true,  false, 'engineer'),
  ('p1', 40, 'apqp_prelim_pfc',       'Preliminary process flow',                              'pfc',       true,  false, 'engineer'),
  ('p1', 50, 'apqp_prelim_sc',        'Preliminary special characteristics list',              'other',     true,  false, 'engineer'),
  ('p1', 60, 'apqp_feasibility',      'Team feasibility commitment',                           'other',     true,  false, 'engineer'),
  -- P2 (PPAP 1-4)
  ('p2', 10, 'ppap_01_design_record', 'PPAP 1 · Design records / แบบ 2D-3D ที่ปล่อยแล้ว',      'drawing',   true,  true,  'engineer'),
  ('p2', 20, 'ppap_02_eng_change',    'PPAP 2 · Authorized engineering change documents (ECI)','other',     true,  true,  'engineer'),
  ('p2', 30, 'ppap_03_cust_approval', 'PPAP 3 · Customer engineering approval',                'other',     false, true,  'sales'),
  ('p2', 40, 'ppap_04_dfmea',         'PPAP 4 · DFMEA (เฉพาะกรณีรับผิดชอบออกแบบ)',            'other',     false, true,  'engineer'),
  -- P3 (PPAP 5-7 + tooling/packaging)
  ('p3', 10, 'ppap_05_pfc',           'PPAP 5 · Process flow diagram (PFC)',                   'pfc',       true,  true,  'engineer'),
  ('p3', 20, 'ppap_06_pfmea',         'PPAP 6 · PFMEA',                                        'fmea',      true,  true,  'engineer'),
  ('p3', 30, 'ppap_07_cp',            'PPAP 7 · Control Plan (pre-launch → production)',       'cp',        true,  true,  'engineer'),
  ('p3', 40, 'apqp_tooling_plan',     'Tooling plan / แผนทำแม่พิมพ์-จิ๊ก-checking fixture',   'tooling',   true,  false, 'engineer'),
  ('p3', 50, 'apqp_gauge_plan',       'Gauge & checking fixture design',                       'tooling',   true,  false, 'qa'),
  ('p3', 60, 'apqp_packaging',        'Packaging specification / มาตรฐานบรรจุ',                'packaging', true,  false, 'planning'),
  ('p3', 70, 'apqp_floor_plan',       'Floor plan / layout ไลน์',                              'other',     true,  false, 'production'),
  ('p3', 80, 'apqp_wi',               'Work instructions / OP sheet',                          'other',     true,  false, 'production'),
  ('p3', 90, 'apqp_msa_plan',         'MSA plan',                                              'inspection',true,  false, 'qa'),
  -- P4 (PPAP 8-18)
  ('p4', 10, 'apqp_trial_run',        'Trial run (T0/T1) + production trial',                  'other',     true,  false, 'production'),
  ('p4', 20, 'ppap_08_msa',           'PPAP 8 · MSA studies (GR&R)',                           'inspection',true,  true,  'qa'),
  ('p4', 30, 'ppap_09_dimensional',   'PPAP 9 · Dimensional results',                          'inspection',true,  true,  'qa'),
  ('p4', 40, 'ppap_10_material',      'PPAP 10 · Material / performance test results',         'inspection',true,  true,  'qa'),
  ('p4', 50, 'ppap_11_process_study', 'PPAP 11 · Initial process studies (Cpk/Ppk)',           'inspection',true,  true,  'qa'),
  ('p4', 60, 'ppap_12_lab',           'PPAP 12 · Qualified laboratory documentation',          'inspection',true,  true,  'qa'),
  ('p4', 70, 'ppap_13_aar',           'PPAP 13 · Appearance Approval Report (AAR)',            'inspection',false, true,  'qa'),
  ('p4', 80, 'ppap_14_sample_parts',  'PPAP 14 · Sample production parts',                     'ppap',      true,  true,  'production'),
  ('p4', 90, 'ppap_15_master_sample', 'PPAP 15 · Master sample',                               'ppap',      true,  true,  'qa'),
  ('p4',100, 'ppap_16_checking_aids', 'PPAP 16 · Checking aids',                               'tooling',   true,  true,  'qa'),
  ('p4',110, 'ppap_17_csr',           'PPAP 17 · Customer-specific requirements',              'ppap',      true,  true,  'qa'),
  ('p4',120, 'ppap_18_psw',           'PPAP 18 · Part Submission Warrant (PSW)',               'ppap',      true,  true,  'qa'),
  ('p4',130, 'apqp_capacity',         'Capacity verification / Run@Rate',                      'capacity',  true,  false, 'production'),
  -- P5
  ('p5', 10, 'apqp_cp_production',    'Control Plan (production) — update หลัง SOP',           'cp',        true,  false, 'engineer'),
  ('p5', 20, 'apqp_lessons',          'Lessons learned / yokoten',                             'other',     true,  false, 'engineer'),
  ('p5', 30, 'apqp_launch_review',    'Launch review (30/60/90 วัน)',                          'other',     true,  false, 'manager')
) as v(ph, seq, code, label, kind, req, ppap, owner)
on conflict (template_id, code) do nothing;

with t as (select id from public.npi_templates where code = 'toyota_sptt')
insert into public.npi_template_phases (template_id, code, label, seq, color, description)
select t.id, v.code, v.label, v.seq, v.color, null from t, (values
  ('sptt0', 'SPTT0', 1, '#3b82f6'), ('sptt1', 'SPTT1', 2, '#8b5cf6'), ('sptt2', 'SPTT2', 3, '#f59e0b'),
  ('sptt3', 'SPTT3', 4, '#f97316'), ('sptt4', 'SPTT4', 5, '#22c55e'), ('sop',   'SOP',   6, '#14b8a6')
) as v(code, label, seq, color)
on conflict (template_id, code) do nothing;

with t as (select id from public.npi_templates where code = 'toyota_sptt')
insert into public.npi_template_deliverables (template_id, phase_code, seq, code, label, doc_kind, required, ppap_element, owner_role)
select t.id, v.ph, v.seq, v.code, v.label, v.kind, true, v.ppap, v.owner from t, (values
  ('sptt0', 10, 'sptt_project_org',   'Project Organization',                          'other',     false, 'engineer'),
  ('sptt0', 20, 'sptt_cpm',           'CPM',                                           'other',     false, 'engineer'),
  ('sptt0', 30, 'sptt_pps',           'PPS',                                           'other',     false, 'engineer'),
  ('sptt0', 40, 'sptt_capacity_study','Capacity Planning Study Sheet',                 'capacity',  false, 'planning'),
  ('sptt0', 50, 'sptt_pess',          'PESS',                                          'other',     false, 'engineer'),
  ('sptt1', 10, 'sptt_tpr',           'TPR (Progress Report)',                         'other',     false, 'engineer'),
  ('sptt1', 20, 'sptt_ppc',           'PPC',                                           'other',     false, 'engineer'),
  ('sptt1', 30, 'sptt_total_confirm', 'Total Confirmation Sheet',                      'other',     false, 'engineer'),
  ('sptt1', 40, 'sptt_cf_concept',    'CF Concept (Checking Fixture concept)',         'tooling',   false, 'qa'),
  ('sptt1', 50, 'sptt_tooling_spec',  'Tooling Specification',                         'tooling',   false, 'engineer'),
  ('sptt1', 60, 'sptt_tooling_po',    'Tooling Order P/O Confirmation',                'tooling',   false, 'purchasing'),
  ('sptt1', 70, 'sptt_cf_po',         'CF Order P/O Confirmation',                     'tooling',   false, 'purchasing'),
  ('sptt1', 80, 'sptt_supplier_list', 'Component : Supplier List',                     'other',     false, 'purchasing'),
  ('sptt2', 10, 'sptt_atis',          'ATIS (Approval Toyota Inspection Standard)',    'inspection',true,  'qa'),
  ('sptt2', 20, 'sptt_pfmea',         'PFMEA',                                         'fmea',      true,  'engineer'),
  ('sptt2', 30, 'sptt_qc_cp',         'QC Control Plan',                               'cp',        true,  'engineer'),
  ('sptt2', 40, 'sptt_pfus',          'PFUS',                                          'other',     false, 'engineer'),
  ('sptt2', 50, 'sptt_sptt_check',    'SPTT Check Sheet',                              'other',     false, 'engineer'),
  ('sptt2', 60, 'sptt_boundary_1a',   'Boundary (1A)',                                 'inspection',false, 'qa'),
  ('sptt3', 10, 'sptt_sds',           'SDS / SDR (Sample Data Sheet / Report)',        'inspection',true,  'qa'),
  ('sptt3', 20, 'sptt_capacity_survey','Capacity Survey',                              'capacity',  false, 'production'),
  ('sptt3', 30, 'sptt_acf_quality',   'ACF Quality',                                   'inspection',false, 'qa'),
  ('sptt3', 40, 'sptt_mqc',           'MQC Doc',                                       'other',     false, 'qa'),
  ('sptt3', 50, 'sptt_boundary_mpt',  'Boundary (MPT)',                                'inspection',false, 'qa'),
  ('sptt4', 10, 'sptt_sop_readiness', 'SOP Readiness Check Sheet',                     'other',     true,  'production'),
  ('sptt4', 20, 'sptt_final_insp',    'FINAL Inspection Check Sheet',                  'inspection',true,  'qa'),
  ('sptt4', 30, 'sptt_abnormal',      'Abnormal Part Handling Confirmation Sheet',     'other',     false, 'qa'),
  ('sop',   10, 'sptt_boundary_sop',  'Boundary (SOP)',                                'inspection',true,  'qa')
) as v(ph, seq, code, label, kind, ppap, owner)
on conflict (template_id, code) do nothing;

-- แม่แบบขั้นงาน tooling (ถอดจากลำดับจริงใน TMS ของ E-SPT: CAD → Design → Material → Machining → Assembly → Polish → T0 → Transfer)
insert into public.npi_tooling_step_templates (tool_kind, seq, name, default_days) values
  ('die', 10, 'รับ CAD data / ศึกษาแบบ',                 5),
  ('die', 20, 'Die concept & design',                     15),
  ('die', 30, 'Design approval (ลูกค้า/ภายใน)',           5),
  ('die', 40, 'เตรียมวัสดุ / สั่งเหล็ก-casting',         20),
  ('die', 50, 'CNC machining',                            25),
  ('die', 60, 'ประกอบแม่พิมพ์ (assembly)',                15),
  ('die', 70, 'Polishing / spotting',                     10),
  ('die', 80, 'T0 tryout (ที่ผู้ทำ)',                     5),
  ('die', 90, 'T1 tryout / แก้ไข',                        10),
  ('die',100, 'Buy-off (ตรวจรับแม่พิมพ์ + ชิ้นงาน)',      5),
  ('die',110, 'Transfer เข้าโรงงาน + ลงทะเบียน die_sets',  5),
  ('jig', 10, 'ออกแบบจิ๊ก',                               10),
  ('jig', 20, 'Design approval',                          3),
  ('jig', 30, 'Machining / fabrication',                  15),
  ('jig', 40, 'ประกอบ + ตั้งค่า',                         7),
  ('jig', 50, 'วัด/สอบเทียบ (measure & calibrate)',       3),
  ('jig', 60, 'Buy-off + transfer',                       3),
  ('checking_fixture', 10, 'CF concept',                  7),
  ('checking_fixture', 20, 'CF design approval',          5),
  ('checking_fixture', 30, 'Fabrication',                 20),
  ('checking_fixture', 40, 'CMM certify',                 5),
  ('checking_fixture', 50, 'CF approval report / buy-off', 5),
  ('gauge', 10, 'ออกแบบ/สั่งเกจ',                          7),
  ('gauge', 20, 'รับของ + สอบเทียบ',                      5),
  ('gauge', 30, 'MSA (GR&R)',                             5),
  ('mold', 10, 'Mold design',                             15),
  ('mold', 20, 'Machining',                               25),
  ('mold', 30, 'Assembly + T0',                           10),
  ('mold', 40, 'Buy-off + transfer',                      5),
  ('other', 10, 'ออกแบบ',                                 7),
  ('other', 20, 'ผลิต/จัดหา',                             14),
  ('other', 30, 'ตรวจรับ',                                3)
on conflict (tool_kind, seq) do nothing;

-- ตรวจหลังรัน:
-- select code, (select count(*) from npi_template_phases p where p.template_id = t.id) phases,
--        (select count(*) from npi_template_deliverables d where d.template_id = t.id) delivs
--   from npi_templates t;                                             -- apqp_aiag 5/36 · toyota_sptt 6/28
-- select count(*) from npi_tooling_step_templates;                    -- 32
-- select count(*) from role_permissions where permission_key like 'npi:%' or permission_key = 'page:/npi';  -- 22
-- select doc_key from doc_forms where doc_key = 'npi_ppap_checklist';
