-- ── Mention → แจ้งเตือนเข้ากระดิ่ง 🔔 — Main project (2026-07-16) ──
-- 1) RPC รายชื่อ user สำหรับ @mention (id + ชื่อ + role) — ไม่เปิด select ตรงบนตาราง profiles
--    guard: เรียกได้เฉพาะคน login (auth.uid() ต้องไม่ null) + revoke จาก anon/PUBLIC
create or replace function public.list_mention_users()
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.role::text
  from public.profiles p
  where auth.uid() is not null
    and p.full_name is not null
    and p.role::text <> 'display'
  order by p.full_name
$$;
revoke all on function public.list_mention_users() from public, anon;
grant execute on function public.list_mention_users() to authenticated;

-- 2) ให้ user ที่ login แล้ว insert แจ้งเตือนถึงคนอื่นได้ (ใช้กับ mention ในคอมเมนต์)
--    เดิม insert ได้เฉพาะ service role (Edge Functions) — เพิ่ม policy เฉพาะ INSERT
--    การอ่าน/แก้ notifications ยังเป็นของเจ้าของ (user_id = auth.uid()) ตาม policy เดิม
drop policy if exists notifications_insert_authenticated on public.notifications;
create policy notifications_insert_authenticated on public.notifications
  for insert to authenticated
  with check (user_id is not null);
