-- ════════════════════════════════════════════════════════════════════════════
-- ลบอุปกรณ์ทดสอบ "TEST1 - 99" (ไลน์ test) ออกจากระบบ PM  —  DR project
--   Product DB / eyhclzkifitbhbljgoav        (คำสั่ง user 2026-09-09)
--
-- เหตุผล: มันยิง Telegram "🔴 ยังไม่ได้ทำ PM — เกินกำหนดมาแล้ว N วัน" ทุกสัปดาห์
--   ตั้งแต่ 11 ก.ค. (ครบกำหนด 23 ก.ค. = เกิน 48 วัน) รวม 11 ครั้ง = 31% ของการเตือน
--   PM ทั้งหมดในระบบ — ของปลอมกลบของจริง คนเริ่มไม่อ่านข้อความเตือน
--   (บทเรียนเดียวกับ 4M อัตโนมัติ 323 ใบค้างคิวจนกลบใบจริง 19 ใบ)
--
-- วัดก่อนลบแล้ว — ไม่มีอะไรของจริงอ้างถึง:
--   downtime_logs machine_no='TEST1' = 0 · mtn_orders = 0 · equipment_die = 0
--   pm_daily_alerts ไลน์ 'test' = 0 · pm_plan_deferrals = 0
--   machines row 'TEST1' is_active=false อยู่แล้ว (ไม่โผล่ dropdown ไหน)
-- ของที่จะหายไป: jigs 1 · checklists 1 · jig_checkpoints 4 · inspections 6
--   (ทั้ง 6 เป็น pending → คิว "รออนุมัติ" เหลือของจริง 8 ใบ) · inspection_results 24
--   · pm_plans 1 · pm_plan_reminders 11 · jig_images 8 · pm_daily_line_targets 1
--
-- ⚠️ ย้อนได้: สำรองทุกแถวลงตาราง _bak_* ก่อนลบ (insert กลับได้ตามลำดับ FK ท้ายไฟล์)
-- ⚠️ ไฟล์รูป 8 ไฟล์ใน bucket `jig-photos` (jigs/e65ca38f-.../frame-*.jpeg) จะกลายเป็น
--    กำพร้า — edge function `cleanup-orphan-photos` เก็บกวาดเองตามรอบ ไม่ต้องลบมือ
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_jig  uuid := 'e65ca38f-0309-437f-9ea1-1c32380133cd';   -- jigs."TEST1 - 99"
  v_cls  uuid[];
  v_plan uuid[];
  v_insp uuid[];
begin
  -- กันรันซ้ำ / รันผิด project: ไม่มีแถวนี้ = ไม่ต้องทำอะไร
  if not exists (select 1 from jigs where id = v_jig and name = 'TEST1 - 99') then
    raise notice 'ไม่พบ jigs "TEST1 - 99" (id %) — ข้าม (อาจลบไปแล้ว)', v_jig;
    return;
  end if;

  select coalesce(array_agg(id), '{}') into v_cls  from checklists where equipment_id = v_jig;
  select coalesce(array_agg(id), '{}') into v_plan from pm_plans   where checklist_id = any(v_cls);
  select coalesce(array_agg(id), '{}') into v_insp from inspections where checklist_id = any(v_cls);

  -- ── สำรองก่อนลบ (โครงตารางตามต้นฉบับ + วันที่ลบ) ──────────────────────────
  create table if not exists jigs_bak_test1_20260909              as select *, now() as _purged_at from jigs             where false;
  create table if not exists checklists_bak_test1_20260909        as select *, now() as _purged_at from checklists       where false;
  create table if not exists jig_checkpoints_bak_test1_20260909   as select *, now() as _purged_at from jig_checkpoints  where false;
  create table if not exists inspections_bak_test1_20260909       as select *, now() as _purged_at from inspections      where false;
  create table if not exists inspection_results_bak_test1_20260909 as select *, now() as _purged_at from inspection_results where false;
  create table if not exists pm_plans_bak_test1_20260909          as select *, now() as _purged_at from pm_plans         where false;
  create table if not exists pm_plan_reminders_bak_test1_20260909 as select *, now() as _purged_at from pm_plan_reminders where false;
  create table if not exists jig_images_bak_test1_20260909        as select *, now() as _purged_at from jig_images       where false;
  create table if not exists pm_daily_line_targets_bak_test1_20260909 as select *, now() as _purged_at from pm_daily_line_targets where false;

  insert into inspection_results_bak_test1_20260909    select *, now() from inspection_results    where inspection_id = any(v_insp);
  insert into inspections_bak_test1_20260909           select *, now() from inspections           where id = any(v_insp);
  insert into jig_checkpoints_bak_test1_20260909       select *, now() from jig_checkpoints       where jig_id = v_jig or checklist_id = any(v_cls);
  insert into pm_plan_reminders_bak_test1_20260909     select *, now() from pm_plan_reminders     where plan_id = any(v_plan);
  insert into pm_plans_bak_test1_20260909              select *, now() from pm_plans              where id = any(v_plan);
  insert into checklists_bak_test1_20260909            select *, now() from checklists            where id = any(v_cls);
  insert into jig_images_bak_test1_20260909            select *, now() from jig_images            where jig_id = v_jig;
  insert into pm_daily_line_targets_bak_test1_20260909 select *, now() from pm_daily_line_targets where jig_id = v_jig;
  insert into jigs_bak_test1_20260909                  select *, now() from jigs                  where id = v_jig;

  -- ── ลบตามลำดับ FK (ลูกก่อนแม่ — ไม่พึ่ง cascade เพื่อให้เห็นจำนวนแถวจริง) ──
  delete from inspection_results    where inspection_id = any(v_insp);
  delete from inspections           where id = any(v_insp);
  delete from jig_checkpoints       where jig_id = v_jig or checklist_id = any(v_cls);
  delete from pm_plan_reminders     where plan_id = any(v_plan);
  delete from pm_plans              where id = any(v_plan);
  delete from checklists            where id = any(v_cls);
  delete from jig_images            where jig_id = v_jig;
  delete from pm_daily_line_targets where jig_id = v_jig;
  delete from jigs                  where id = v_jig;

  -- แถวใน machines ('TEST1' ไลน์ test) ปิด is_active ไปแล้ว ไม่โผล่ที่ไหนและไม่ยิงเตือน
  -- → ปล่อยไว้ ไม่ลบ (กันกระทบ FK/ประวัติที่อาจอ้างถึงในอนาคต)
end $$;

commit;

-- ── เช็คผลหลังรัน (ต้องได้ 0 ทุกช่อง) ───────────────────────────────────────
-- select
--  (select count(*) from jigs where name='TEST1 - 99')                                  as jig_left,
--  (select count(*) from pm_plans p join checklists c on c.id=p.checklist_id
--     where c.equipment_id='e65ca38f-0309-437f-9ea1-1c32380133cd')                      as plan_left,
--  (select count(*) from inspections where approval_status='pending')                   as pending_now;  -- เหลือของจริง 8

-- ── วิธีย้อน (insert กลับตามลำดับแม่→ลูก แล้วค่อย drop ตาราง _bak) ───────────
-- insert into jigs                  select (r).* from (select jigs_bak_test1_20260909 r from jigs_bak_test1_20260909) s;
--   … ทำแบบเดียวกันกับ checklists → pm_plans → jig_checkpoints → inspections
--     → inspection_results → pm_plan_reminders → jig_images → pm_daily_line_targets
--   (ตัด column _purged_at ออกก่อน insert — ระบุชื่อคอลัมน์ตามต้นฉบับ)
