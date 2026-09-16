-- ══ KPI ระดับ "คอลัมน์บนบอร์ด OBEYA" (Main · 2026-09-01) ═══════════════════════
-- ที่มา: user ส่งรูปบอร์ด OBEYA HYDROFORM ของหน้างานมา (5 รูป) — โครงจริงคือ
--
--   [Key Performance PD3] [LINE HYDROFORM 1&2] [LINE APRON ASSY & SUP APRON] [ENGNEER PD3]
--    ระดับส่วนงาน          cost 2140662101/102   cost 2140662201/202           แผนงาน/กิจกรรม
--
-- แต่ละคอลัมน์ไลน์มี **8 หัวข้อเดียวกันเป๊ะ** พร้อมป้ายสถานะ G/Y/R:
--   Direct Labor · Overhead · Inventory Balance · Customer Satisfaction
--   OEE · PPM · Safety · Training
--
-- ⇒ ค่าของ KPI เป็นราย "กลุ่มไลน์" ไม่ใช่ราย "ส่วนงาน" (บอร์ดพิมพ์เลข cost center กำกับหัวคอลัมน์)
--   `kpi_definitions` เดิมผูกแค่ (year, section) → เติมแกน `line_group`
--     line_group = null  → ระดับส่วนงาน (คอลัมน์ Key Performance)
--     line_group = ชื่อไลน์แม่ → คอลัมน์ไลน์นั้นบนบอร์ด
--
-- ⚠️ ใช้ชื่อ **ไลน์แม่** (production_lines.parent_line_name IS NULL) เป็นคีย์ ไม่ใช่ cost center
--    เพราะ 1 คอลัมน์บนบอร์ดครอบหลาย cost center (APRON ASSY = 201 + 202) และไลน์ลูก
--    หลายตัวใช้ cost center เดียวกัน (Line 60 + Line 61 = 2140662201)
--    หัวคอลัมน์บนจอโชว์ cost center ของกลุ่มให้ตรงกับบอร์ดกระดาษ

alter table public.kpi_definitions
  add column if not exists line_group text;

create index if not exists idx_kpi_definitions_line_group
  on public.kpi_definitions (year, line_group);

-- unique เดิมไม่มี line_group → KPI ตัวเดียวกันตั้งให้หลายกลุ่มไลน์ไม่ได้ ต้องสร้างใหม่
drop index if exists public.kpi_definitions_year_section_catalog_uniq;
create unique index if not exists kpi_definitions_year_scope_catalog_uniq
  on public.kpi_definitions (year, coalesce(section, ''), coalesce(line_group, ''), catalog_id)
  where catalog_id is not null;

-- ── ชื่อ KPI 8 ตัวตามบอร์ดจริง ───────────────────────────────────────────────
-- ⚠️ นี่ไม่ใช่การ "เดาชื่อ" — **ถอดจากป้ายเหลืองบนบอร์ดที่ user ถ่ายมาเอง**
--    (กฎห้าม seed ห้าม *เดา* ไม่ได้ห้ามถอดจากเอกสารจริงของ user)
--    สะกดตามพจนานุกรมไม่ตามป้าย (ป้ายจริงพิมพ์ตก: Saisfaction / TRIANNING) — เปลี่ยนเองได้ที่ 🗂 ทะเบียน
-- ⚠️ **ไม่ตั้ง target/unit ให้** — เป้าเป็นการตัดสินใจของหน่วยงาน (กฎห้ามเดา)
--    ทิศทางใส่เฉพาะตัวที่ไม่กำกวม (ต้นทุน/ของเสีย = ยิ่งน้อยยิ่งดี · OEE/ความพอใจ = ยิ่งมากยิ่งดี)
--    Inventory Balance ปล่อย null — บอร์ดคุมเป็น "ช่วง" ไม่ใช่มาก/น้อยอย่างเดียว
insert into public.kpi_catalog (name, category, direction, scope_text, sort_order)
select v.name, v.category, v.direction, v.scope_text, v.sort_order
from (values
  ('Direct Labor',          'financial', 'down', 'บอร์ด OBEYA — ต้นทุนแรงงานทางตรง', 10),
  ('Overhead',              'financial', 'down', 'บอร์ด OBEYA — ค่าโสหุ้ย',           20),
  ('Inventory Balance',     'financial', null,   'บอร์ด OBEYA — ยอดคงคลัง',          30),
  ('Customer Satisfaction', 'customer',  'up',   'บอร์ด OBEYA — ความพึงพอใจลูกค้า',   40),
  ('OEE',                   'internal',  'up',   'ระบบคำนวณให้จากกะที่ปิดแล้ว',        50),
  ('PPM',                   'internal',  'down', 'ระบบคำนวณให้จาก defect_logs',       60),
  ('Safety',                'internal',  'down', 'ระบบคำนวณให้จาก safety_events',     70),
  ('Training',              'learning',  'up',   'บอร์ด OBEYA — การอบรม/พัฒนาคน',     80)
) as v(name, category, direction, scope_text, sort_order)
where not exists (
  select 1 from public.kpi_catalog c where lower(btrim(c.name)) = lower(btrim(v.name))
);
