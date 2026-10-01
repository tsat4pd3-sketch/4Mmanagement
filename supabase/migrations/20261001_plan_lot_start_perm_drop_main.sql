-- 🔑 ถอนสิทธิ์ `production_plan:start` (MAIN · ewhdfqwfwofivojtsizn · 2026-10-01)
--
-- ปุ่ม "▶ เริ่มล็อตนี้" ถูกถอดออกแล้ว — แผนเป็น "กรอบ" ไม่สร้างใบผลิต (ดู 20261001_plan_lots_frame_only_dr.sql)
-- ⇒ คีย์นี้ไม่มีโค้ดเรียกอีกแล้ว · ปล่อยค้างในทะเบียน = คนเห็นใน /permissions แล้วเข้าใจผิดว่ามีปุ่มให้เปิด
--   (audit/permmap.mjs เทียบคีย์ในโค้ด vs ทะเบียน — คีย์ที่ไม่มีใครเรียก = ขยะที่ทำให้แผนที่สิทธิ์ผิด)
--
-- ⚠️ `production_plan:write` (ทีมวางแผนแก้แผน) **ยังใช้อยู่ ห้ามลบ**
--
-- 🔙 rollback: รัน insert ส่วน production_plan:start ใน 20260930_production_plan_lot_permissions_main.sql ซ้ำ

delete from role_permissions where permission_key = 'production_plan:start';

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
-- select permission_key, count(*) from role_permissions
--  where permission_key like 'production_plan:%' group by 1;   -- ต้องเหลือแต่ production_plan:write
