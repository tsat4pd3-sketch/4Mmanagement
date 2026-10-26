-- ═══════════════════════════════════════════════════════════════════════════
-- ชั้นที่ 3 ของสิทธิ์ ลงชั้น DB — ส่วนที่ 2: **นำร่อง LPA** (คำสั่ง user 2026-10-20)
-- Project: MAIN (ewhdfqwfwofivojtsizn)   ·   ต่อจาก 20261020_rls_scope_net_fn_main.sql
--
-- ผูก `app_can_write_line()` เข้า policy ของ 4 ตาราง LPA — ตารางลูกไต่ขึ้นหาไลน์ที่ใบแม่
-- 🔴 ตัวตัดสินเป็น fail-open (ดูหัวไฟล์ migration ส่วนที่ 1) ⇒ ด่านนี้บล็อกเฉพาะ
--    "รู้ครบแล้วว่าไลน์นี้อยู่คนละส่วนงานกับบ้านของคนเขียน และคนเขียนไม่มีใบผ่านข้ามหน่วย"
--
-- 📊 วัดก่อนลง (ข้อมูลจริง 20/10): lpa_audits 750 + lpa_plans 93 = 843 ใบ
--    · คนเขียนอยู่ส่วนงานเดียวกับไลน์ 837 · ถือ scope:all_units 6 · ไลน์ไล่ส่วนงานไม่ได้ 0
--    ⇒ **ไม่มีใบไหนในประวัติที่ด่านนี้จะบล็อก**
--
-- ⏮️ ย้อนกลับ (คืนของเดิมเป๊ะ — คัดลอกจาก pg_policies ก่อนแก้):
--   drop policy lpa_plans_all on public.lpa_plans;
--   create policy lpa_plans_all on public.lpa_plans for all to authenticated
--     using (has_perm('lpa:manage')) with check (has_perm('lpa:manage'));
--   drop policy lpa_plan_days_all on public.lpa_plan_days;
--   create policy lpa_plan_days_all on public.lpa_plan_days for all to authenticated
--     using (has_perm('lpa:manage')) with check (has_perm('lpa:manage'));
--   drop policy lpa_audits_all on public.lpa_audits;
--   create policy lpa_audits_all on public.lpa_audits for all to authenticated
--     using (has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'))
--     with check (has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'));
--   drop policy lpa_answers_all on public.lpa_audit_answers;
--   create policy lpa_answers_all on public.lpa_audit_answers for all to authenticated
--     using (has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'))
--     with check (has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'));
-- (policy อ่าน `*_read` ไม่แตะ — ดูได้ทั้งโรงงานเหมือนเดิม ตามกฎ "เห็น ≠ แก้ได้")
-- ✅ สถานะ: **apply แล้ว 20/10** (MCP timeout ทุกท่า ⇒ user รันเองใน SQL Editor ของ project "MAIN")
--    ตรวจกลับแล้ว: policy `*_all` ทั้ง 4 ตัวมี app_can_write_line ครบ · `*_read` ไม่ถูกแตะ
--    🔴 หลัง apply เจอว่าตัวตัดสินรุ่นแรกคืน true ให้ทุกคน (array_length('{}',1) = NULL)
--       แก้แล้วด้วย migration `20261020_rls_scope_net_fn_fix_empty_cc_array` — ดูบันทึกท้ายไฟล์ส่วนที่ 1
--    ทดสอบ end-to-end ด้วยสิทธิ์ผู้ใช้จริงหลังแก้: ของตัวเอง/ไม่รู้ไลน์/ไลน์นอกทะเบียน = ผ่าน ·
--       ไลน์ต่างส่วนงาน = บล็อก · คู่ (คนเขียน × ไลน์) ที่เคยเขียนจริง 57 คู่ = ผ่านหมด 0 ถูกบล็อก
-- ═══════════════════════════════════════════════════════════════════════════

-- ── แผนตรวจรายเดือน ──────────────────────────────────────────────────────
drop policy if exists lpa_plans_all on public.lpa_plans;
create policy lpa_plans_all on public.lpa_plans for all to authenticated
  using      (has_perm('lpa:manage') and public.app_can_write_line(line_name))
  with check (has_perm('lpa:manage') and public.app_can_write_line(line_name));

-- ── ช่องรายวันของแผน (ไต่ขึ้นหาไลน์ที่ใบแม่ · ไม่มีแม่ = ตัดสินไม่ได้ ⇒ ผ่าน) ──
drop policy if exists lpa_plan_days_all on public.lpa_plan_days;
create policy lpa_plan_days_all on public.lpa_plan_days for all to authenticated
  using      (has_perm('lpa:manage')
              and public.app_can_write_line((select p.line_name from public.lpa_plans p where p.id = plan_id)))
  with check (has_perm('lpa:manage')
              and public.app_can_write_line((select p.line_name from public.lpa_plans p where p.id = plan_id)));

-- ── ใบผลตรวจ ─────────────────────────────────────────────────────────────
drop policy if exists lpa_audits_all on public.lpa_audits;
create policy lpa_audits_all on public.lpa_audits for all to authenticated
  using      ((has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'))
              and public.app_can_write_line(line_name))
  with check ((has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'))
              and public.app_can_write_line(line_name));

-- ── คำตอบรายข้อของใบตรวจ ─────────────────────────────────────────────────
drop policy if exists lpa_answers_all on public.lpa_audit_answers;
create policy lpa_answers_all on public.lpa_audit_answers for all to authenticated
  using      ((has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'))
              and public.app_can_write_line((select a.line_name from public.lpa_audits a where a.id = audit_id)))
  with check ((has_perm('lpa:record') or has_perm('lpa:manage') or has_perm('lpa:delete'))
              and public.app_can_write_line((select a.line_name from public.lpa_audits a where a.id = audit_id)));


-- ═══ คิวรีเช็คผลหลังรัน (ต้องได้ has_net = true ครบ 4 แถวของ policy `*_all`) ═══
-- select tablename, policyname, cmd,
--        (coalesce(qual,'') like '%app_can_write_line%') as has_net
-- from pg_policies
-- where schemaname='public' and tablename in ('lpa_plans','lpa_plan_days','lpa_audits','lpa_audit_answers')
-- order by tablename, cmd;
