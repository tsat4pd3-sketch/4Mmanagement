-- ── Main project (ewhdfqwfwofivojtsizn) — apply แล้ว 2026-07-14 ──
-- RPC สำหรับหน้า Login: แยกข้อความ error "ไม่พบบัญชีนี้" vs "รหัสผ่านไม่ถูกต้อง" (คำสั่ง user)
-- ⚠️ trade-off ที่ตั้งใจ: เปิดให้ anon เช็คว่าอีเมลมีบัญชีในระบบมั้ย (email enumeration) —
--    ยอมรับได้เพราะเป็นแอปภายในโรงงาน ความช่วยเหลือ user หน้างานสำคัญกว่า
--    ถ้าวันหน้าแอปเปิด public ต้อง revoke จาก anon แล้วกลับไปใช้ข้อความ error รวม
create or replace function public.login_email_exists(p_email text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
$$;
revoke all on function public.login_email_exists(text) from public;
grant execute on function public.login_email_exists(text) to anon, authenticated;
