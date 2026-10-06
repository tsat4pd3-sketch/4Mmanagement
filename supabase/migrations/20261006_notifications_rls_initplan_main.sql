-- MAIN (ewhdfqwfwofivojtsizn) · DB audit 05/10 set A2 · คำสั่ง user 06/10 "ทำ A ได้"
-- กระดิ่ง: policy เรียก auth.uid() ทุกแถว (advisor auth_rls_initplan) ⇒ คิวรีกระดิ่ง ~550 ms
-- `(select auth.uid())` = ค่าเดียวกัน คำนวณครั้งเดียวต่อคิวรี — ใครเห็นอะไร "ไม่เปลี่ยน"
-- rollback:
--   alter policy notifications_select_own on public.notifications using (auth.uid() = user_id);
--   alter policy notifications_update_own on public.notifications using (auth.uid() = user_id);
--   select cron.alter_job(<jobid ของ qa-fme-scan>, active := true);
alter policy notifications_select_own on public.notifications using ((select auth.uid()) = user_id);
alter policy notifications_update_own on public.notifications using ((select auth.uid()) = user_id);

-- qa-fme-scan ยิงทุก 5 นาที (2,016 ครั้ง/สัปดาห์) แต่ทุกครั้งคืน skipped เพราะ qa_fme_config.is_enabled = false
-- ⇒ พักไว้จนกว่า QA จะเปิดใช้ (เปิดฟีเจอร์ FME เมื่อไหร่ = เปิด job นี้คืนพร้อมกัน)
select cron.alter_job(j.jobid, active := false) from cron.job j where j.jobname = 'qa-fme-scan';
