-- cost_centers: เตรียมรับหลายโรงงาน/หลายบริษัท (2026-10-22)  [Main · ewhdfqwfwofivojtsizn]
-- เหตุผล (วัดจากไฟล์ Activity Rate 2025 ของบัญชี ครบทุก plant):
--   · เลข 6 หลักท้ายซ้ำข้ามโรงงาน — '661101' โผล่ใน TSESA/TSGP/TCT/TSAT-P4/TSBP/TSAP
--     ⇒ unique ต้องใช้ 10 หลักเต็ม และต้องรู้ว่าแถวไหนของโรงงานไหน
--   · Plant Code ไม่ตรงกับต้นรหัส CC — TSAP plant 2900 แต่ CC 2910… · TCT plant 1611/1612/1613 แต่ CC 1610990200
--     ⇒ เดา plant จากรหัสไม่ได้ ต้องเก็บจริง
--   · หลักที่ 5 (เลเวล) เชื่อได้เฉพาะเครือ TSAT (ยืนยันด้วย ORG-015) — TSIS '1520575100' = ส่วน
--     แต่หลักเป็น 5 · TSRA '1820661901' = ส่วน แต่หลักเป็น 6 ⇒ ข้ามบริษัทพัง ต้องเก็บเป็นคอลัมน์
-- 🔴 ทุกคอลัมน์ nullable ไม่มี constraint ใหม่ ⇒ ของเดิมไม่พัง
-- ย้อนกลับ: alter table public.cost_centers drop column company, drop column plant_code, drop column level;
alter table public.cost_centers
  add column if not exists company    text,
  add column if not exists plant_code text,
  add column if not exists level      smallint;

comment on column public.cost_centers.company    is 'บริษัทในเครือ เช่น TSAT/TSLA/TSGP — ว่าง = ยังไม่ระบุ';
comment on column public.cost_centers.plant_code is 'รหัสโรงงานจากไฟล์บัญชี (TSAT P4 = 2140) 🔴 ห้ามแกะจากต้นรหัส CC';
comment on column public.cost_centers.level      is '3=ฝ่าย 4=ส่วน 5=แผนก 6=กลุ่ม 🔴 เก็บจริง ห้ามแกะจากหลักที่ 5 ของรหัส';

-- backfill: ของที่มีอยู่ทั้งหมดเป็น TSAT Plant 4
update public.cost_centers set company = 'TSAT' where company is null;
update public.cost_centers set plant_code = '2140' where plant_code is null and code like '2140%';

-- backfill level จาก "ชั้นที่ผังใช้จริง" เท่านั้น (ไม่ได้แกะจากตัวเลข) — ที่จับคู่ไม่ได้ปล่อย null
update public.cost_centers c
set level = case n.kind when 'section' then 4 when 'department' then 5 when 'line' then 6 end
from (
  select distinct on (cost_center) cost_center, kind
  from public.org_nodes
  where coalesce(cost_center,'') <> '' and kind in ('section','department','line')
  order by cost_center, case kind when 'section' then 1 when 'department' then 2 else 3 end
) n
where n.cost_center = c.code and c.level is null;
