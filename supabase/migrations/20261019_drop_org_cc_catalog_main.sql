-- 🧹 ลบ RPC `public.org_cc_catalog()` ที่ไม่มีใครใช้  (Main — "MAIN" · ewhdfqwfwofivojtsizn · 2026-10-19)
--
-- ที่มา: ตอนทำชั้นสิทธิ์แกน Cost Center (16/10) เคยลองทำทะเบียนรหัสเป็น RPC ฝั่ง DB
--   แต่ recursive CTE ที่เริ่มจาก `parent_id is null` + ต้องมีบรรพบุรุษ active
--   **ทิ้งโหนดที่อยู่ใต้แม่ซึ่งถูกปิดใช้งาน** ⇒ คืน 49 จาก 53 รหัส (หายเงียบ 4 ตัว)
--   การแก้ให้ orphan-safe ต้องเปลี่ยน return type → ติด 42P13 แล้ว drop+create ก็ timeout
-- ⇒ **เลิกพึ่ง RPC ทั้งทาง**: ทะเบียนรหัส derive ฝั่งจอจาก `org_nodes` ที่ `useOrgScope()`/จอโหลดอยู่แล้ว
--   (`buildCcIndex().catalog()` ใน `src/utils/ccScope.js` — มีธง `orphan` ให้จอเขียนบอกตรงๆ)
--   ได้ของแถม: ไม่ยิงคิวรีเพิ่ม · ไม่กินเกรส · และ "ผังขาด" เห็นบนจอ ไม่ใช่หายไปเฉยๆ
--
-- ย้อนกลับ: ไม่ต้องย้อน — ไม่มีโค้ดไหน (ทั้ง client/edge/trigger) เรียกฟังก์ชันนี้
--   (grep `org_cc_catalog` ทั้งรีโป = 0 จุด ก่อนลบ) · ลบแล้วไม่กระทบคอลัมน์/ข้อมูลใด
-- ⚠️ สถานะ 19/10: **ยังไม่ apply** — คำสั่ง DDL นี้ timeout ใน MCP ทุกรอบ (SELECT ปกติดี)
--    ฟังก์ชันยังค้างอยู่ใน DB แต่ **ไม่มีผลต่อระบบ** (ไม่มีใครเรียก · ไม่มี trigger/view พึ่ง)
--    ⇒ ให้ user รันบรรทัดล่างใน SQL Editor ของ project "MAIN" (ewhdfqwfwofivojtsizn)
drop function if exists public.org_cc_catalog();

-- ตรวจกลับ (ต้องได้ 0 แถว):
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname = 'org_cc_catalog';
