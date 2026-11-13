-- 🕵️ get_auth_users() คืน last_sign_in_at เพิ่ม  (Main · ewhdfqwfwofivojtsizn · 2026-10-29)
--
-- คำถาม user: "บัญชีของคน คนไหนไม่มีการเข้าใช้เลยบ้าง · admin ดู last login ได้มั้ย
--               จะได้ลบหรือปิดถูก"
-- ⇒ เดิมจอ /add-user เห็นแค่ email + created_at ⇒ ตัดสินไม่ได้ว่าใบไหนตายแล้ว
--    ต้องมาเปิด SQL Editor ถามทุกครั้ง
--
-- ⚠️ เติมคอลัมน์เดียว ไม่แตะด่านสิทธิ์
--    ด่านยังเป็น `profiles.role = 'admin'` เหมือนเดิมเป๊ะ — **ตั้งใจไม่เปลี่ยน**
--    (เปลี่ยนเป็น has_perm() = ขยายสิทธิ์ให้คนเห็นอีเมล login ของทุกคน = เป็น product decision
--     ที่ user ต้องเคาะ ไม่ใช่ของแถมมาในงานนี้ · จอเขียนบนหน้าอยู่แล้วว่าใครอ่านไม่ได้ ผ่าน authErr)
--
-- ⚠️ ต้อง drop ก่อน เพราะ create or replace เปลี่ยน return type ไม่ได้ —
--    อยู่ใน transaction เดียวกัน ⇒ ไม่มีช่วงที่ RPC หายไป
--
-- ย้อนกลับ: drop แล้ว create เวอร์ชันเดิม (3 คอลัมน์) — จอเก่าอ่าน 3 คอลัมน์แรกได้เหมือนเดิม
--           จึงปล่อยฟังก์ชันใหม่ไว้ได้แม้ revert โค้ด (backward-compatible)

drop function if exists public.get_auth_users();

create function public.get_auth_users()
returns table (
  id              uuid,
  email           text,
  created_at      timestamptz,
  last_sign_in_at timestamptz   -- 🔴 null = ไม่เคยเข้าเลย (คนละเรื่องกับ "อ่านไม่ได้" ฝั่งจอ)
)
language plpgsql
security definer
set search_path to 'auth', 'public', 'pg_temp'
as $function$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'forbidden: admin only';
  end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at
    from auth.users u
    order by u.created_at;
end;
$function$;

revoke all on function public.get_auth_users() from public, anon;
grant execute on function public.get_auth_users() to authenticated;

comment on function public.get_auth_users() is
  'จอ /add-user: อีเมล login + วันสร้าง + เข้าใช้ล่าสุด · admin เท่านั้น · last_sign_in_at null = ไม่เคยเข้า';
