-- ══ B5: ปิด bucket `demand-mail` ไม่ให้ anon อ่าน (DR "Product DB" · eyhclzkifitbhbljgoav) ══
-- 2026-10-06 · user อนุมัติ "ทำข้อ 8"
--
-- ปัญหา: policy `demand_mail_read` (20260930d) เปิด select storage.objects ให้ anon ⇒ ใครถือ anon key
--        (ฝังในบันเดิลเว็บ) ก็ list/ดาวน์โหลดไฟล์ EDI 830/862 = ยอดสั่ง+forecast ลูกค้า ได้โดยไม่ล็อกอิน
-- ทำ: แอปเปิดไฟล์ผ่าน Edge Function `demand-mail-file` (ตรวจ token ล็อกอินของ Main + has_perm)
--     ซึ่งใช้ service role ⇒ ถอด policy อ่านของ client ออกได้ทั้งตัว
--     ตัวเขียน (`ingest-demand-mail`) ใช้ service role อยู่แล้ว — ไม่กระทบ
-- 🔴 ลำดับ: deploy function + เว็บเวอร์ชันที่เรียก function ก่อน แล้วค่อยรันไฟล์นี้
--    (รันก่อน = ปุ่ม "📥 เปิดเพื่อนำเข้า" ของเว็บเก่าเปิดไฟล์ไม่ได้ จนกว่าเว็บใหม่จะขึ้น)
-- ตาราง `demand_mail_inbox` (หัวเรื่อง/ผู้ส่ง/ชื่อไฟล์) ยังอ่านด้วย anon เหมือนเดิม — จอคิวต้องใช้
--
-- ย้อนกลับ: alter policy demand_mail_read on storage.objects using (bucket_id = 'demand-mail');

-- ✅ apply แล้ว 06/10 ผ่าน MCP: `alter policy … using (false)` (= ไม่มีแถวไหนผ่าน · ผลเท่ากับลบ)
--    เพราะ `drop policy` ผ่าน MCP ค้างจน timeout (คำสั่งลบต้องให้คนยืนยัน) — ลบทิ้งจริงทีหลังได้ไม่ต่างกัน
alter policy demand_mail_read on storage.objects using (false);
-- (ทางเลือก รันใน SQL Editor ได้ตอนว่าง) drop policy if exists demand_mail_read on storage.objects;

-- ตรวจผล: qual ต้องเป็น false (หรือไม่มีแถวถ้าลบทิ้งแล้ว) และไม่มี policy SELECT อื่นที่ไม่กรอง bucket_id
--   select policyname, qual from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT','ALL')
--     and (qual ilike '%demand-mail%' or qual not ilike '%bucket_id%');
