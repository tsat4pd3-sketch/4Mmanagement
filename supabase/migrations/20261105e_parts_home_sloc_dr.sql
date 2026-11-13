-- 🏠 ที่จัดเก็บหลักของพาร์ท (2026-11-05 · คำสั่ง user) — DR project ("Product DB" · eyhclzkifitbhbljgoav)
-- user: "สโตร์ไม่จำเป็นต้องไปตั้งไลน์ · part master แต่ละตัวควรตั้งได้ว่าที่จัดเก็บหลักอยู่ที่ไหน"
-- 1) parts_master.home_sloc (text · รหัสคลังตามทะเบียน storage_locations · ไม่ผูก FK ตามกฎทะเบียนข้อความ) · null = ยังไม่ตั้ง
-- 2) เลิกผูกกองคลัง STORE→S401 / FG WAREHOUSE→W401 (migration 20260908 ตั้งให้เองโดยไม่มีคนเลือก)
--    ⇒ พื้นที่ของยอดในกองคลัง = home_sloc ของพาร์ท (src/utils/storageLoc.js · slocOfStockRow)
-- ย้อนกลับ:
--   update public.storage_locations set line_names = array['STORE']        where code = 'S401' and line_names = '{}';
--   update public.storage_locations set line_names = array['FG WAREHOUSE'] where code = 'W401' and line_names = '{}';
--   alter table public.parts_master drop column if exists home_sloc;
alter table public.parts_master add column if not exists home_sloc text;
comment on column public.parts_master.home_sloc is 'ที่จัดเก็บหลัก (รหัสคลัง S4xx/R4xx/W4xx) — สโตร์จ่ายออกจากที่นี่ · null = ยังไม่ตั้ง (ห้ามเดาจากเลข MAT)';
update public.storage_locations set line_names = '{}' where code = 'S401' and line_names = array['STORE'];
update public.storage_locations set line_names = '{}' where code = 'W401' and line_names = array['FG WAREHOUSE'];
