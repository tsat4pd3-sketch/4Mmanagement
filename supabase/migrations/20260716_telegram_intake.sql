-- ── Telegram intake (ขา "รับ" ของบอท) — Main project (2026-07-16) ─────────────
-- เก็บข้อความจากกลุ่ม Telegram + ผูก reply กับเหตุการณ์ + คิวยืนยัน action จาก AI
-- ทุกตารางเขียน/อ่านโดย Edge Functions (service role — bypass RLS) เท่านั้น
-- → enable RLS โดยไม่มี policy = client (anon/authenticated) แตะไม่ได้เลย โดยตั้งใจ

-- 1) ข้อความที่กวาดเก็บจากกลุ่มที่ลงทะเบียนใน telegram_channels
create table if not exists public.telegram_messages (
  id                  bigint generated always as identity primary key,
  update_id           bigint unique,          -- กัน Telegram ยิงซ้ำ (retry ได้ upsert เงียบ)
  chat_id             text not null,
  chat_title          text,
  message_id          bigint not null,
  from_id             text,
  from_name           text,
  text                text,
  reply_to_message_id bigint,
  kind                text not null default 'message',  -- message | edited | command | reply
  msg_at              timestamptz,
  raw                 jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists telegram_messages_chat_idx on public.telegram_messages (chat_id, msg_at);
alter table public.telegram_messages enable row level security;

-- 2) ข้อความที่บอท "ส่งออก" ผูกกับเหตุการณ์ — ให้ reply ใต้แจ้งเตือนย้อนกลับมาหาใบงานได้
create table if not exists public.telegram_sent_messages (
  chat_id    text not null,
  message_id bigint not null,
  ref_kind   text not null,      -- 'mtn_order' | 'downtime' (ขยายได้)
  ref_id     text not null,
  event      text,
  sent_at    timestamptz not null default now(),
  primary key (chat_id, message_id)
);
alter table public.telegram_sent_messages enable row level security;

-- 3) คิว action จาก AI ที่รอคนกดยืนยันใน Telegram ก่อนเขียนลงฐานจริง
create table if not exists public.telegram_pending_actions (
  id           uuid primary key default gen_random_uuid(),
  chat_id      text not null,
  message_id   bigint,             -- ข้อความยืนยันที่บอทส่ง (ใช้ editMessageText ตอนตัดสิน)
  requested_by text,
  action       text not null,      -- 'log_downtime' (ขยายได้)
  payload      jsonb not null,     -- ฟิลด์ที่จะ insert + ข้อความสรุปที่โชว์
  status       text not null default 'pending' check (status in ('pending','confirmed','cancelled','expired')),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   text
);
create index if not exists telegram_pending_status_idx on public.telegram_pending_actions (status, created_at);
alter table public.telegram_pending_actions enable row level security;
