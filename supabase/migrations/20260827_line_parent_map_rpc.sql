-- 🔗 line_parent_map() — ผังไลน์แม่-ลูก ให้ระบบฝั่ง DR อ่านได้  (Main)
--
-- ที่มา (2026-08-27): edge `kanban-round-scan` (อยู่ DR) ต้องรู้ว่า "ไลน์ลูกตัวนี้อยู่ใต้ไลน์แม่ไหน"
--   เพราะ **รอบจัดส่ง seed ไว้ที่ไลน์บนสุด แต่กะเปิดที่ไลน์ลูก** — ไม่ map ก่อนจับคู่ = ไม่มีวันเจอกัน
--   แต่ `production_lines` อยู่ Main (โปรเจค authenticated) ส่วน edge ฝั่ง DR ถือได้แค่ anon key
--   ⇒ อ่านตารางตรงๆ ได้ `[]` (RLS ปฏิเสธแบบ **ไม่มี error**) → groupOf() ตกเป็น identity
--   → ใบผลิตทุกใบถูกข้าม → แจ้งเตือน "0 พาร์ท" ทุกวันโดยไม่มีใครรู้ (เกิดจริง 27/08 08:30)
--
-- ⚠️ ทำไมเป็น RPC ไม่ใช่ "แจก service_role key ของ Main ให้ฟังก์ชันฝั่ง DR"
--    service_role = กุญแจผีของทั้งโปรเจค Main (auth/profiles/employees/role_permissions)
--    เอาไปวางเป็น env ของอีกโปรเจคเพื่ออ่าน 2 คอลัมน์ = แลกความเสี่ยงทั้งระบบกับข้อมูลที่ไม่ลับเลย
--    (ชื่อไลน์ถูกส่งเข้า Telegram อยู่แล้วทุกวัน) · precedent ในโปรเจคนี้: get_vapid_public_key(),
--    login_email_exists() — เปิดเฉพาะ "คำถามเดียว" ให้ anon แทนการเปิดตาราง/แจกกุญแจ
--
-- ⚠️ คืนเฉพาะ name + parent_line_name **ห้ามเพิ่มคอลัมน์อื่น** (cost_center/head_name/std_* เป็นข้อมูลภายใน)
--    อยากได้ข้อมูลไลน์เพิ่มฝั่ง DR ให้ทำ RPC ใหม่แยกเรื่อง ไม่ใช่ขยายตัวนี้

create or replace function public.line_parent_map()
returns table (name text, parent_line_name text)
language sql
security definer
stable
set search_path = public
as $$
  select l.name::text, l.parent_line_name::text
  from public.production_lines l
$$;

revoke all on function public.line_parent_map() from public;
grant execute on function public.line_parent_map() to anon, authenticated;

comment on function public.line_parent_map() is
  'ผังไลน์แม่-ลูก (name, parent_line_name) สำหรับระบบฝั่ง DR ที่ join ข้าม project ไม่ได้ — เปิดให้ anon โดยตั้งใจ';

-- ตรวจผล:
--   select * from line_parent_map() where parent_line_name is not null order by parent_line_name, name;
--   -- ควรเห็น HDF1/HDF2 ใต้ HYDROFORM · Line 60/Line 61 ใต้ LINE APRON ASSY ฯลฯ
--
-- Rollback: drop function public.line_parent_map();
