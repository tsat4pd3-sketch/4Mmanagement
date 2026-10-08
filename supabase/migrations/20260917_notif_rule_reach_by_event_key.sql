-- notif_rule_reach เวอร์ชันที่ใช้จริง — จับคู่ประวัติด้วย `notifications.event_key`
-- (ต้อง drop ก่อน create เพราะเปลี่ยน return type · ดูเหตุผลใน 20260917_notifications_event_key.sql)
-- 2026-09-17
drop function if exists public.notif_rule_reach(int);

create function public.notif_rule_reach(p_days int default 14)
returns table (
  event_key text, people_all int, people_no_section int, people_admin_mgr int,
  n_sections int, rows_n bigint, read_n bigint, events_n bigint, days_n int
)
language sql stable security definer set search_path to 'public'
as $$
  with guard as (select has_perm('page:/notification-config') as ok),
  days as (select greatest(1, least(coalesce(p_days, 14), 90)) as d),
  secs as (select count(distinct section)::int as n from production_lines where section is not null),
  ppl as (
    select p.role::text as role, count(*)::int as n,
           count(*) filter (
             where coalesce(array_length(p.sections,1),0) = 0
               and p.section is null and e.section is null)::int as n_no_sec
      from profiles p left join employees e on e.id = p.employee_id
     group by 1
  ),
  hist as (
    select n.event_key as ek, count(*) as rows_n,
           count(*) filter (where n.is_read) as read_n,
           count(distinct coalesce(n.ref_id::text,
                 n.title || '|' || date_trunc('minute', n.created_at)::text)) as events_n
      from notifications n, days
     where n.created_at > now() - (days.d || ' days')::interval and n.event_key is not null
     group by 1
  )
  select r.event_key,
         coalesce((select sum(x.n) from ppl x where x.role = any(r.inapp_roles)), 0)::int,
         coalesce((select sum(x.n_no_sec) from ppl x where x.role = any(r.inapp_roles)), 0)::int,
         coalesce((select sum(x.n) from ppl x
                    where x.role = any(r.inapp_roles) and x.role in ('admin','manager')), 0)::int,
         (select n from secs),
         coalesce(h.rows_n, 0), coalesce(h.read_n, 0), coalesce(h.events_n, 0), (select d from days)
    from notification_rules r
    left join hist h on h.ek = r.event_key
   cross join guard where guard.ok;
$$;

revoke all on function public.notif_rule_reach(int) from public, anon;
grant execute on function public.notif_rule_reach(int) to authenticated;

comment on function public.notif_rule_reach(int) is
  'ป้ายราคาของแต่ละกฎแจ้งเตือน (คนรับ / แถวจริง / อ่านกี่ % / เหตุการณ์จริง) — ใช้ที่ /notification-config. คืนค่าดิบ สูตรอยู่ src/utils/notifReach.js';
