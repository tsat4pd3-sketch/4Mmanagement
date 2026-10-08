-- ─────────────────────────────────────────────────────────────────────────────
-- RPC `notif_rule_reach()` — "ป้ายราคา" ของทุกกฎแจ้งเตือน  (Main project)
-- 2026-09-17 · คำสั่ง user: "ป้ายราคาโชว์ตอนเลือกติ๊กคอนฟิค จะได้รู้"
--   + "ตอนนี้มันเลือกแค่ role แต่ไม่เลือกส่วนงานหรือแผนก มันเลยข้ามกันหมด
--      บางอย่างเกี่ยวกับเลเวล supervisor แต่ไม่เกี่ยวกับแผนกนั้นก็ไม่ควรแจ้ง"
--
-- ที่มาของปัญหา (วัดจริง 17/09):
--   · 41 กฎที่มีผู้รับ → **19 กฎไม่กรองอะไรเลย** (role ล้วน ⇒ supervisor ทุกแผนกได้หมด)
--   · **ระบุส่วนงานเอง 0 กฎ · ระบุแผนกเอง 0 กฎ** — ช่องมีในหน้ามาตลอดแต่ซ่อนหลังปุ่ม
--     "🎯 จำกัดผู้รับ" ที่ต้องกดเปิด ⇒ ไม่มีใครเคยใช้เลย
--   · ผลลัพธ์: ใบซ่อม 31 ใบ/วัน กลายเป็น 3,052 แถว/วัน (99 คน/ใบ · 8 ขั้น × ~50 คน)
--     ทั้งระบบ 69 เหตุการณ์/วัน → 3,844 แถว/วัน · **คนอ่านแค่ 8%**
--
-- ทำไมต้องเป็น RPC ไม่ใช่คิวรีจากหน้า:
--   ต้องอ่าน `notifications` 14 วัน (~54,000 แถว) มา aggregate — ดึงมาที่ client
--   = ชน **เพดาน 1000 แถว/คิวรี** + ลาก egress ฟรีๆ ⇒ สรุปฝั่ง server ส่งกลับ 61 แถว
--
-- คืนค่าดิบอย่างเดียว — **สูตร/คำเตือนคำนวณที่ `src/utils/notifReach.js` (pure + มีเทส)**
--   people_all        = คนที่ role ตรงทั้งหมด (เพดานบน)
--   people_no_section = ในนั้น กี่คนที่ "ไม่มีส่วนงานเลย" → `notify_recipients` ปล่อยผ่านทุกส่วนงาน
--                       (ช่างซ่อมเป็นแบบนี้ทั้ง 13 คน — ใช้ `mtn_teams[]` แทน section ตามดีไซน์)
--   people_admin_mgr  = ในนั้น กี่คนเป็น admin/manager → ถูก **ยกเว้นจากตัวกรองส่วนงานเสมอ**
--   n_sections        = จำนวนส่วนงานที่มีไลน์จริง (ใช้หารตอนประมาณผู้รับต่อเหตุการณ์)
--   rows_n / read_n / events_n = ของจริงจากประวัติ · จับคู่ด้วย `notifications.event_key`
--                       (เดิม join `title = label` แต่ **86% จับคู่ไม่ได้** เพราะตัวส่งบางตัวตั้ง title เอง
--                        → เพิ่มคอลัมน์ event_key ใน `20260917_notifications_event_key.sql`)
--                       · events นับจาก ref_id ถ้ามี ไม่มีก็นับนาทีที่ยิง
-- ⚠️ ไฟล์นี้เป็นเวอร์ชันแรก — ตัวที่ใช้จริงคือเวอร์ชัน event_key ใน
--    `20260917_notif_rule_reach_by_event_key.sql` (drop + create ใหม่เพราะเปลี่ยน return type)
--
-- สิทธิ์: ต้องมี `page:/notification-config` (4 role) — ไม่ hardcode role array (กฎเหล็กข้อ 3)
-- ย้อนได้: drop function (ไม่มีใครพึ่งพานอกจากหน้า config)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notif_rule_reach(p_days int default 14)
returns table (
  event_key         text,
  people_all        int,
  people_no_section int,
  people_admin_mgr  int,
  n_sections        int,
  rows_14d          bigint,
  read_14d          bigint,
  events_14d        bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with guard as (
    select has_perm('page:/notification-config') as ok
  ),
  days as (select greatest(1, least(coalesce(p_days, 14), 90)) as d),
  secs as (
    select count(distinct section)::int as n from production_lines where section is not null
  ),
  ppl as (
    select p.role::text as role,
           count(*)::int as n,
           count(*) filter (
             where coalesce(array_length(p.sections,1),0) = 0
               and p.section is null and e.section is null
           )::int as n_no_sec
      from profiles p
      left join employees e on e.id = p.employee_id
     group by 1
  ),
  hist as (
    select n.title,
           count(*) as rows_n,
           count(*) filter (where n.is_read) as read_n,
           count(distinct coalesce(n.ref_id::text,
                 n.title || '|' || date_trunc('minute', n.created_at)::text)) as events_n
      from notifications n, days
     where n.created_at > now() - (days.d || ' days')::interval
     group by 1
  )
  select r.event_key,
         coalesce((select sum(x.n) from ppl x where x.role = any(r.inapp_roles)), 0)::int,
         coalesce((select sum(x.n_no_sec) from ppl x where x.role = any(r.inapp_roles)), 0)::int,
         coalesce((select sum(x.n) from ppl x
                    where x.role = any(r.inapp_roles) and x.role in ('admin','manager')), 0)::int,
         (select n from secs),
         coalesce(h.rows_n, 0),
         coalesce(h.read_n, 0),
         coalesce(h.events_n, 0)
    from notification_rules r
    left join hist h on h.title = r.label
   cross join guard
   where guard.ok;
$$;

revoke all on function public.notif_rule_reach(int) from public, anon;
grant execute on function public.notif_rule_reach(int) to authenticated;

comment on function public.notif_rule_reach(int) is
  'ป้ายราคาของแต่ละกฎแจ้งเตือน (คนรับ / แถวจริง / อ่านกี่ % / เหตุการณ์จริง) — ใช้ที่ /notification-config. คืนค่าดิบ สูตรอยู่ src/utils/notifReach.js';
