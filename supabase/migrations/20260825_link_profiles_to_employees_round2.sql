-- ผูกบัญชีเข้ากับฐานพนักงานรอบ 2 — เฉพาะที่ชื่อตรงกัน "ชัดเจนตัวเดียว"
--
-- ทำไมต้องผูก: ตัวกรอง "แผนก" ของระบบแจ้งเตือน (notify_recipients) เดินผ่าน
--   profiles.employee_id -> employees.department
--   บัญชีที่ยังไม่ผูก = ตัวกรองแผนกไม่มีผลกับคนนั้น (ส่วนงานยังใช้ได้ เพราะอ่าน profiles.section ตรงๆ)
--   ก่อนรัน: ผูกแล้ว 14 / 71 บัญชี
--
-- ⚠️ วัดก่อน-หลังแล้วตามกฎ "ต้องไม่มีใครเสียค่าที่เคยมี" (CLAUDE.md · precedent 20260821):
--   ทั้ง 9 บัญชี: line_id ไม่หาย (loses_line = false ทุกคน) · section เท่าเดิมทุกคน
--   ทีมเปลี่ยน 2 คน = การแก้ข้อมูลที่เพี้ยน ไม่ใช่การเสียค่า:
--     - ชญาดา บัวแดง (document_control) : บัญชีไม่เคยตั้งทีม -> ได้ทีม C จากฐานพนักงาน
--       (ทีม C = ไม่หมุนกะ เห็นทุกทีมในไลน์ ตามกฎ seesAllTeams)
--     - โสภณ บุญมี (leader) : บัญชี A -> ฐานพนักงาน B
--       เคสเดียวกับ กรกฎ/ชาญณรงค์ ที่เคยทำให้ "มองไม่เห็นกะตัวเอง" ในหน้าเช็คชื่อ
--   ไม่มี role leader คนไหนที่ line_id เปลี่ยน (line_id คุม scope ของ leader โดยตรง)
--
-- ⚠️ ไม่แตะ profiles.sections[] โดยตั้งใจ — เป็น "ขอบเขตที่ admin ให้" ไม่ใช่ตัวตน
--   ฐานพนักงานไม่มีของเทียบเท่า ย้ายเมื่อไหร่ scope ของ supervisor/qa เพี้ยนทันที
--
-- ⚠️ เงื่อนไข count(*) = 1 บังคับในตัว migration เอง -> ชื่อซ้ำจะไม่ถูกผูกให้ (ห้ามเดา)
-- ⚠️ idempotent: รันซ้ำได้ (where employee_id is null)
--
-- ย้อนกลับ: update profiles set employee_id = null, account_kind = null where id in (...);
--   (ค่า team/line/section เดิมยังอยู่ในตาราง profiles ครบ ไม่ถูกเขียนทับ)

with cand as (
  select p.id as pid,
         (select e.id
            from public.employees e
           where lower(regexp_replace(coalesce(e.name,''), '[[:space:]]+', '', 'g'))
               = lower(regexp_replace(coalesce(p.full_name,''), '[[:space:]]+', '', 'g'))
             and coalesce(p.full_name,'') <> ''
          limit 1) as eid,
         (select count(*)
            from public.employees e
           where lower(regexp_replace(coalesce(e.name,''), '[[:space:]]+', '', 'g'))
               = lower(regexp_replace(coalesce(p.full_name,''), '[[:space:]]+', '', 'g'))
             and coalesce(p.full_name,'') <> '') as hits
    from public.profiles p
   where p.employee_id is null
)
update public.profiles p
   set employee_id  = c.eid,
       account_kind = 'person'
  from cand c
 where p.id = c.pid
   and c.hits = 1
   and c.eid is not null;
