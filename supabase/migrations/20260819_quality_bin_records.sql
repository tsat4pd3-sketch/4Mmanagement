-- ถังเหลือง (ชิ้นงานต้องสงสัย) + ถังแดง (ชิ้นงานเสีย) — paperless
-- ★ Apply on DR project (eyhclzkifitbhbljgoav) — additive
-- ที่มา: feedback หน้างาน 2026-08-19 — หัวหน้าส่งฟอร์มกระดาษ 2 ใบมาให้ทำเป็น export
--
-- ⚠️ ทำไมตารางเดียวไม่แตก 2 ตาราง: ถังเหลือง→ถังแดง เป็น "สายงานเดียวกัน"
--    (หมายเหตุท้ายฟอร์มเหลืองเขียนไว้เอง: ซ่อมแล้ว NG → ติดแท็กแดง (Tag Reject)
--     → ลงบันทึกเอกสารชิ้นงานเสีย → วางในตะกร้าสีแดง)
--    แตก 2 ตารางจะสืบไม่ได้ว่าชิ้นในถังแดงมาจากใบเหลืองใบไหน
--
-- ⚠️ ตารางนี้อยู่ใน DR_AUDIT_TABLES (src/supabaseClient.js) → wrapper ฝัง updated_by_name ให้เอง
--    เพิ่มตาราง DR ใหม่เข้า audit ต้องเติมทั้ง 2 ที่ให้ตรงกัน (คอลัมน์ที่นี่ + ลิสต์ในโค้ด)
--
-- ⚠️ ชื่อคน (ผู้แจ้ง/QA/ผู้ซ่อม/ผู้ทำลาย) เก็บเป็น "ข้อความ" ไม่ใช่ FK โดยตั้งใจ
--    — pattern snapshot เดียวกับ ojt_training_attendees.emp_name / lpa_audit_answers.question_text
--    ใบเก่าต้องอ่านออกเหมือนวันที่บันทึก แม้คนนั้นลาออก/เปลี่ยนชื่อ

create table if not exists public.quality_bin_records (
  id            uuid primary key default gen_random_uuid(),
  bin           text not null check (bin in ('yellow', 'red')),
  work_date     date not null,                 -- วันที่ลงถัง
  line_name     text,                          -- ไลน์การผลิต
  mat_no        text,
  part_name     text,
  part_no       text,                          -- รหัสชิ้นงาน (เลขลูกค้า)
  qty           numeric not null,              -- เหลือง = จำนวนงานรอพิจารณา · แดง = จำนวนชิ้นงานเสีย
  cause         text,                          -- สาเหตุ
  reported_by   text,                          -- ผู้แจ้ง (พนักงาน)
  qa_by         text,                          -- ผู้ตรวจสอบ (QA)

  -- ── เฉพาะถังเหลือง (ชิ้นงานต้องสงสัย → ซ่อม → ตัดสิน OK/NG) ──
  repair_date   date,                          -- วันที่ซ่อมชิ้นงาน
  repair_detail text,                          -- รายละเอียดการซ่อมชิ้นงาน
  repair_by     text,                          -- ผู้ดำเนินการซ่อม
  qty_ok        numeric,                       -- ผลการซ่อม OK (ชิ้น)
  qty_ng        numeric,                       -- ผลการซ่อม NG (ชิ้น)
  return_date   date,                          -- วันที่นำกลับเข้ากระบวนการ

  -- ── เฉพาะถังแดง (ของเสีย → ขออนุมัติทำลายตาม DOA) ──
  disposed_by       text,                      -- ผู้กำจัดทำลาย
  disposed_position text,                      -- ตำแหน่ง (ระดับหัวหน้ากลุ่ม-วิศวกรขึ้นไป)

  -- ── โยงสายงาน ──
  from_yellow_id uuid references public.quality_bin_records(id) on delete set null,
                                               -- แถวถังแดงที่เกิดจากใบเหลืองซ่อมแล้ว NG
  scrap_report_id uuid,                        -- ผูก scrap_reports ตอนทำใบขออนุมัติทำลาย
  note          text,
  is_active     boolean not null default true,
  updated_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists qbin_bin_date_idx on public.quality_bin_records (bin, work_date desc);
create index if not exists qbin_line_idx     on public.quality_bin_records (line_name);
create index if not exists qbin_mat_idx      on public.quality_bin_records (mat_no);
create index if not exists qbin_from_idx     on public.quality_bin_records (from_yellow_id)
  where from_yellow_id is not null;

alter table public.quality_bin_records enable row level security;
-- ฝั่ง DR client เป็น anon เสมอ (กฎเหล็ก CLAUDE.md) — ห้ามตั้ง TO authenticated
drop policy if exists qbin_all on public.quality_bin_records;
create policy qbin_all on public.quality_bin_records for all using (true) with check (true);

drop trigger if exists trg_set_updated_at on public.quality_bin_records;
create trigger trg_set_updated_at before update on public.quality_bin_records
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_audit on public.quality_bin_records;
create trigger trg_audit after insert or update or delete on public.quality_bin_records
  for each row execute function public.fn_audit();

-- Rollback:
--   drop table public.quality_bin_records;
