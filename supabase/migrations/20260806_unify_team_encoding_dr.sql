-- รวม encoding ของ "ทีมช่าง" ให้เหลือแบบเดียว: เก็บ key เสมอ (DR project) — 2026-08-06
--
-- ปัญหา: ระบบช่างเก็บทีมด้วย 2 แบบปนกัน
--   ชื่อ (label) : mtn_orders.mtn_dept, mtn_technicians.dept, mtn_labor_rates.dept   = 'JIG MTN'
--   รหัส (key)  : checklists.department, และคอลัมน์ team ที่เพิ่งเพิ่ม               = 'jig_maintenance'
-- ทำให้ join/เทียบข้ามฝั่งไม่ได้ตรงๆ ต้องพึ่ง normalize ในโค้ดตลอด
--
-- หลักที่ยึด (เหมือน role / process_type / line_type ทั้งระบบ): **เก็บรหัส แสดงชื่อ**
--   ชื่อทีมเปลี่ยนได้ (เคยเปลี่ยน PRODUCTION → "AM (ผลิตตรวจเอง)") ถ้าเก็บชื่อ ข้อมูลเก่าจะกำพร้าทันที
--
-- ปลอดภัย: โค้ดฝั่งเว็บ + edge function normalize ทั้ง 2 แบบอยู่แล้ว (teamKeyOf / teamKey)
--          จึงอ่านได้ทั้งก่อนและหลังรัน ไม่มีช่วงที่ระบบพัง
-- idempotent: แปลงเฉพาะแถวที่ยังเป็นชื่อ · รันซ้ำไม่เปลี่ยนอะไร

-- map ชื่อ → รหัส อ่านจากตาราง mtn_teams (source of truth) ผ่าน view ชั่วคราว — ไม่ hardcode
create or replace view _team_map as
select lower(trim(dept_name)) as name_low, key from mtn_teams where dept_name is not null;

-- 1) ใบแจ้งซ่อม MO
update mtn_orders o set mtn_dept = m.key
from _team_map m
where o.mtn_dept is not null and lower(trim(o.mtn_dept)) = m.name_low and o.mtn_dept <> m.key;

-- ตีกลับจากทีมไหน (สืบประวัติ)
update mtn_orders o set returned_from_dept = m.key
from _team_map m
where o.returned_from_dept is not null and lower(trim(o.returned_from_dept)) = m.name_low and o.returned_from_dept <> m.key;

-- 2) ช่างเฉพาะกิจ (แถวเก่าเก็บเป็นประวัติ — แปลงด้วยเพื่อให้จัดกลุ่มตามทีมถูก)
update mtn_technicians t set dept = m.key
from _team_map m
where t.dept is not null and lower(trim(t.dept)) = m.name_low and t.dept <> m.key;

-- 3) ค่าแรงมาตรฐาน (ตอนนี้ยังไม่มีแถว — กันไว้เผื่อมีคนกรอกก่อน deploy)
update mtn_labor_rates r set dept = m.key
from _team_map m
where r.dept is not null and lower(trim(r.dept)) = m.name_low and r.dept <> m.key;

-- 4) คอลัมน์ team ที่เพิ่งเพิ่ม (ตอนนี้ null ทั้งหมด — เผื่อมีคนติ๊กเป็นชื่อไปแล้วระหว่างรอ migration)
update mtn_spare_parts       x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;
update mtn_spare_categories  x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;
update mtn_problem_types     x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;
update mtn_item_types        x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;
update mtn_repair_types      x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;
update mtn_rack_maps         x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;
update pm_checkpoint_categories x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;
update pm_checking_methods      x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;
update pm_coordination_tasks    x set team = m.key from _team_map m where x.team is not null and lower(trim(x.team)) = m.name_low and x.team <> m.key;

drop view _team_map;

-- ตรวจหลังรัน: ต้องไม่เหลือค่าที่ยังเป็นชื่อ
--   select distinct mtn_dept from mtn_orders;          -- ควรเห็นเฉพาะ maintenance/jig_maintenance/...
--   select distinct dept     from mtn_technicians;
