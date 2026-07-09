-- Grant page access to the new /daily-pm route for every role.
-- Project: MAIN (ewhdfqwfwofivojtsizn) — role_permissions lives here and gates
-- routes/nav via canAccessPage(). Without this row, canAccessPage() fails closed
-- and only admin (hardcoded bypass) could reach the page.
-- Matches the "roles: null" (all roles) nav config for /daily-pm.

insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/daily-pm', true
from unnest(array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]) as r
where not exists (
  select 1 from public.role_permissions rp
  where rp.role = r and rp.permission_key = 'page:/daily-pm'
);
