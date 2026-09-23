-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ══ 🛡️ ปิด `employee_photo_purge_log` ไม่ให้ anon อ่าน (เปิด RLS · ไม่มี policy) ══════
-- 2026-09-22 · จากแท็บ 🩺 ใน /schema — ตารางเดียวที่เหลือใน public ฝั่ง Main ที่ RLS ปิด
--
-- ตารางนี้คืออะไร: บันทึก rollback ของ `20260911_purge_oversize_employee_photos.sql`
--   (เก็บ url/ขนาด/ชื่อ/รหัส/ส่วนงาน ของรูปพนักงานที่ถูกล้างเพราะใหญ่เกิน) — เขียนครั้งเดียว
--   ตอนรัน migration · ไม่มีโค้ดแอป/edge function/function ฝั่ง DB แตะเลยสักจุด (สแกนแล้ว)
--
-- 🔴 ทำไมต้องปิด: RLS ปิด = ใครถือ anon key (ฝังในบันเดิลเว็บ) ดึง **รายชื่อ+รหัส+ส่วนงาน
--   พนักงานทั้งชุด** ได้โดยไม่ต้อง login — ข้อมูลบุคคลที่ตารางจริง (`employees`) ปิดไว้แล้ว
--   แต่รั่วออกทางสำเนา
--
-- ทำไม "ไม่มี policy" ถึงถูกต้อง: RLS เปิดแล้วไม่มี policy = ปฏิเสธทุกคำสั่งสำหรับทุก role
--   ที่ผ่าน RLS (anon/authenticated) · แต่ **ไม่กระทบการใช้งานจริง** เพราะคนที่ต้องอ่าน
--   (user รันคิวรี rollback ใน Supabase SQL Editor = role postgres) **bypass RLS อยู่แล้ว**

alter table public.employee_photo_purge_log enable row level security;
comment on table public.employee_photo_purge_log is
  'บันทึก rollback ของ migration ล้างรูปพนักงานใหญ่เกิน (20260911) — ไม่มีโค้ดแอปอ่าน · '
  'RLS เปิดแบบไม่มี policy โดยตั้งใจ (อ่านผ่าน SQL Editor เท่านั้น)';

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
--   select relrowsecurity, (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
--     from pg_class c where c.relname = 'employee_photo_purge_log';       -- true, 0
--   select count(*) from employee_photo_purge_log;   -- ข้อมูลยังอยู่ครบ (รันใน SQL Editor)
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   alter table public.employee_photo_purge_log disable row level security;
