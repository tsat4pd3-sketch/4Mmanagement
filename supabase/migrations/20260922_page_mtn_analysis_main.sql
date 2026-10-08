-- ═══════════════════════════════════════════════════════════════════════════
-- สิทธิ์เข้าหน้า 🔍 /mtn-analysis — วิเคราะห์ปัญหา (QC 7 Tools)      2026-09-22
-- Project: **MAIN** (ชื่อในจอ Supabase = "MAIN" · id `ewhdfqwfwofivojtsizn`)
--
-- ที่มา (คำสั่ง user): "หมวด mtn ยังไม่มี dashboard ปัญหา เครื่องจักร/แม่พิมพ์/jig fixture
-- เลย สรุปปัญหา ระบบวิเคราะห์ qc7tools ยังไม่เห็น"
--
-- หน้านี้ **อ่านอย่างเดียว** ไม่มีปุ่มเขียนข้อมูลเลย ⇒ ไม่มี resource:action ใหม่
-- แจกให้ role ชุดเดียวกับ `page:/mtn-repair` (12 role) เพราะคนที่เห็นใบซ่อมได้
-- ก็ควรเห็นบทสรุปของใบซ่อมชุดเดิมได้ — ไม่มีข้อมูลใหม่โผล่ให้ใครที่ยังไม่เคยเห็น
--
-- ⚠️ ย้อนกลับได้: `delete from role_permissions where permission_key = 'page:/mtn-analysis';`
--    (ลบแล้วหน้าจะเข้าไม่ได้ทุก role ตามกฎ fail-closed ของ canAccessPage — เมนูก็หายเอง)
-- ═══════════════════════════════════════════════════════════════════════════

insert into role_permissions (role, permission_key, allowed)
select rp.role, 'page:/mtn-analysis', rp.allowed
from role_permissions rp
where rp.permission_key = 'page:/mtn-repair'
on conflict (role, permission_key) do nothing;

-- ตรวจผล (ควรได้จำนวน role เท่ากับของ page:/mtn-repair)
-- select permission_key, count(*) n, count(*) filter (where allowed) yes
--   from role_permissions
--  where permission_key in ('page:/mtn-repair', 'page:/mtn-analysis')
--  group by 1;
