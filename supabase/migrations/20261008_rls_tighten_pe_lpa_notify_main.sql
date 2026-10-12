-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn)
-- 🔴 รัด RLS 13 ตารางที่ยัง `for all to authenticated using (true)` (QC audit 2026-10-08)
--
-- ที่มา: ด่านของ 13 ตารางนี้อยู่ที่ **UI ชั้นเดียว** — ใครที่ login แล้วยิง REST ตรง
--        ก็เขียนได้ทั้งตาราง ถึงปุ่มบนจอจะซ่อนอยู่
--        · `telegram_channels` / `notification_rules` → ปิดแจ้งเตือนทั้งโรงงานได้
--          (downtime/4M/PM เงียบหมด) โดยไม่มีใครรู้ว่าใครปิด
--        · `pe_*` 6 ตาราง = เอกสาร IATF ของพาร์ทจริง (PFMEA/Control Plan/Process Flow)
--          ⚠️ คลังกลาง `pe_master_*` ถูกรัดไปแล้ว 16/09 — **ของจริงที่ส่งลูกค้ายังไม่รัด**
--             = ล็อกสลับข้างกับที่ควรเป็น
--        · `lpa_*` 5 ตาราง รวม **ทะเบียนคำถาม** `lpa_questions` (master) + ผลตรวจที่เก็บตามอายุเอกสาร
--
-- ── 🔴 กฎที่ยึดตอนเลือก predicate ──
--   **ห้ามแคบกว่าคีย์ที่เปิดปุ่มบนจอ** — แคบกว่า = "กดแล้วปุ่มเขียวแต่ไม่บันทึก" (RLS ปฏิเสธ
--   UPDATE/DELETE = สำเร็จ 0 แถว ไม่มี error · กฎเหล็ก DB ข้อ 2) ⇒ ใช้ **union ของคีย์ที่ปุ่มใช้จริง**
--   ไล่จากโค้ดแล้ว:
--     PEDocs.jsx:89-90   canEdit=`pe:edit` · canApprove=`pe:approve` → union ทั้ง 6 ตาราง
--     LayerProcessAudit  canManage=`lpa:manage` → lpa_plans · lpa_plan_days · lpa_questions
--                        canRecord=`lpa:record` + canDelete=`lpa:delete` → lpa_audits · lpa_audit_answers
--     NotificationConfig หน้านี้ไม่มี can() เลย (route-gated) → `page:/notification-config`
--                        ซึ่ง RPC 3 ตัวของหน้าเดียวกันใช้อยู่แล้ว
--
-- ── ⚠️ ลำดับสำคัญ — `lpa_*` มี **policy เดียว** (`_all`) ไม่มี SELECT แยก ──
--   รัด `using` ของ `_all` เลยโดยไม่เพิ่ม policy อ่านก่อน = **ปิดการอ่านไปด้วย ทั้งหน้า LPA ดับ**
--   ⇒ ขั้น A เพิ่ม policy `for select using (true)` ให้ทั้ง 5 ตาราง **ก่อน** ขั้น C เสมอ
--   (telegram_channels · notification_rules · pe_* มี `_read`/`_select` แยกอยู่แล้ว — ตรวจกับ
--    `pg_policies` ของจริงแล้ว 08/10 ไม่ใช่เดาจาก migration)
--
-- ── ใครถือคีย์พวกนี้ (วัดจาก role_permissions จริง 08/10) ──
--   pe:edit / pe:approve = admin · dept_admin · engineer · manager
--   lpa:manage = dept_admin · manager · supervisor · lpa:record = +engineer, leader, qa · lpa:delete = dept_admin, manager
--   page:/notification-config = admin · dept_admin · manager · supervisor
--   ⚠️ `has_perm()` ให้ role `admin` ผ่านทุกคีย์อยู่แล้ว (admin bypass ในตัวฟังก์ชัน)
--      ⇒ admin ไม่เสียสิทธิ์ แม้ไม่มีแถวใน role_permissions
--
-- ใช้ `alter policy` ไม่ใช่ drop+create (บทเรียน 05/10 — drop แล้ว create ใหม่
--   มีช่วงที่ตารางไม่มี policy = ปฏิเสธทุกคน ถ้า migration ล้มกลางทาง)
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── ขั้น A · lpa_*: เพิ่ม policy "อ่านได้" ก่อนรัด (ห้ามข้าม — ดูหัวไฟล์) ──────────────
create policy lpa_questions_read     on public.lpa_questions     for select to authenticated using (true);
create policy lpa_plans_read         on public.lpa_plans         for select to authenticated using (true);
create policy lpa_plan_days_read     on public.lpa_plan_days     for select to authenticated using (true);
create policy lpa_audits_read        on public.lpa_audits        for select to authenticated using (true);
create policy lpa_audit_answers_read on public.lpa_audit_answers for select to authenticated using (true);

-- ── ขั้น B · แจ้งเตือน (มี policy อ่านแยกแล้ว) ────────────────────────────────────────
alter policy telegram_channels_write  on public.telegram_channels
  using (has_perm('page:/notification-config')) with check (has_perm('page:/notification-config'));
alter policy notification_rules_write on public.notification_rules
  using (has_perm('page:/notification-config')) with check (has_perm('page:/notification-config'));

-- ── ขั้น C · เอกสาร PE ของพาร์ทจริง (union pe:edit | pe:approve) ─────────────────────
alter policy pe_doc_sets_write      on public.pe_doc_sets
  using (has_perm('pe:edit') or has_perm('pe:approve')) with check (has_perm('pe:edit') or has_perm('pe:approve'));
