-- 20261020_push_coverage_rpc_main.sql · ⚠️ Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- 📲 "ใครยังไม่มีเครื่องรับแจ้งเตือนเข้ามือถือ" — ให้แอดมินเห็นเอง
--
-- ที่มา (feedback หน้างาน 20/10 · *"มือถือ ไม่มีการแจ้งเตือนใบแจ้งซ่อมมา 2-3 วัน เกิดจากเรื่องสิทธิ์รึป่าว"*):
--   ไล่แล้ว **ไม่ใช่เรื่องสิทธิ์** — แถวแจ้งเตือนเกิดครบ (20/10 = 242 แถว MO) · edge `send-push` ส่งสำเร็จจริง
--   (วันนี้ 114 ครั้ง `sent:1-3 failed:0`) · VAPID/trigger/pg_net ปกติทั้งหมด
--   ตัวกั้นจริงคือ **คนส่วนใหญ่ไม่มีแถวใน `push_subscriptions` เลย**
--   วัด 20/10: คนที่ได้รับแจ้งเตือน MO ใน 3 วัน = **82 คน · มีเครื่องผูกไว้ 27 · ไม่มีเลย 55**
--   (ทั้งระบบ 35 เครื่อง / 29 บัญชี · 3 วันนี้ลงทะเบียนใหม่ 1 เครื่อง)
--   แผงเปิด push มีอยู่แล้วแต่**ซ่อนในกระดิ่งที่ต้องกดเปิดเอง** ⇒ ไม่มีใครรู้ว่าตัวเองยังไม่ได้เปิด
--   และ **ไม่มีจอไหนบอกแอดมินได้ว่าใครหลุด** ⇒ ปัญหานี้เงียบมาตลอด
--
-- 🔴 ทำไมต้องเป็น RPC: `push_subscriptions` + `notifications` RLS ให้เห็น**เฉพาะแถวของตัวเอง**
--    ⇒ ฝั่งจอนับของคนอื่นไม่ได้เลย · SECURITY DEFINER + ด่าน `has_perm('page:/notification-config')`
--    (คีย์เดียวกับหน้าที่เรียกใช้ — กฎ CLAUDE.md ข้อ 3: policy/RPC ต้องใช้คีย์เดียวกับปุ่มบนจอ)
--    pattern เดียวกับ `notif_rule_reach()` ที่หน้านี้ใช้อยู่ (guard แล้ว `where guard.ok`)
--
-- 🔴 อ่านอย่างเดียว ไม่เขียนอะไรเลย · ไม่แตะ RLS ของตารางใด · ไม่เพิ่ม/ลบคอลัมน์
--    ⇒ ของเดิมทำงานเหมือนเดิมเป๊ะ · rollback = `drop function public.push_coverage(int);`
--      (สั่งผ่าน MCP ไม่ได้ — ให้รันใน SQL Editor ฝั่ง MAIN)
--
-- ⚠️ ความหมายของตัวเลข (จอต้องเขียนให้ตรง ห้ามเรียกว่า "พนักงานทั้งหมด"):
--    นับจาก **คนที่ได้รับแจ้งเตือนในแอปจริงในช่วง p_days วัน** เท่านั้น
--    คนที่ไม่เคยเข้าเกณฑ์ผู้รับเลยจะไม่โผล่ (ไม่ใช่ "มีเครื่องแล้ว")
begin;

create or replace function public.push_coverage(p_days integer default 7)
 returns table(
   user_id      uuid,
   full_name    text,
   role         text,
   section      text,
   n_notif      bigint,
   n_mtn        bigint,
   last_notif   timestamptz,
   devices      integer,
   last_device_at timestamptz
 )
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_d integer := greatest(1, least(coalesce(p_days, 7), 90));
begin
  /* 🔴 ไม่มีสิทธิ์ = **โยน error** ห้ามคืนลิสต์ว่าง — "ว่าง" ต้องมีความหมายเดียวคือ
     "ไม่มีใครได้รับแจ้งเตือนในช่วงนี้จริง" (กฎ CLAUDE.md ข้อ 12: ลิสต์ว่าง 2 ความหมาย)
     `notif_rule_reach()` รุ่นเดิมกรองแถวออกเงียบๆ ⇒ จอแยกไม่ออกว่า "ไม่มีสิทธิ์" หรือ "ไม่มีข้อมูล" */
  if not has_perm('page:/notification-config') then
    raise exception 'forbidden: need page:/notification-config' using errcode = '42501';
  end if;

  return query
  with got as (
    select n.user_id,
           count(*)                                       as n_notif,
           count(*) filter (where n.event_key like 'mtn%') as n_mtn,
           max(n.created_at)                              as last_notif
      from notifications n
     where n.created_at > now() - (v_d || ' days')::interval
       and n.user_id is not null
     group by 1
  ),
  dev as (
    select s.user_id, count(*)::int as devices, max(s.created_at) as last_device_at
      from push_subscriptions s group by 1
  )
  select g.user_id,
         p.full_name,
         p.role::text,
         p.section,
         g.n_notif, g.n_mtn, g.last_notif,
         coalesce(d.devices, 0), d.last_device_at
    from got g
    left join profiles p on p.id = g.user_id
    left join dev      d on d.user_id = g.user_id;
end;
$function$;

comment on function public.push_coverage(integer) is
  'ใครได้รับแจ้งเตือนในแอปช่วง p_days วัน และมีเครื่องรับ Web Push กี่เครื่อง (0 = มือถือไม่เคยเด้ง) '
  '— อ่านอย่างเดียว · ด่าน has_perm(page:/notification-config) · ใช้ที่ /notification-config';

revoke all on function public.push_coverage(integer) from public;
grant execute on function public.push_coverage(integer) to authenticated;

commit;
