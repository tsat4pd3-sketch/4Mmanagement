-- ═══════════════════════════════════════════════════════════════════════════
-- ชื่อส่วนงาน/แผนก ต้องมีสะกดเดียว — Main project (ewhdfqwfwofivojtsizn) · 2026-10-05
-- คำสั่ง user: *"เอาชื่อที่ดูสากล"*
--
-- 🔑 รูทคอส (ไม่ใช่แค่ "คนกรอกคนละแบบ"):
--   ค่าที่ระบบ **เก็บ** = `orgKey(node) = code || name` (`src/utils/listOrder.js`)
--   ⇒ node ไหนที่ `code` กับ `name` ไม่ตรงกัน จะมี 2 สะกดวิ่งคู่กันทันที —
--     จอที่อ่านผ่าน picker ได้ `code` · จอ/การนำเข้าที่อ่าน `name` ได้อีกค่า
--   แล้วเพราะ section/department เป็น **text key ไม่ใช่ FK** ตัวกรองจึงเงียบ: ไม่ error
--   แค่คืน 0 แถว (คลาสเดียวกับ `machine_no` — CLAUDE.md 🏷️ 2026-09-25)
--
-- 🔬 วัดของจริงก่อนแก้ (สแกน 22 คอลัมน์ section/scope ฝั่ง Main + 8 คอลัมน์ฝั่ง DR):
--   `PLN & STO` อยู่แค่ 2 ที่ → employees.section 10 แถว · org_nodes.name 1 แถว
--   ฝั่ง DR **0 แถวทุกตาราง** · ไม่มี hardcode ในโค้ด (เจอแต่ในคอมเมนต์กับ fixture ของเทส)
--
-- ① ส่วนงาน: `PLN & STO` → `Planning&Store`
--    ทำไมตัวนี้ชนะ: ผังทางการ ORG-001 Rev.09 เขียน `Log&Sales/Planning&Store` (cost 2140429000)
--    · เป็นค่าที่อยู่ใน `org_nodes.code` อยู่แล้ว · เป็นค่าที่ `profiles`/`notification_rules` ใช้
--    · `PLN & STO` เป็นตัวย่อภายใน ไม่สื่อกับคนนอก
--
-- ② แผนก: node `PD4-GEN` / ชื่อ `ทั่วไป` — ฝาแฝดคู่เดียวกัน เจอระหว่างไล่ตรวจ
--    picker คืน `PD4-GEN` แต่ **employees.department เก็บ `ทั่วไป` ไว้ 16 แถว · `PD4-GEN` 0 แถว**
--    ⇒ กดกรองแผนกนี้ได้ 0 คนมาตลอด · แก้ด้วยการ **ถอด code ทิ้ง** (ไม่ใช่เขียนทับ 16 แถว)
--      = ไม่มีแถวข้อมูลไหนขยับเลย แต่ picker กับของที่เก็บไว้ตรงกันทันที
--      ถ้าภายหลังอยากได้ชื่อสากล ให้เปลี่ยน *ชื่อ* node นี้ที่ /org-setup ครั้งเดียวจบ
--
-- ⏪ rollback อยู่ท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════════

-- ① ส่วนงาน — ให้ name เท่ากับ code (เลิกมี 2 สะกด)
update org_nodes set name = 'Planning&Store'
 where kind = 'section' and code = 'Planning&Store' and name = 'PLN & STO';

update employees set section = 'Planning&Store'
 where section = 'PLN & STO';

-- ② แผนก PD4 — ถอด code ให้เหลือสะกดเดียวตามที่ข้อมูลใช้จริง (ไม่แตะแถวพนักงาน)
update org_nodes set code = null
 where kind = 'department' and code = 'PD4-GEN' and name = 'ทั่วไป';

-- ── ตรวจกลับ (ต้องได้ 0 แถวทั้งคู่) ─────────────────────────────────────────
-- select count(*) from employees where section = 'PLN & STO';
-- select kind, code, name from org_nodes where code is not null and code <> name;

-- ─────────────────────────────────────────────────────────────────────────────
-- ⏪ ROLLBACK — วางทั้งก้อนใน SQL Editor ของ project MAIN (ewhdfqwfwofivojtsizn)
-- ─────────────────────────────────────────────────────────────────────────────
-- 10 ใบที่เคยเป็น 'PLN & STO' (จรรยา · ตีรณา · ธีรภัทร์ · ประจวบ · ไพศาล · ไวชยา · ศิวัช · สุธินี ·
-- เสริมศักดิ์ · อนุลักษณ์) — ย้อนเฉพาะ 10 ใบนี้ ห้ามย้อนทั้ง 'Planning&Store' (มีใบอื่นที่เป็นค่านี้มาแต่เดิม)
-- update employees set section = 'PLN & STO' where id in (
--   '20b4ae92-e483-4b85-8d5e-324cd706cd1b','a6a940cb-552b-4081-9f0a-0c91e75bc4bd',
--   'a71f5d7f-cb68-4d6d-8a42-ebb8791068dc','865ae3e2-be50-44bf-b826-38bb41e29b50',
--   '5a622bf7-b548-4384-9b7d-715f5305c941','048ca1b9-9933-4438-a4c4-a65ad1e51b72',
--   '2428beff-125e-4f34-8e63-1258c73ffd8f','6e6efc0b-4b6b-4d82-a991-cdc32b443626',
--   '5189a280-1021-42b0-a946-c898cf4d7b91','cad2b970-28ba-41f8-9cc3-afdeaec7a28f');
-- update org_nodes set name = 'PLN & STO' where kind='section' and code = 'Planning&Store';
-- update org_nodes set code = 'PD4-GEN'    where kind='department' and name = 'ทั่วไป';
