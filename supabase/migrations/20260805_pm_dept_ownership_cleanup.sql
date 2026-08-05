-- PM: จัดบ้านความเป็นเจ้าของ checklist ตามแผนก (DR project) — 2026-08-05
--
-- อาการที่ user เจอ: ฝ่ายผลิตลงจุดตรวจไว้ 254 จุด แต่ "ไปอยู่หมวด MTN หมด"
-- ขณะที่แท็บ PRODUCTION มี 12 เครื่องแต่ 0 จุดตรวจ → พนักงานผลิตเปิด Daily PM
-- แล้วไม่มีอะไรให้เช็ค (DailyPM.jsx นับเฉพาะ inspections ที่ checklist.department='production')
-- ยืนยันจากข้อมูล: inspections ทั้งระบบ 7 ครั้ง อยู่ใต้ maintenance ทั้งหมด ฝั่ง production = 0
--
-- 2 สาเหตุที่แยกกัน:
--   (1) เงา — getOrCreateChecklist ถูกเรียกตอน "เปิดดู" เครื่อง (PMSetup modal open /
--       PMCheckData เลือกเครื่อง) ไม่ใช่ตอนบันทึก → แค่เปิดดูในแท็บแผนกไหน ก็เกิดแถว
--       checklist ของแผนกนั้นทันที (0 จุดตรวจ) แล้วเครื่องค้างอยู่ในแท็บนั้นตลอดไป
--       → แก้ที่โค้ดแล้วในคอมมิทเดียวกัน (สร้างเมื่อบันทึกจริงเท่านั้น)
--   (2) ของจริงลงผิดแผนก — จุดตรวจที่ตั้งความถี่ "รายวัน" คือ Autonomous Maintenance
--       ของฝ่ายผลิต แต่ถูกลงไว้ใต้ maintenance
--
-- migration นี้ทำ 3 อย่าง (idempotent — รันซ้ำได้):
--   A. ลบ checklist เงา  B. ย้ายชุดรายวัน maintenance → production  C. กันเงาซ้ำด้วย unique index

begin;

-- ─── A. ลบ checklist เงา ───────────────────────────────────────────────────────
-- "เงา" = ไม่มีจุดตรวจ + ไม่เคยถูกใช้ตรวจ + pm_plan ที่ trigger สร้างให้ยังไม่ถูกแตะเลย
-- (pm_plans/jig_checkpoints เป็น FK cascade · inspections เป็น NO ACTION = ถ้าเผลอโดน
--  แถวที่มีประวัติตรวจ DB จะ error ไม่ยอมลบ เป็นตาข่ายกันพลาดอีกชั้น)
-- ข้อมูลจริงตอนเขียน: 24 แถว (production 12 · jig_maintenance 7 · die_maintenance 5)
delete from checklists c
using pm_plans p
where p.checklist_id = c.id
  and c.module = 'mtn'
  and not exists (select 1 from jig_checkpoints cp where cp.checklist_id = c.id)
  and not exists (select 1 from inspections   i  where i.checklist_id  = c.id)
  and p.last_done_at is null
  and p.usage_threshold is null
  and p.interval_days is null
  and p.next_due_date is null
  and p.deferred_to is null
  and coalesce(p.defer_count, 0) = 0
  and p.last_inspection_id is null;

-- เผื่อกรณีไม่มีแถว pm_plans (trigger ยังไม่ทำงาน/ถูกลบ) — เงื่อนไขเดิมแต่ไม่ join
delete from checklists c
where c.module = 'mtn'
  and not exists (select 1 from pm_plans        p  where p.checklist_id = c.id)
  and not exists (select 1 from jig_checkpoints cp where cp.checklist_id = c.id)
  and not exists (select 1 from inspections     i  where i.checklist_id  = c.id);

-- ─── B. ย้ายชุด "รายวัน" ไปเป็นของฝ่ายผลิต ────────────────────────────────────
-- ความถี่รายวัน = operator เช็คเครื่องก่อนเริ่มงาน (Autonomous Maintenance) → เจ้าของคือ production
-- จุดตรวจผูกกับ checklist_id จึงตามไปเองทั้งชุด ไม่ต้องพิมพ์ใหม่
-- ข้อมูลจริงตอนเขียน: 8 เครื่อง / 59 จุดตรวจ (RB-55/56/57, RB-128, BD-04, AUTOLOAD-03, PF-H101, TEST1)
--
-- ⚠️ ผลข้างเคียงที่ตั้งใจ: inspections 6 ครั้งที่เคยบันทึกใต้ checklist เหล่านี้ จะถูกนับเป็น
--    ประวัติของฝ่ายผลิตแทน MTN (ประวัติไม่หาย — ผูกกับ checklist_id เดิม แค่เปลี่ยนเจ้าของ)
--    ยอมรับได้เพราะเนื้องานคือการเช็ครายวันของ operator อยู่แล้ว และทั้งระบบมีแค่ 7 ครั้ง
--
-- guard: ย้ายเฉพาะเครื่องที่ยังไม่มี checklist ฝั่ง production เหลืออยู่ (กันชน unique index ข้อ C)
update checklists c
   set department = 'production'
 where c.module = 'mtn'
   and c.department = 'maintenance'
   and c.frequency = 'daily'
   and not exists (
     select 1 from checklists c2
      where c2.equipment_id = c.equipment_id
        and c2.module = 'mtn'
        and c2.department = 'production'
   );

-- ─── C. กันเงาซ้ำระดับ DB ──────────────────────────────────────────────────────
-- getOrCreateChecklist ใช้ .maybeSingle() ซึ่งจะ error ถ้ามีแถวซ้ำ — เดิมไม่มี unique index
-- กันไว้เลย (ตรวจแล้วไม่มีข้อมูลซ้ำก่อน apply)
create unique index if not exists checklists_equipment_module_dept_uniq
  on checklists (equipment_id, module, department);

commit;
