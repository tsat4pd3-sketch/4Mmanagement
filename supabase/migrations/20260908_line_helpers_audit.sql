-- ═══ 🤝 line_helpers — ผูก audit + snapshot ชื่อ (2026-09-08) ═══════════════════════════════
-- โปรเจค: Main (ewhdfqwfwofivojtsizn) — ชื่อใน dropdown จอ Supabase = "MAIN"
--
-- ที่มา: ตาราง line_helpers (ยืมพนักงานข้ามไลน์รายกะ — migration 20260819_line_helpers_main)
--   เก็บแค่ created_by_name และ **แถวถูก DELETE จริงตอนกดคืน** (Checkin.jsx unborrowEmployee)
--   → หลังคืนแล้วสืบไม่ได้เลยว่าใครยืมใคร ไปไลน์ไหน คืนตอนไหน
--   ขัดกฎเหล็ก "ตาราง master/editable ต้องมี audit" (CLAUDE.md + docs/modules/traceability-audit-log.md)
--
-- ทำ 3 อย่าง:
--  1) snapshot ชื่อคน/ชื่อไลน์ลงแถว (emp_name, to_line_name) ด้วย trigger ฝั่ง DB
--     **จำเป็น ไม่ใช่ของแถม** — audit_log เก็บแถวดิบเป็น jsonb และ AuditLogViewer โชว์ค่าดิบ
--     ถ้ามีแต่ uuid จอ /audit-log จะได้ "employee_id: <uuid> → <uuid>" = ตอบคำถามที่ audit ถูกสร้างมาตอบไม่ได้
--     ทำฝั่ง DB (ไม่ให้ client ส่งมา) เพราะ: ทุกจุดที่เขียนได้ฟรีทันที + ดริฟท์ไม่ได้ + ไม่ต้องแก้ Checkin.jsx
--     ⚠️ เป็น snapshot ตามเจตนา — เปลี่ยนชื่อพนักงาน/ไลน์ทีหลัง แถวเก่าไม่ตาม (เหมือน ojt_training_attendees)
--  2) updated_at + trg_set_updated_at (แพทเทิร์นเดียวกับตารางที่ผูก audit ตัวอื่น)
--  3) trg_audit ด้วย fn_audit() ตัวปกติ — เขียนโดยคนล็อกอินเท่านั้น ไม่มี cron/job แตะ
--     จึงไม่ใช่เคสของ fn_audit_manual_only (ที่ไว้กันตารางซึ่ง job เขียนถี่ เช่น employee_skills)
--
-- ปริมาณ (วัดจริงก่อนทำ 2026-09-08): 6 แถว / 2 วัน ≈ 3 แถว/วัน
--   → audit_log โตวันละไม่กี่แถว · retention 6 เดือน (cron purge-audit-log) รับได้สบาย
--
-- Backward-compatible: คอลัมน์ใหม่ nullable + trigger เติมเอง → client เดิม (Checkin/Management/OjtTraining)
--   เขียน/อ่านได้เหมือนเดิมทุกประการ ไม่ต้อง deploy โค้ดพร้อมกัน
--
-- Rollback (ปลอดภัย — ไม่แตะข้อมูลการยืมที่มีอยู่):
--   drop trigger if exists trg_audit on public.line_helpers;
--   drop trigger if exists trg_set_updated_at on public.line_helpers;
--   drop trigger if exists trg_line_helpers_names on public.line_helpers;
--   drop function if exists public.fn_line_helpers_snapshot_names();
--   alter table public.line_helpers
--     drop column if exists emp_name, drop column if exists to_line_name, drop column if exists updated_at;

alter table public.line_helpers
  add column if not exists emp_name     text,          -- snapshot ชื่อพนักงานที่ถูกยืม (ณ ตอนยืม)
  add column if not exists to_line_name text,          -- snapshot ชื่อไลน์ปลายทาง (ณ ตอนยืม)
  add column if not exists updated_at   timestamptz default now();

-- ── 1) snapshot ชื่อ ────────────────────────────────────────────────────────────────────────
-- security definer: อ่าน employees/production_lines ให้ครบทุกแถวโดยไม่ขึ้นกับ RLS ของผู้กด
--   (หัวหน้าไลน์ A ยืมคนไลน์ B — ต้องได้ชื่อคนไลน์ B ด้วย) · เป็นการอ่าน "ชื่อ" อย่างเดียว
-- best-effort: การหาชื่อไม่สำเร็จห้ามทำให้การยืมพัง (หลักการเดียวกับ fn_audit)
create or replace function public.fn_line_helpers_snapshot_names() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    select name into NEW.emp_name     from public.employees        where id = NEW.employee_id;
    select name into NEW.to_line_name from public.production_lines where id = NEW.to_line_id;
  exception when others then
    null;  -- ⚠️ หาชื่อไม่ได้ = ปล่อยว่าง ห้ามล้มการยืม
  end;
  return NEW;
end $$;

-- ── backfill แถวเดิมก่อนติด trigger audit (ไม่งั้น backfill จะกลายเป็น audit ปลอมเต็มไปหมด) ──
update public.line_helpers h set emp_name = e.name
  from public.employees e where e.id = h.employee_id and h.emp_name is null;
update public.line_helpers h set to_line_name = l.name
  from public.production_lines l where l.id = h.to_line_id and h.to_line_name is null;

drop trigger if exists trg_line_helpers_names on public.line_helpers;
create trigger trg_line_helpers_names
  before insert or update of employee_id, to_line_id on public.line_helpers
  for each row execute function public.fn_line_helpers_snapshot_names();

-- ── 2) + 3) updated_at & audit (guard ด้วย pg_proc — ยังไม่มีฟังก์ชันกลาง = ข้ามไป ไม่ล้ม) ──
do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.line_helpers;
    create trigger trg_set_updated_at before update on public.line_helpers
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.line_helpers;
    create trigger trg_audit after insert or update or delete on public.line_helpers
      for each row execute function public.fn_audit();
  end if;
end $$;
