-- Notification routing v2 — user-managed rooms + per-event rules.
-- Project: MAIN (ewhdfqwfwofivojtsizn).
-- Replaces the fixed 6-topic telegram_channels with:
--   telegram_channels   : rooms the user can add/remove freely (name + chat_id)
--   notification_rules  : one row per notifiable event → on/off + which room
-- The bot token stays a function SECRET (not stored here) since it can hijack
-- the bot. chat_id is not sensitive and is managed from the admin config page.

drop table if exists public.notification_rules cascade;
drop table if exists public.telegram_channels cascade;

-- ── Rooms ──────────────────────────────────────────
create table public.telegram_channels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  chat_id     text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.telegram_channels enable row level security;
create policy telegram_channels_read  on public.telegram_channels for select to authenticated using (true);
create policy telegram_channels_write on public.telegram_channels for all    to authenticated using (true) with check (true);

-- ── Per-event rules ────────────────────────────────
create table public.notification_rules (
  event_key   text primary key,
  label       text not null,
  category    text not null,      -- grouping in the UI (manpower/production/quality/maintenance/pull/stock)
  channel_id  uuid references public.telegram_channels(id) on delete set null,
  is_enabled  boolean not null default true,
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.notification_rules enable row level security;
create policy notification_rules_read  on public.notification_rules for select to authenticated using (true);
create policy notification_rules_write on public.notification_rules for all    to authenticated using (true) with check (true);

-- ── Seed starter rooms (user can rename / add / delete) ──
insert into public.telegram_channels (name, sort_order) values
  ('🧑‍🏭 Smart Manpower',    1),
  ('🏭 Smart Production',    2),
  ('🔍 Smart Quality',       3),
  ('🔧 Smart Maintenance',   4),
  ('🎴 Smart Pull System',   5),
  ('📦 Smart Stock',         6);

-- ── Seed rules for the events that actually fire, each pointed at its room ──
insert into public.notification_rules (event_key, label, category, channel_id, sort_order)
select v.event_key, v.label, v.category,
       (select id from public.telegram_channels tc where tc.name = v.room),
       v.ord
from (values
  ('checkin_summary',    'เช็คชื่อเสร็จ (สรุปเข้างาน)',        'manpower',    '🧑‍🏭 Smart Manpower',  1),
  ('downtime',           'เครื่องจักร Downtime',               'production',  '🏭 Smart Production',  2),
  ('downtime_recovered', 'เครื่องกลับมารันได้',                'production',  '🏭 Smart Production',  3),
  ('prod_close',         'ปิดกะ / ขอปิดกะ',                    'production',  '🏭 Smart Production',  4),
  ('four_m_status',      '4M เปลี่ยนสถานะ / อนุมัติ',          'quality',     '🔍 Smart Quality',     5),
  ('pm_daily_green',     'Daily PM ตรวจครบ ปกติ (เขียว)',      'maintenance', '🔧 Smart Maintenance', 6),
  ('pm_daily_orange',    'Daily PM ตรวจไม่ครบเกินเวลา (ส้ม)',  'maintenance', '🔧 Smart Maintenance', 7),
  ('pm_daily_red',       'Daily PM พบความผิดปกติ (แดง)',       'maintenance', '🔧 Smart Maintenance', 8)
) as v(event_key, label, category, room, ord);

-- Route access to the config page (admin only; admin also bypasses in code).
insert into public.role_permissions (role, permission_key, allowed)
select 'admin'::user_role, 'page:/notification-config', true
where not exists (
  select 1 from public.role_permissions rp
  where rp.role = 'admin'::user_role and rp.permission_key = 'page:/notification-config'
);
