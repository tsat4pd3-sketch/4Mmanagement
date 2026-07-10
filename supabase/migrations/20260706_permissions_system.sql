-- Target project: main (ewhdfqwfwofivojtsizn)
--
-- Adds a data-driven role permission system to replace the ~20+ hardcoded
-- `['admin','manager','supervisor'].includes(role)` checks scattered across
-- the frontend, and closes two real security gaps found during audit:
--   1. profiles.role had no protection — any authenticated user could
--      rewrite their own role (including to 'admin') directly via the API,
--      bypassing AddUser.jsx entirely. Now enforced by a trigger.
--   2. Every RLS policy scoped to `public` (i.e. `anon` + `authenticated`)
--      is tightened to `authenticated` only — see the DO block at the end.
--      (The DR project — eyhclzkifitbhbljgoav — got the same fix applied
--      directly; there is no local migrations folder for that project.)
--
-- 'display' is added to the user_role enum: AddUser.jsx already offered it
-- as a role option and App.jsx already had logic exempting it from
-- auto-logout, but the enum never actually had this value, so assigning it
-- would have failed silently at the DB layer. This makes the existing UI
-- actually work as intended.

alter type user_role add value if not exists 'display';

-- ── Helper: current authenticated user's role, for RLS/trigger checks ──
create or replace function current_user_role()
returns user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

-- ── Protect profiles.role from self-escalation ──
-- Only an admin may change any profile's role column. Other profile field
-- updates (line_id, section, team, notify_email, signature_url, ...) are
-- unaffected.
create or replace function protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if current_user_role() is distinct from 'admin'::user_role then
      raise exception 'Only admin can change a user role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_role on profiles;
create trigger trg_protect_profile_role
before update on profiles
for each row execute function protect_profile_role();

-- ── role_permissions: single source of truth for role-gated access ──
create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role user_role not null,
  permission_key text not null,
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (role, permission_key)
);

alter table role_permissions enable row level security;

drop policy if exists role_permissions_select on role_permissions;
create policy role_permissions_select on role_permissions
  for select to authenticated
  using (true);

drop policy if exists role_permissions_write_admin on role_permissions;
create policy role_permissions_write_admin on role_permissions
  for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'::user_role))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'::user_role));

create or replace function set_role_permissions_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_role_permissions_updated on role_permissions;
create trigger trg_role_permissions_updated
before update on role_permissions
for each row execute function set_role_permissions_updated();

-- ── Seed: matches today's actual RoleRoute/NAV_ITEMS behavior exactly,
--    except page:/register which is corrected to include 'manager' (the
--    nav link already showed it to managers, but the route blocked them —
--    a real bug found during audit; this seed fixes it). ──
insert into role_permissions (role, permission_key, allowed)
select r.role, p.permission_key, (r.role = any(p.allowed_roles))
from (values
  ('page:/',                  array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/dashboard',         array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/checkin',           array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/management',        array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/daily-report',      array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/oee-analytics',     array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/line-stock',        array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/heijunka',          array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/rack-center',       array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/pm-check',          array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/pm-schedule',       array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/pm-setup',          array['admin','manager','supervisor']::user_role[]),
  ('page:/report',            array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/event-log',         array['admin','manager','supervisor','leader','qa']::user_role[]),
  ('page:/org-setup',         array['admin']::user_role[]),
  ('page:/register',          array['admin','manager','supervisor']::user_role[]),
  ('page:/operator',          array['admin','manager','supervisor','leader']::user_role[]),
  ('page:/products',          array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/linesetup',         array['admin','manager','supervisor']::user_role[]),
  ('page:/machine-database',  array['admin','manager','supervisor']::user_role[]),
  ('page:/shift-organize',    array['admin','manager','supervisor']::user_role[]),
  ('page:/company-calendar',  array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]),
  ('page:/add-user',          array['admin']::user_role[]),
  ('page:/permissions',       array['admin']::user_role[]),
  ('manage_master_data',      array['admin','manager','supervisor']::user_role[])
) as p(permission_key, allowed_roles)
cross join (select unnest(array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]) as role) as r
on conflict (role, permission_key) do nothing;

-- ── Close anon access: tighten every `public`-scoped policy to `authenticated`.
--    The whole app requires a logged-in session (App.jsx redirects to /login
--    otherwise), so there is no legitimate use case for anon reads/writes. ──
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and roles = '{public}'
  loop
    execute format('alter policy %I on %I.%I to authenticated', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;