alter policy pe_processes_write     on public.pe_processes
  using (has_perm('pe:edit') or has_perm('pe:approve')) with check (has_perm('pe:edit') or has_perm('pe:approve'));
alter policy pe_fmea_items_write    on public.pe_fmea_items
  using (has_perm('pe:edit') or has_perm('pe:approve')) with check (has_perm('pe:edit') or has_perm('pe:approve'));
alter policy pe_cp_items_write      on public.pe_cp_items
  using (has_perm('pe:edit') or has_perm('pe:approve')) with check (has_perm('pe:edit') or has_perm('pe:approve'));
alter policy pe_doc_revisions_write on public.pe_doc_revisions
  using (has_perm('pe:edit') or has_perm('pe:approve')) with check (has_perm('pe:edit') or has_perm('pe:approve'));
alter policy pe_change_requests_write on public.pe_change_requests
  using (has_perm('pe:edit') or has_perm('pe:approve')) with check (has_perm('pe:edit') or has_perm('pe:approve'));

-- ── ขั้น D · LPA (predicate ตามคีย์ของปุ่มที่เขียนตารางนั้นจริง) ────────────────────────
-- ทะเบียนคำถาม + แผนตรวจ = แท็บที่เปิดด้วย canManage เท่านั้น
alter policy lpa_questions_all on public.lpa_questions
  using (has_perm('lpa:manage')) with check (has_perm('lpa:manage'));
alter policy lpa_plans_all on public.lpa_plans
  using (has_perm('lpa:manage')) with check (has_perm('lpa:manage'));
alter policy lpa_plan_days_all on public.lpa_plan_days
  using (has_perm('lpa:manage')) with check (has_perm('lpa:manage'));
-- ใบผลตรวจ = canRecord บันทึก · canDelete ลบ · canManage ดูแล ⇒ union 3 คีย์
alter policy lpa_audits_all on public.lpa_audits
  using (has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'))
  with check (has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'));
alter policy lpa_audit_answers_all on public.lpa_audit_answers
  using (has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'))
  with check (has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'));

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ คิวรีเช็คผล (project "MAIN" · ewhdfqwfwofivojtsizn)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) ไม่เหลือ policy เขียนแบบ using(true) ใน 13 ตารางนี้ (คาดหวัง 0 แถว)
--    select tablename, policyname, cmd, qual from pg_policies
--     where schemaname='public' and cmd='ALL' and coalesce(qual,'') = 'true'
--       and tablename in ('telegram_channels','notification_rules','pe_doc_sets','pe_processes',
--         'pe_fmea_items','pe_cp_items','pe_doc_revisions','pe_change_requests',
--         'lpa_questions','lpa_plans','lpa_plan_days','lpa_audits','lpa_audit_answers');
--
-- 2) 🔴 สำคัญสุด — ทุกตารางต้อง **ยังอ่านได้** (ทุกตัวต้องมีแถว cmd=SELECT)
--    select tablename, count(*) filter (where cmd='SELECT') as n_select
--      from pg_policies where schemaname='public'
--       and tablename in ('lpa_questions','lpa_plans','lpa_plan_days','lpa_audits','lpa_audit_answers',
--         'telegram_channels','notification_rules','pe_doc_sets','pe_processes','pe_fmea_items',
--         'pe_cp_items','pe_doc_revisions','pe_change_requests')
--     group by tablename order by n_select, tablename;
--    -- n_select = 0 แม้ตารางเดียว = **rollback ทันที** (จอนั้นอ่านข้อมูลไม่ได้)
--
-- ⏪ ROLLBACK (คืนสภาพเดิมเป๊ะ)
--  begin;
--  alter policy telegram_channels_write    on public.telegram_channels    using (true) with check (true);
--  alter policy notification_rules_write   on public.notification_rules   using (true) with check (true);
--  alter policy pe_doc_sets_write          on public.pe_doc_sets          using (true) with check (true);
--  alter policy pe_processes_write         on public.pe_processes         using (true) with check (true);
--  alter policy pe_fmea_items_write        on public.pe_fmea_items        using (true) with check (true);
--  alter policy pe_cp_items_write          on public.pe_cp_items          using (true) with check (true);
--  alter policy pe_doc_revisions_write     on public.pe_doc_revisions     using (true) with check (true);
--  alter policy pe_change_requests_write   on public.pe_change_requests   using (true) with check (true);
--  alter policy lpa_questions_all          on public.lpa_questions        using (true) with check (true);
--  alter policy lpa_plans_all              on public.lpa_plans            using (true) with check (true);
--  alter policy lpa_plan_days_all          on public.lpa_plan_days        using (true) with check (true);
--  alter policy lpa_audits_all             on public.lpa_audits           using (true) with check (true);
--  alter policy lpa_audit_answers_all      on public.lpa_audit_answers    using (true) with check (true);
--  drop policy if exists lpa_questions_read     on public.lpa_questions;
--  drop policy if exists lpa_plans_read         on public.lpa_plans;
--  drop policy if exists lpa_plan_days_read     on public.lpa_plan_days;
--  drop policy if exists lpa_audits_read        on public.lpa_audits;
--  drop policy if exists lpa_audit_answers_read on public.lpa_audit_answers;
--  commit;
-- ════════════════════════════════════════════════════════════════════════════
