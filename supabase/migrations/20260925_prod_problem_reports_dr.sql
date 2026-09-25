-- ใบรายงานปัญหาการผลิต FM-PD1-019 — เก็บเป็น "บันทึก" ไม่ใช่ใบที่ generate ใหม่ทุกครั้ง
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive ล้วน
--
-- ที่มา: user 2026-09-25 — "ใบบันทึกปัญหา ก็ไม่ได้เก็บข้อมูลหรอ เห็นหัวหน้าต้องปริ้นออกมาเก็บเป็นกระดาษทุกวัน"
--   WI-PD3-069 §7 กำหนดให้ FM-PD1-019 **เก็บ 1 ปี** — แต่ระบบเดิมไม่มีร่องรอยว่าเคยออกใบไหนไปบ้าง
--   ทุกครั้งที่กดพิมพ์คือการ generate ใหม่จากข้อมูลปัจจุบัน ⇒
--     · หัวเรื่อง "ปัญหา :" ที่คนพิมพ์ หายทันทีที่ปิดหน้าต่าง
--     · ไม่รู้ว่าใครออกใบ / ออกเมื่อไหร่ / ออกไปกี่ใบ
--     · ข้อมูลต้นทางถูกแก้ทีหลัง = ใบที่พิมพ์ซ้ำ "ไม่เหมือนใบที่ยื่นไปแล้ว" โดยไม่มีใครรู้
--   ⇒ หน้างานเลยต้องปริ้นกระดาษเก็บเองทุกวัน = paperless ไม่จริง
--
-- ⚠️ snapshot jsonb = เนื้อใบ ณ วันที่ออก (ผลของ buildProblemReport) **ไม่ใช่ pointer ไปข้อมูลดิบ**
--    เอกสารที่ยื่นไปแล้วต้องพิมพ์ซ้ำได้เหมือนเดิมเป๊ะ แม้ downtime/ของเสียต้นทางถูกแก้/ลบทีหลัง
--    (หลักเดียวกับ pe_fmea snapshot ของพาร์ท และ npi_* snapshot แม่แบบ)
--    จอจะเทียบ snapshot กับข้อมูลปัจจุบันแล้ว **บอกบนจอ** เมื่อไม่ตรงกัน — ห้ามพิมพ์ทับเงียบ
--
-- ⚠️ session_id = on delete set null — ใบที่ออกไปแล้วเป็นเอกสารคุณภาพ ห้ามหายตามกะที่ถูกลบ
--    (หลักเดียวกับ quality_bin_records.defect_log_id / from_yellow_id)

create table if not exists public.prod_problem_reports (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null,                 -- เลขที่ใบ running รายเดือน (PR 0001/09-26)
  session_id    uuid references public.production_sessions(id) on delete set null,
  work_date     date not null,
  line_name     text,
  shift         text,
  section       text,                          -- ส่วนผลิต/แผนก ที่พิมพ์บนใบ
  problem_title text,                          -- หัวเรื่อง "ปัญหา :" ที่คนพิมพ์ ('' = ตั้งใจเว้นว่าง)
  snapshot      jsonb not null default '{}'::jsonb,  -- เนื้อใบ ณ วันที่ออก (serializeReport)
  min_minutes   integer,                       -- เกณฑ์ downtime ที่ใช้ตอนออกใบ (PROBLEM_MIN_MINUTES)
  issued_by     text,                          -- ผู้ออกใบ (snapshot ชื่อ — ใบเก่าต้องอ่านออกแม้คนลาออก)
  issued_by_uid uuid,
  issued_at     timestamptz not null default now(),
  reprint_count integer not null default 0,    -- พิมพ์ซ้ำกี่ครั้ง (ใบเดิม ไม่ใช่ใบใหม่)
  last_printed_at timestamptz,
  note          text,
  is_active     boolean not null default true, -- ยกเลิกใบ = soft delete (บันทึกคุณภาพ ห้ามลบจริง)
  updated_by_name text,
  updated_by_uid  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- เลขที่ใบห้ามซ้ำในใบที่ยังใช้อยู่ (ใบที่ยกเลิกแล้วปล่อยเลขค้างไว้ ห้ามเอาเลขกลับมาใช้ซ้ำ)
create unique index if not exists ppr_doc_no_uniq on public.prod_problem_reports (doc_no) where is_active;
create index if not exists ppr_session_idx on public.prod_problem_reports (session_id) where session_id is not null;
create index if not exists ppr_date_idx    on public.prod_problem_reports (work_date desc);
create index if not exists ppr_line_idx    on public.prod_problem_reports (line_name);

alter table public.prod_problem_reports enable row level security;
-- ฝั่ง DR client เป็น anon เสมอ (กฎเหล็ก CLAUDE.md) — ห้ามตั้ง TO authenticated
-- ครบทุก cmd ที่ client ใช้: insert (ออกใบ) · update (นับพิมพ์ซ้ำ/ยกเลิก) · select
drop policy if exists ppr_all on public.prod_problem_reports;
create policy ppr_all on public.prod_problem_reports for all using (true) with check (true);

drop trigger if exists trg_set_updated_at on public.prod_problem_reports;
create trigger trg_set_updated_at before update on public.prod_problem_reports
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_audit on public.prod_problem_reports;
create trigger trg_audit after insert or update or delete on public.prod_problem_reports
  for each row execute function public.fn_audit();

-- Rollback:
--   drop table public.prod_problem_reports;
