-- In-app Telegram bot token — write-only from the UI, never readable back.
-- Project: MAIN (ewhdfqwfwofivojtsizn).
-- The token can hijack the bot, so the table has NO select policy for the app;
-- the client only ever learns "is it set + last 4 chars" via a definer RPC, and
-- only an admin can set it. The edge function (service role) reads the real
-- value, falling back to the TELEGRAM_BOT_TOKEN env secret when unset.

create table if not exists public.notification_settings (
  id          int primary key default 1,
  bot_token   text,
  updated_at  timestamptz not null default now(),
  constraint notification_settings_single check (id = 1)
);
insert into public.notification_settings (id) values (1) on conflict (id) do nothing;

alter table public.notification_settings enable row level security;
-- Intentionally NO policies → PostgREST/anon/authenticated cannot read or write
-- the token directly. All access goes through the definer functions below.

-- Set the token (admin only). Empty string clears it.
create or replace function public.set_bot_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'forbidden: admin only';
  end if;
  update public.notification_settings
    set bot_token = nullif(btrim(p_token), ''), updated_at = now()
    where id = 1;
end;
$$;

-- Masked status for the UI — never returns the full token.
create or replace function public.bot_token_status()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_tok text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'forbidden: admin only';
  end if;
  select bot_token into v_tok from public.notification_settings where id = 1;
  return json_build_object(
    'is_set', v_tok is not null and length(v_tok) > 0,
    'last4',  case when v_tok is not null and length(v_tok) >= 4 then right(v_tok, 4) else null end
  );
end;
$$;

revoke all on function public.set_bot_token(text)  from public, anon;
revoke all on function public.bot_token_status()   from public, anon;
grant execute on function public.set_bot_token(text) to authenticated;
grant execute on function public.bot_token_status()  to authenticated;
