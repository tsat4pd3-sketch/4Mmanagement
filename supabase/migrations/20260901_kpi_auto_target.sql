-- ══ ตั้งเป้า/ทิศทางให้ KPI ที่ระบบคำนวณเอง (Main · 2026-09-01) ═══════════════════
-- คำถาม user: "ที่เป็น auto เข้าไป set มากกว่าดีหรือน้อยกว่าดียังไง เป้าหมาย commitment เซ็ทยังไง"
-- คำตอบเดิม = **ตั้งไม่ได้เลย** ยกเว้น OEE (ดึงจาก `oee_targets`)
--   ⇒ ยอดผลิต/ของเสีย/PPM/Cost of defect/Downtime โชว์ตัวเลขลอยๆ ตัดสิน Y/N ไม่ได้
--      และบอร์ด OBEYA ก็ขึ้นเทา "ยังไม่ตั้งเป้า" ตลอดกาล
--
-- โครง: แยก "ค่า" ออกจาก "นิยาม" ซึ่ง `kpi_definitions` ทำอยู่แล้ว
--   KPI กรอกมือ → ค่ามาจาก `kpi_manual_entries`
--   KPI อัตโนมัติ → **ค่ามาจากระบบ · เป้า/ทิศทาง/commitment/weight มาจากแถวนิยามนี้**
-- ⇒ เติมคอลัมน์ `source` บอกว่าแถวนิยามนี้ผูกกับตัวคำนวณตัวไหน
--
-- ⚠️ OEE ไม่มีในลิสต์นี้โดยตั้งใจ — เป้า OEE มีแหล่งเดียวคือ `oee_targets`
--    (ใช้ร่วมทั้ง /oee-analytics · /factory-map · /obeya) ตั้งซ้ำที่นี่ = เป้า OEE 2 ชุด drift แน่นอน

alter table public.kpi_definitions
  add column if not exists source text;

comment on column public.kpi_definitions.source is
  'null = กรอกมือ (ค่าอยู่ kpi_manual_entries) · auto:<key> = ค่ามาจากระบบ แถวนี้เก็บแค่เป้า/ทิศทาง/commitment';

-- 1 ตัวคำนวณ = 1 นิยาม ต่อ (ปี, ส่วนงาน, กลุ่มไลน์)
create unique index if not exists kpi_definitions_year_scope_source_uniq
  on public.kpi_definitions (year, coalesce(section, ''), coalesce(line_group, ''), source)
  where source is not null;

create index if not exists idx_kpi_definitions_source on public.kpi_definitions (year, source);
