-- ═══ 🗺️ factory_line_regions — ผูก audit (2026-11-11 · คำสั่ง user) ═══════════════════════════
-- โปรเจค: Main (ewhdfqwfwofivojtsizn) — ชื่อใน dropdown จอ Supabase = "MAIN"
--
-- ที่มา: กรอบไลน์ Laser GOR บนผังรวมโรงงาน (/factory-map) จุดมุมหลุดขึ้นไป ~46% ของผัง
--   แล้วบันทึกเงียบ · ตารางนี้มีแค่ created_at + ไม่มี trigger audit ⇒ สืบไม่ได้ว่าใคร/เมื่อไหร่/ค่าเดิมอะไร
--   ขัดกฎ "ตาราง master/editable ต้องมี audit" (docs/modules/traceability-audit-log.md)
--
-- ทำ 2 อย่าง (แพทเทิร์นเดียวกับ 20260908_line_helpers_audit.sql):
--  1) updated_at + trg_set_updated_at
--  2) trg_audit ด้วย fn_audit() ตัวปกติ — เขียนโดยคนล็อกอินเท่านั้น (ลาก/วาด/ลบกรอบ · cascade ชื่อจาก
--     DieLayout/StorageZonePanel) ไม่มี cron/job แตะ ⇒ ไม่ใช่เคสของ fn_audit_manual_only
--   · แถวมี line_name อยู่แล้ว ⇒ ไม่ต้อง snapshot ชื่อ (old_data/new_data อ่านออกเอง)
--
-- ปริมาณ: 24 แถวทั้งตาราง · แก้เฉพาะตอนตั้งผัง ⇒ audit_log โตไม่กี่แถว/เดือน (retention 6 เดือนอยู่แล้ว)
-- Backward-compatible: คอลัมน์ใหม่มี default · client เขียน/อ่านเหมือนเดิม (insert ระบุคอลัมน์เอง)
--
-- Rollback (ไม่แตะพิกัดกรอบที่มีอยู่):
--   drop trigger if exists trg_audit on public.factory_line_regions;
--   drop trigger if exists trg_set_updated_at on public.factory_line_regions;
--   alter table public.factory_line_regions drop column if exists updated_at;

set lock_timeout = '5s';

alter table public.factory_line_regions
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.factory_line_regions;
    create trigger trg_set_updated_at before update on public.factory_line_regions
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.factory_line_regions;
    create trigger trg_audit after insert or update or delete on public.factory_line_regions
      for each row execute function public.fn_audit();
  end if;
end $$;

-- ── เช็คผล ──
-- select tgname from pg_trigger where tgrelid = 'public.factory_line_regions'::regclass and not tgisinternal;
--   ⇒ trg_audit, trg_set_updated_at
-- select action, actor, changed_at, old_data->'points', new_data->'points'
--   from audit_log where table_name = 'factory_line_regions' order by changed_at desc limit 20;
