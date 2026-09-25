-- ป้ายราคาแจ้งเตือนต้องนับ "คนที่รั่วผ่านตัวกรองส่วนงาน" ให้ตรงกับกติกาใหม่
-- Main project (ewhdfqwfwofivojtsizn) · 2026-09-25
--
-- 20260925_notify_recipients_scope_depth_main.sql เปลี่ยนกติกาแล้วว่า การข้ามเทียบ
-- ส่วนงานต้องมี `profiles.scope_depth='all'` ⇒ RPC ที่ประมาณ "กลุ่มที่ได้รับทุกส่วนงาน"
-- ต้องนับเงื่อนไขเดียวกัน ไม่งั้นป้ายราคาบนจอ /notification-config โม้เกินจริง
-- (วัดจริงวันนี้: ผจก.ส่วน 3 คนเป็น 'branch' ⇒ เดิมนับว่ารั่ว 8 คน จริง 5 คน)
--
-- 🔴 บทเรียน: จอที่ "ประมาณ" ตัวเลขให้คนตัดสินใจ ต้องแก้พร้อมกติกาที่มันประมาณถึงเสมอ
--    ไม่งั้นกลายเป็นจอโกหกแบบที่ไม่มีใครรู้ (ไม่มี error ไม่มี test ไหนตก)
-- ⏪ rollback: เอา `and p.scope_depth='all'` / คอลัมน์ n_admin_mgr_wide ออก กลับไปนับดิบ

create or replace function public.notif_rule_reach(p_days integer default 14)
returns table(event_key text, people_all integer, people_no_section integer,
              people_admin_mgr integer, n_sections integer, rows_n bigint, read_n bigint,
              events_n bigint, days_n integer, waste_n bigint, dead_n integer)
language sql stable security definer
set search_path to 'public'
as $function$
  with guard as (select has_perm('page:/notification-config') as ok),
  days as (select greatest(1, least(coalesce(p_days, 14), 90)) as d),
  secs as (select count(distinct section)::int as n from production_lines where section is not null),
  ppl as (
    select p.role::text as role, count(*)::int as n,
           -- ไม่มีส่วนงานเลย **และ** ประกาศว่าทั้งโรงงาน = กลุ่มที่ยังรั่วผ่านตัวกรองจริง
           count(*) filter (
             where coalesce(array_length(p.sections,1),0) = 0
               and p.section is null and e.section is null
               and p.scope_depth = 'all')::int as n_no_sec,
           -- admin/ผจก. ที่ยังได้รับการยกเว้น = เฉพาะที่ scope_depth='all'
           count(*) filter (
             where p.role::text in ('admin','manager')
               and p.scope_depth = 'all')::int as n_admin_mgr_wide
      from profiles p left join employees e on e.id = p.employee_id
     group by 1
  ),
  win as (
    select n.event_key as ek, n.user_id, count(*) as rows_u,
           count(*) filter (where n.is_read) as read_u
      from notifications n, days
     where n.created_at > now() - (days.d || ' days')::interval
       and n.event_key is not null
     group by 1, 2
  ),
  hist as (
    select w.ek, sum(w.rows_u) as rows_n, sum(w.read_u) as read_n,
           sum(w.rows_u) filter (where w.read_u = 0) as waste_n,
           count(*) filter (where w.read_u = 0)::int as dead_n
      from win w group by 1
  ),
  ev as (
    select n.event_key as ek,
           count(distinct coalesce(n.ref_id::text,
                 n.title || '|' || date_trunc('minute', n.created_at)::text)) as events_n
      from notifications n, days
     where n.created_at > now() - (days.d || ' days')::interval
       and n.event_key is not null
     group by 1
  )
  select r.event_key,
         coalesce((select sum(x.n) from ppl x where x.role = any(r.inapp_roles)), 0)::int,
         coalesce((select sum(x.n_no_sec) from ppl x where x.role = any(r.inapp_roles)), 0)::int,
         coalesce((select sum(x.n_admin_mgr_wide) from ppl x where x.role = any(r.inapp_roles)), 0)::int,
         (select n from secs),
         coalesce(h.rows_n, 0), coalesce(h.read_n, 0), coalesce(e2.events_n, 0),
         (select d from days),
         coalesce(h.waste_n, 0), coalesce(h.dead_n, 0)
    from notification_rules r
    left join hist h on h.ek = r.event_key
    left join ev   e2 on e2.ek = r.event_key
   cross join guard
   where guard.ok;
$function$;
