-- ══ ผูกแถวนิยาม KPI กลับไปหา "แถวในทะเบียนมาตรฐาน" ที่มันถูกหยิบมา ══════════════════
--    Main project (ชื่อในจอ Supabase = "MAIN" · ewhdfqwfwofivojtsizn) · 2026-09-23
--
-- ทำไม: `checkStdSelection()` (src/utils/kpiSetup.js) ตรวจว่า "ข้อ Fixed ครบไหม" โดยจับคู่
--   `std_item_id` ก่อน แล้วค่อยตกไปเทียบ `topic` แบบ normalize ข้อความ
--   ⇒ ถ้าไม่มีคอลัมน์นี้ ระบบเหลือทางเดียวคือ**เทียบชื่อ** ซึ่งพังทันทีที่คนแก้ชื่อ KPI ให้สั้นลง
--     หรือใส่วงเล็บเพิ่ม (เช่น "Internal Quality Rate" → "Internal Quality Rate (PPM)")
--     ⇒ จอจะเตือน "ขาดข้อบังคับ" ทั้งที่มีอยู่จริง = คำเตือนที่ผิด ซึ่งคนจะเรียนรู้ที่จะเมิน
--
-- nullable ตั้งใจ — แถวที่หน่วยงาน**เพิ่มเองนอกทะเบียน**ต้องมีได้ (ใบจริงของ TSAT เพิ่ม
--   `Non NC Major` เองซึ่งไม่มีในทะเบียนสักหน่วยงาน) ⇒ `std_item_id is null` = "นอกมาตรฐาน"
--
-- `on delete set null` ไม่ใช่ cascade — ทะเบียนเปลี่ยนตามปีเอกสาร (ลบ/แทนที่แถวได้)
--   แต่ **KPI ที่หน่วยงานตั้งไว้แล้วห้ามหายตามไปด้วย** (ค่ารายเดือนผูกอยู่กับมัน)
--
-- blast radius = 0 แถว (ตรวจ 23/09: kpi_definitions = 0 แถว) · เพิ่มคอลัมน์ nullable = โค้ดเดิมไม่รู้ตัว

alter table public.kpi_definitions
  add column if not exists std_item_id uuid
    references public.kpi_standard_items(id) on delete set null;

comment on column public.kpi_definitions.std_item_id is
  'แถวใน kpi_standard_items ที่ KPI ข้อนี้ถูกหยิบมา · null = หน่วยงานเพิ่มเอง (นอกทะเบียนมาตรฐาน)';

create index if not exists idx_kpi_definitions_std_item
  on public.kpi_definitions (std_item_id) where std_item_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
--   drop index if exists public.idx_kpi_definitions_std_item;
--   alter table public.kpi_definitions drop column if exists std_item_id;
--   ⚠️ revert โค้ดก่อนเสมอ แล้วค่อยแตะ schema (โค้ดเก่าไม่รู้จักคอลัมน์นี้อยู่แล้ว)
-- ═══════════════════════════════════════════════════════════════════════════
