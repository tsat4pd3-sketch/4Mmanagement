-- Grant page access to the new MTN machine floor-map (/mtn-layout).
-- Project: MAIN (ewhdfqwfwofivojtsizn). Mirrors /pm-schedule (all roles) so the
-- fail-closed canAccessPage lets everyone in; admins can retune from /permissions.
insert into public.role_permissions (role, permission_key, allowed)
select role, 'page:/mtn-layout', allowed
from public.role_permissions
where permission_key = 'page:/pm-schedule'
on conflict (role, permission_key) do update set allowed = excluded.allowed;
