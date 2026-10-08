-- ══ 🔴 แก้ unique index ที่ทำให้ "KPI กรอกมือ" ใส่ได้แค่ตัวเดียวต่อ (ปี × ขอบเขต) ══════
--    Main project (ชื่อในจอ Supabase = "MAIN" · ewhdfqwfwofivojtsizn) · 2026-09-23
--
-- ═══ บั๊กที่เกิดจริง (พิสูจน์ด้วยการ insert จริงบนฐาน 23/09 — ตอนนั้นตารางว่าง 0 แถว) ═══
--   insert KPI กรอกมือตัวที่ 1 ใน (ปี 2099, ส่วน ZZTEST)  → ผ่าน
--   insert KPI กรอกมือตัวที่ 2 ใน (ปี 2099, ส่วน ZZTEST)  → **23505 unique_violation**
--   ⇒ ทั้งฟีเจอร์ "KPI นอกระบบกรอกมือ" (DL/OH · Satisfaction · Safety · HR) ตั้งได้
--     **ส่วนงานละ 1 ตัวเท่านั้น** ทั้งที่ใบจริงของทุกแผนกมี 12-15 รายการ
--
-- ═══ ต้นเหตุ — สมมติฐาน 2 migration ไม่ตรงกัน ═══════════════════════════════════════
--   · `20260824_kpi_definitions_main.sql`  สร้างคอลัมน์เป็น `source text not null default 'manual'`
--   · `20260901_kpi_auto_target.sql`       สั่ง `add column if not exists source text` (= no-op
--       เพราะคอลัมน์มีแล้ว) แล้วเขียน comment ว่า **"null = กรอกมือ"** — ซึ่งไม่เคยเป็นจริง
--       จากนั้นสร้าง unique index `... where source is not null`
--       โดยตั้งใจว่ากันเฉพาะแถว auto ("1 ตัวคำนวณ = 1 นิยาม ต่อ ปี+ขอบเขต")
--   ⇒ เมื่อแถวกรอกมือได้ `source = 'manual'` (ไม่ใช่ null) เงื่อนไข `is not null` จึง**คลุมแถวกรอกมือด้วย**
--     ⇒ (year, scope, 'manual') ซ้ำไม่ได้ = ส่วนงานละ 1 KPI
--   · `20260916_kpi_scope_provider_plan.sql` drop/create index นี้ใหม่ตามขอบเขตใหม่
--     แต่**ยกเงื่อนไข `where source is not null` มาทั้งดุ้น** ⇒ บั๊กเดินทางข้ามมาด้วย
--
-- 🔴 ที่แย่ที่สุดคือมัน **โกหกบนจอ**: `KpiMonthly.saveDef()` แปล 23505 เป็นข้อความ
--    "KPI นี้ถูกตั้งไว้ในปี xxxx ส่วน yyy แล้ว — แก้ที่แถวเดิมแทน" ⇒ คนเพิ่ม KPI *คนละตัว*
--    แต่จอบอกว่าตั้งไปแล้ว ⇒ เชื่อว่าตัวเองจำผิด แล้วเลิกใช้ฟีเจอร์ (ไม่มีใครรายงานว่าเป็นบั๊ก)
--
-- ═══ การแก้ — คืนเจตนาเดิมของ index: กันซ้ำเฉพาะแถว "auto" ═══════════════════════════
--    แถว auto = `source like 'auto:%'` (ดู `saveAutoTarget` ใน KpiMonthly.jsx: `auto:${key}`)
--    แถวกรอกมือ ('manual') ไม่ต้องกันด้วย index นี้ — มี `kpi_definitions_year_scope_catalog_uniq`
--    กันซ้ำ "KPI ตัวเดียวกัน (catalog_id) ในขอบเขตเดียวกัน" อยู่แล้ว ซึ่งเป็นการกันซ้ำที่ถูกต้อง
--
-- blast radius = **0 แถว** (ตรวจ 23/09: `select count(*) from kpi_definitions` = 0)
--   ⇒ ไม่มีข้อมูลเดิมให้ชนตอนสร้าง index ใหม่ · ถ้ารันซ้ำวันหลังที่มีข้อมูลแล้วก็ยังปลอดภัย
--     เพราะ index ใหม่ **หลวมกว่า** เดิมเสมอ (ชุดแถวที่ถูกคุมเป็น subset ของเดิม)

drop index if exists public.kpi_definitions_year_scope_source_uniq;

-- 1 ตัวคำนวณอัตโนมัติ = 1 นิยาม ต่อ (ปี, ขอบเขต) — เจตนาเดิมของ 20260901
-- ⚠️ ห้ามกลับไปใช้ `where source is not null` — `source` มี default 'manual' ทุกแถวกรอกมือ
create unique index if not exists kpi_definitions_year_scope_source_uniq
  on public.kpi_definitions (year, coalesce(scope_kind, ''), coalesce(scope_value, ''), source)
  where source like 'auto:%';

comment on column public.kpi_definitions.source is
  '''manual'' = กรอกมือ (ค่าอยู่ kpi_manual_entries) · ''auto:<key>'' = ค่ามาจากระบบ แถวนี้เก็บแค่เป้า/ทิศทาง/commitment'
  ' — ⚠️ NOT NULL default ''manual'' ห้ามสร้าง partial index ด้วย `where source is not null` (คลุมแถวกรอกมือด้วย)';

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (ย้อนกลับไปสภาพเดิมที่มีบั๊ก — ทำเฉพาะเมื่อพิสูจน์ได้ว่า index ใหม่สร้างปัญหาอื่น)
--   drop index if exists public.kpi_definitions_year_scope_source_uniq;
--   create unique index kpi_definitions_year_scope_source_uniq
--     on public.kpi_definitions (year, coalesce(scope_kind,''), coalesce(scope_value,''), source)
--     where source is not null;
--   ⚠️ ถ้าตอนนั้นมี KPI กรอกมือมากกว่า 1 ตัวต่อขอบเขตแล้ว **การ rollback จะล้มเอง** (สร้าง index ไม่ผ่าน)
--      ซึ่งถูกต้อง — แปลว่าข้อมูลจริงยืนยันว่าเงื่อนไขเดิมผิด
-- ═══════════════════════════════════════════════════════════════════════════
