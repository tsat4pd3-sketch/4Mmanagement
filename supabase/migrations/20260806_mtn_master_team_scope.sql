-- แยก "มุมมองของแต่ละทีมช่าง" ออกจาก "ของกลาง" — 4 ทีม (MTN / JIG MTN / DIE MTN / PRODUCTION)
-- Project: DR (eyhclzkifitbhbljgoav) · 2026-08-06
--
-- หลักการ (คำสั่ง user): ตัวตนของอุปกรณ์ = ของกลางชุดเดียว ทุกทีมอ้างอิงตรงกัน
--   → machines.machine_no / machines.id / jigs.id / ชื่อเครื่อง  = ห้ามแตกตามทีม
-- แต่ "รายละเอียดอื่น" เป็นมุมมองเฉพาะทีม ต้องแยก:
--   JIG MTN มอง Locator/Clamp/Gripper ชำรุด · DIE MTN มองแม่พิมพ์บิ่น/สึก · MTN มองมอเตอร์/อินเวอร์เตอร์
--   ใช้ลิสต์รวมกันแล้วแต่ละทีมต้องเลื่อนผ่านของทีมอื่นทุกครั้ง (เจอจริงในหน้า ⚙️ ข้อมูลหลัก)
--
-- วิธี: เพิ่มคอลัมน์ `team` แบบ nullable — **null = ใช้ร่วมทุกทีม (common)**
--   pattern เดียวกับ `lpa_questions.line_name` (null = ข้อ common ของทุกไลน์) ที่ใช้อยู่แล้วในระบบ
--   ⚠️ backfill เป็น null ทั้งหมดโดยตั้งใจ = พฤติกรรมเดิมเป๊ะ (ทุกทีมยังเห็นทุกแถวเหมือนก่อน apply)
--      การไล่ติ๊กว่าแถวไหนเป็นของทีมไหน เป็นงาน "จัดข้อมูล" ทำผ่าน UI ทีหลัง ไม่เดาให้ในนี้
--
-- ค่า team ใช้ mtn_teams.key (maintenance/jig_maintenance/die_maintenance/production)
--   — encoding เดียวกับ checklists.department และ mtn_spare_parts.team
--   (ฝั่ง mtn_orders.mtn_dept ยังเป็น label "JIG MTN" อยู่ · โยงกันด้วย mtn_teams.dept_name เหมือนเดิม)

alter table mtn_problem_types       add column if not exists team text;
alter table mtn_item_types          add column if not exists team text;
alter table mtn_repair_types        add column if not exists team text;
alter table mtn_spare_categories    add column if not exists team text;
alter table pm_checkpoint_categories add column if not exists team text;
alter table pm_checking_methods      add column if not exists team text;

create index if not exists mtn_problem_types_team_idx        on mtn_problem_types (team);
create index if not exists mtn_item_types_team_idx           on mtn_item_types (team);
create index if not exists mtn_repair_types_team_idx         on mtn_repair_types (team);
create index if not exists mtn_spare_categories_team_idx     on mtn_spare_categories (team);
create index if not exists pm_checkpoint_categories_team_idx on pm_checkpoint_categories (team);
create index if not exists pm_checking_methods_team_idx      on pm_checking_methods (team);

comment on column mtn_problem_types.team is
  'mtn_teams.key ของทีมที่ใช้ลักษณะปัญหานี้ · null = ใช้ร่วมทุกทีม';
comment on column mtn_item_types.team is
  'mtn_teams.key · null = ใช้ร่วมทุกทีม · ใช้เดาทีมผู้รับผิดชอบตอนแจ้งซ่อมแทนการเดาจากชื่อ (teamForItem)';
comment on column mtn_repair_types.team is
  'mtn_teams.key · null = ใช้ร่วมทุกทีม (BM/CM/PM ปกติเป็นสากล)';
comment on column mtn_spare_categories.team is
  'mtn_teams.key · null = ใช้ร่วมทุกทีม (เช่น LP=Locating Pin เป็นของ JIG โดยเฉพาะ)';

-- Rollback:
--   alter table mtn_problem_types drop column team;  (ทำซ้ำกับอีก 5 ตาราง)
--   โค้ดฝั่งเว็บอ่านแบบ tolerant อยู่แล้ว — ยังไม่ apply ก็ไม่พัง (ทุกแถวถือเป็น common)
