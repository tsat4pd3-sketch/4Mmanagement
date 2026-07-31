-- Web Push (เฟส B) — เด้งแจ้งเตือนเข้ามือถือแม้ปิดแอป/ล็อกจอ (Main project ewhdfqwfwofivojtsizn)
-- โครงสร้าง:
--   • VAPID keys เก็บใน notification_settings (เหมือน bot_token) — ค่าจริง set ผ่าน execute_sql/UI
--     ไม่ commit ลง repo · notification_settings RLS on + ไม่มี policy = อ่านได้เฉพาะ service role
--   • push_subscriptions: subscription ต่อ user (ผู้ใช้จัดการของตัวเอง · edge อ่านทั้งหมดผ่าน service role)
--   • RPC get_vapid_public_key(): ส่ง public key ให้ฝั่งเว็บ (public key เปิดเผยได้ · private ไม่ส่ง)
--   • trigger notifications→send-push: ทุก notification ใหม่ยิง push อัตโนมัติ (best-effort ไม่ทำ insert หลักพัง)
-- additive/idempotent

create extension if not exists pg_net;

-- 1) VAPID keys columns (ค่าจริงไม่อยู่ใน migration — set ผ่าน execute_sql)
alter table public.notification_settings
  add column if not exists vapid_public_key  text,
  add column if not exists vapid_private_key text,
  add column if not exists vapid_subject     text;

-- 2) push subscriptions ต่อผู้ใช้
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_push_sub_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_sub_own_select on public.push_subscriptions;
create policy push_sub_own_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists push_sub_own_insert on public.push_subscriptions;
create policy push_sub_own_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists push_sub_own_delete on public.push_subscriptions;
create policy push_sub_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- 3) RPC ส่ง VAPID public key ให้ฝั่งเว็บ (private ไม่ส่งออก)
create or replace function public.get_vapid_public_key()
returns text language sql security definer stable
set search_path = public as $$
  select vapid_public_key from public.notification_settings where id = 1;
$$;
revoke all on function public.get_vapid_public_key() from public;
grant execute on function public.get_vapid_public_key() to anon, authenticated;

-- 4) trigger: ทุก notification ใหม่ → ยิง send-push edge (best-effort ห้ามทำ insert หลักพัง)
create or replace function public.fn_notify_push()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object(
      'user_id', NEW.user_id, 'title', NEW.title, 'body', NEW.body,
      'type', NEW.type, 'ref_table', NEW.ref_table, 'ref_id', NEW.ref_id
    )
  );
  return NEW;
exception when others then return NEW;
end;
$$;

drop trigger if exists trg_notify_push on public.notifications;
create trigger trg_notify_push after insert on public.notifications
for each row execute function public.fn_notify_push();
