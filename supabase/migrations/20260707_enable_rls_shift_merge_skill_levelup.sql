-- Enable RLS on two tables flagged by Supabase security advisors as
-- rls_disabled_in_public (ERROR level): shift_merge_events and
-- skill_level_up_requests. Both currently grant full SELECT/INSERT/UPDATE/
-- DELETE to `anon` with zero row-level restriction. Policies below scope
-- access to `authenticated` only, matching the app's existing JS-level
-- gating so no legitimate frontend call path is affected.

-- shift_merge_events: read by every logged-in role (ShiftOrganize, Checkin);
-- insert/delete gated in JS by manage_master_data permission (admin/manager/
-- supervisor in practice). No UPDATE path exists in the frontend.
alter table public.shift_merge_events enable row level security;

create policy shift_merge_events_select_authenticated
  on public.shift_merge_events
  for select
  to authenticated
  using (true);

create policy shift_merge_events_write_admin_manager_supervisor
  on public.shift_merge_events
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin','manager','supervisor']::user_role[])
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin','manager','supervisor']::user_role[])
    )
  );

revoke all on public.shift_merge_events from anon;

-- skill_level_up_requests: read by every logged-in role (Operator.jsx level-up
-- tab); approve/reject (UPDATE) gated in JS — admin/manager only when
-- to_level = 100, admin/manager/supervisor otherwise. No frontend INSERT path:
-- rows are created solely by the SECURITY DEFINER fn_weekly_skill_update RPC,
-- which bypasses RLS, so no INSERT/DELETE policy is needed here.
alter table public.skill_level_up_requests enable row level security;

create policy skill_level_up_requests_select_authenticated
  on public.skill_level_up_requests
  for select
  to authenticated
  using (true);

create policy skill_level_up_requests_update_below_100
  on public.skill_level_up_requests
  for update
  to authenticated
  using (
    to_level < 100
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin','manager','supervisor']::user_role[])
    )
  )
  with check (
    to_level < 100
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin','manager','supervisor']::user_role[])
    )
  );

create policy skill_level_up_requests_update_level_100
  on public.skill_level_up_requests
  for update
  to authenticated
  using (
    to_level = 100
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin','manager']::user_role[])
    )
  )
  with check (
    to_level = 100
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin','manager']::user_role[])
    )
  );

revoke all on public.skill_level_up_requests from anon;
