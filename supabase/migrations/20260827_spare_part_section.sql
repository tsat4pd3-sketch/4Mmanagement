-- คลังอะไหล่แยกตาม "หน่วยงานเจ้าของ" (section) — Project: DR (eyhclzkifitbhbljgoav) · 2026-08-27
--
-- ที่มา (feedback หน้างาน · ณัฐพล สีพิมขัด 25/08 · หน้า /mtn-repair?tab=spare):
--   "แยกคลังอะไหล่ Production เป็น Production 1–4 เนื่องจากแต่ละทีมมีพื้นที่จัดเก็บและผู้รับผิดชอบ
--    แตกต่างกัน รวมถึงมีการใช้ Mat. No. ซ้ำกัน เพื่อให้ควบคุม Stock และระบุผู้รับผิดชอบได้ชัดเจน"
--
-- ⚠️⚠️ ทำไมไม่แตก `mtn_teams` เป็น production_1..4 (ทางที่ดูตรงตัวที่สุดแต่พังเงียบ)
--   key 'production' ถูกอ้างเป็นค่าคงที่ในโค้ดอีก 6 จุดที่ไม่เกี่ยวกับคลังอะไหล่:
--     MTN_TEAMS · SEE_ALL_TEAMS · teamKindOf fallback (am/pm) ·
--     checklists.department='production' (ทะเบียน AM ตรวจทุกต้นกะ — DailyPM/PMCheckData/OrderTrace/pmDailyAlarm) ·
--     mtn_mo_seq/mo_code (เลขรัน MO ต่อทีม) · mtn_orders.mtn_dept ของใบเก่าทั้งหมด
--   → ตรงกับกฎเหล็กที่ใช้กับ user_role มาแล้ว 3 ครั้ง: "เจอแกนใหม่ → เพิ่ม attribute ห้ามเพิ่ม role/ทีม"
--   แกนที่ขาดคือ "หน่วยงานย่อยที่เป็นเจ้าของของชิ้นนี้" ไม่ใช่ "ทีมช่างอีก 4 ทีม"
--   รายละเอียดเต็ม + จุดที่จะพังถ้าแตกทีม → หัวไฟล์ src/utils/spareSection.js
--
-- additive ล้วน · nullable · ไม่มี default → **ไม่มีใครเสียอะไรตอน deploy**
--   null/ว่าง = ของกลางของทีมนั้น (ทุกหน่วยงานเห็น+ใช้ร่วม) — pattern เดียวกับ mtn_*.team null = common
--
-- rollback: alter table mtn_spare_parts drop column section;
--           alter table mtn_rack_maps  drop column section;
--   (โค้ดฝั่งเว็บอ่านแบบ tolerant อยู่แล้ว — คอลัมน์หายไป = กลับไปคลังรวมเหมือนก่อนหน้า)

-- ── 1) คอลัมน์ ──────────────────────────────────────────────────────────────
--   ค่า = org_nodes.code ของ kind='section' (PD1..PD4 · Planning&Store ฯลฯ)
--   ไม่ทำ FK เพราะ org_nodes อยู่ Main project (ข้าม project ทำ FK ไม่ได้) — เทียบด้วยข้อความ
--   เหมือน pm_facility_areas.name ↔ factory_line_regions.line_name
alter table mtn_spare_parts add column if not exists section text;
alter table mtn_rack_maps   add column if not exists section text;

create index if not exists mtn_spare_parts_section_idx on mtn_spare_parts (section);
create index if not exists mtn_rack_maps_section_idx   on mtn_rack_maps (section);

comment on column mtn_spare_parts.section is
  'หน่วยงานเจ้าของอะไหล่ = org_nodes.code (kind=section) · null = ของกลางของทีม (ทุกหน่วยงานใช้ร่วม)';
comment on column mtn_rack_maps.section is
  'หน่วยงานเจ้าของผังชั้นวาง = org_nodes.code (kind=section) · null = ของกลางของทีม';

-- ── 2) backfill เฉพาะที่ "พิสูจน์ได้" ─────────────────────────────────────────
--   หน้างานตั้งรหัสภายในเองเป็น `PD3-SP-UPE-001` มาก่อนที่ระบบจะมีแกนนี้ (87/87 แถวขึ้นต้น PD3)
--   → prefix ตัวแรกที่ตรงกับรหัสส่วนงานจริง = หลักฐานพอ · prefix อื่น (SP-001/MTN-01) **ไม่แตะ**
--   ⚠️ ห้าม backfill ด้วยการเดาจาก team/ผู้กรอก — เดาผิดแล้วสต็อกไปโผล่ผิดหน่วยงาน ย้อนยาก
--   ⚠️ รายชื่อส่วนงานอยู่ Main (org_nodes) — ฝั่ง DR join ไม่ได้ จึงระบุรหัสฝ่ายผลิตตรงๆ
--      (ชุดนี้คือ section ที่ division='production' ณ วันที่เขียน: PD1-PD4)
--      หน่วยงานอื่นที่เพิ่มทีหลังให้ตั้งค่าเองจากหน้าคลังอะไหล่ ไม่ต้องแก้ migration นี้
update mtn_spare_parts
   set section = upper(split_part(code, '-', 1))
 where section is null
   and code is not null
   and upper(split_part(code, '-', 1)) in ('PD1', 'PD2', 'PD3', 'PD4');

-- ตรวจผล (รันแยกหลัง apply):
--   select coalesce(section,'(ของกลาง)') s, count(*) from mtn_spare_parts group by 1 order by 2 desc;
