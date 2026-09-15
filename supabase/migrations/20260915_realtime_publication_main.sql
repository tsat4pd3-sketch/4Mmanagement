-- ══════════════════════════════════════════════════════════════════════════════
-- realtime publication — MAIN project (ewhdfqwfwofivojtsizn · ชื่อในจอ "MAIN")
-- 2026-09-15 · audit egress (docs/POLLING-AUDIT-2026-09-15.md)
--
-- 🔴 บั๊กที่เจอ: publication `supabase_realtime` ของ Main มี **แค่ `role_permissions` ตารางเดียว**
--    ทั้งที่โค้ด subscribe `postgres_changes` ไว้ 15 ตาราง
--    ⇒ **กระดิ่งแจ้งเตือน (`notifications`) ไม่เคยเด้งเองเลย** — ต้องรีเฟรชหน้าถึงจะเห็น
--      (`App.jsx` subscribe `notifications` filter user_id — ไม่มี poll สำรอง)
--    ⇒ NPI / QA / LPA / OJT / PE / feedback ก็เหมือนกัน: subscribe ไว้แต่ไม่มีอะไรวิ่งมา
--    เป็นบั๊ก "เงียบสนิท" — ไม่มี error ให้เห็น โค้ดดูถูกทุกบรรทัด เห็นได้จากฝั่ง DB เท่านั้น
--
-- ทำไมเรื่องนี้อยู่ในงานลด egress:
--    realtime = ทางเดียวที่ทำให้จอ "รู้ว่ามีอะไรเปลี่ยน" โดยไม่ต้อง poll ทั้งก้อน
--    วัดจริง 15/09: Realtime Messages ใช้ไป 22,314 จากโควต้า 5,000,000/เดือน (<1%)
--    ขณะที่ Egress 1.578 GB — **realtime แทบไม่มีต้นทุน แต่ poll แพงมาก**
--    ตารางที่ไม่ได้ publish = บังคับให้ต้อง poll อย่างเดียว = จ่ายแพงโดยไม่จำเป็น
--
-- ⚠️ realtime เคารพ RLS — `notifications` มี policy ของตัวเองอยู่แล้ว
--    ผู้ใช้จึงได้รับเฉพาะแถวของตัวเอง (ตรงกับ filter `user_id=eq.<uid>` ในโค้ด)
-- ⚠️ ย้อนกลับได้ทันที: `alter publication supabase_realtime drop table public.<ตาราง>;`
-- ══════════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'notifications',          -- 🔴 กระดิ่งแจ้งเตือน (App.jsx) — ตัวที่พังหนักสุด
    'lpa_audits',
    'meeting_action_items',
    'ojt_trainings',
    'pe_change_requests',
    'qa_capa',
    'qa_customer_claims',
    'qa_fme_obligations',
    'qa_inspection_sheets',
    'qa_ncr',
    'user_feedback',
    'wip_replenish_requests',
    'npi_parts',
    'npi_tasks',
    'npi_change_requests'
  ] loop
    -- idempotent: รันซ้ำได้ ไม่พังถ้ามีอยู่แล้ว / ตารางยังไม่ถูกสร้าง
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t)
       and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t)
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
