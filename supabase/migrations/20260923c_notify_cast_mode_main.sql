-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ══ 🎯 รูทคอสของ "ยิงมั่ว" — ทะเบียนตอบคำถามผิดข้อ ══════════════════════════════════
-- 2026-09-23 · คำสั่ง user: *"ต้องเรื่องระบบยิงมั่วก่อน หารูทคอสและแก้"*
--
-- ── สิ่งที่วัดได้ (30 วันย้อนหลัง · ผู้ใช้ 94 คน · 56,445 แถว) ───────────────────────
--   1. **64 คน (68%) ไม่เคยเปิดอ่านแจ้งเตือนเลยสักใบ** — ได้รับไป **36,062 แถว (64% ของทั้งระบบ)**
--      และคนกลุ่มนี้ **ไม่ใช่บัญชีร้าง**: supervisor 16 คนไม่เคยอ่าน แต่ 17 คน login ใน 7 วัน
--      ⇒ เขาใช้ระบบอยู่ แต่ "ไม่ใช้กระดิ่ง" เพราะกระดิ่งไม่ได้บอกงานของเขา
--   2. ใบซ่อม: **38 คนที่ไม่เคยมีชื่อในใบ MO เลยสักใบ** ได้รับแจ้งเตือนใบซ่อม 13,524 แถว
--      **อ่าน 0.2%** · ส่วนคนที่มีชื่อในใบจริง 36 คน ได้ 31,169 แถว อ่าน 4.9%
--   3. **ตัวกรองไม่ใช่ปัญหา**: ส่วนงานกรอกครบแทบทุกคน · คนที่หลุดทุกตัวกรอง (ไม่มีส่วนงาน+ไลน์+ทีม)
--      มีแค่ **6 คน** จาก 94 ⇒ เพิ่มแกนกรองอีกกี่แกนก็ไม่ได้แก้ต้นเหตุ
--
-- ── 🔴 รูทคอส ───────────────────────────────────────────────────────────────────────
--   ทะเบียนถามว่า **"คนประเภทไหนควรรู้เรื่องชนิดนี้"** (ยิงตามประเภทคน)
--   แต่คำถามที่ถูกคือ **"ใครต้องลงมือกับรายการนี้"** (ส่งตามเจ้าของงาน)
--
--   ผลของการถามผิดข้อ: จำนวนผู้รับ = |คนใน role| × |ทุกเหตุการณ์| ซึ่ง **ไม่มีเพดาน** และ
--   ไม่มีความสัมพันธ์กับคนที่ต้องลงมือจริง · ทุกแกนที่เติมเข้าไป (ส่วนงาน → ทีมช่าง → ไลน์)
--   ได้แค่ "เล็มการกระจาย" ให้แคบลง แต่ทำให้มัน **ถูกต้อง** ไม่ได้ เพราะชุดผู้รับถูกนิยามจาก
--   *คนคนนั้นเป็นใคร* ไม่ใช่ *เขาต้องทำอะไรกับใบนี้*
--
-- ── สิ่งที่ไฟล์นี้แก้ที่ต้นเหตุ ───────────────────────────────────────────────────────
--   **พลิก default: "ยิงตาม role" จากที่เป็น *เสมอ* → กลายเป็น *ทางเลือกที่ต้องตั้งใจเลือก* **
--   `inapp_cast`:
--     `always`   = ยิงตามทะเบียน role เสมอ (พฤติกรรมเดิม — ใช้กับเรื่องที่ "ยังไม่รู้ตัวคน")
--     `fallback` = **ส่งถึงเจ้าของงานก่อน** · ยิงตาม role ต่อเมื่อรายการนั้นบอกตัวคนไม่ได้
--   ⚠️ default = 'always' ⇒ **แถวเดิมทุกแถวพฤติกรรมไม่เปลี่ยน** จนกว่าจะตั้งเป็น fallback
--
--   🔴 ตั้งใจไม่มีโหมด 'never' — ต้องเหลือทางให้ใบเดินต่อเสมอเมื่อรายการไม่รู้ตัวคน
--      (กติกาโปรเจค: ห้ามล้มเหลวเงียบ · เคยค้าง 140 ใบที่ขั้น 6 เพราะไม่มีใครรู้)

alter table public.notification_rules
  add column if not exists inapp_cast text not null default 'always';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notification_rules_inapp_cast_chk') then
    alter table public.notification_rules
      add constraint notification_rules_inapp_cast_chk check (inapp_cast in ('always', 'fallback'));
  end if;
end $$;
comment on column public.notification_rules.inapp_cast is
  'always = ยิงตาม role เสมอ · fallback = ส่งถึงเจ้าของงานก่อน ยิงตาม role ต่อเมื่อรายการบอกตัวคนไม่ได้';

/* ขั้นของใบแจ้งซ่อมที่ "ใบบอกตัวคนได้แล้ว" — uid ในใบกรอกจริง 82-89% (วัด 497 ใบ/60 วัน)
   ⚠️ ไม่ตั้ง fallback ให้ขั้นที่ยังไม่รู้ตัวคนถัดไป:
     mtn_reported  → ยังไม่รู้ว่าช่างคนไหนจะรับ
     mtn_checked   → ยังไม่รู้ว่า QA คนไหนจะตรวจ (qa_checker_uid กรอกแค่ 17%)
     mtn_handover / mtn_approved → uid ของ ผจก. กรอก ~0% (ตัดแล้วใบค้างเงียบ) */
update public.notification_rules set inapp_cast = 'fallback'
 where event_key in ('mtn_assigned', 'mtn_repaired', 'mtn_qa', 'mtn_qa_skipped',
                     'mtn_closed', 'mtn_returned', 'mtn_vendor_sent', 'mtn_vendor_back');

/* ── 📉 ปิดลูปป้อนกลับ — ทำให้ "ความเสียเปล่า" มองเห็นได้บนจอตั้งค่า ────────────────────
   อีกครึ่งหนึ่งของรูทคอส: **ไม่มีใครเห็นว่ามันเสียเปล่า** จึงไม่มีใครแก้มาเป็นเดือน
   ป้ายราคา (17/09) บอกได้แค่ "จะส่งกี่คน" แต่ไม่บอกว่า "ส่งแล้วมีใครอ่านไหม"
   เพิ่ม 2 ตัวเลข: `waste_n` = แถวที่ส่งให้คนที่ **ไม่เคยเปิดอ่านเรื่องนี้เลยสักครั้ง**
                   `dead_n`  = จำนวนคนกลุ่มนั้น                                        */
drop function if exists public.notif_rule_reach(integer);
create function public.notif_rule_reach(p_days integer default 14)
returns table(event_key text, people_all integer, people_no_section integer, people_admin_mgr integer,
              n_sections integer, rows_n bigint, read_n bigint, events_n bigint, days_n integer,
              waste_n bigint, dead_n integer)
language sql stable security definer
set search_path to 'public'
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
  win as (
    select n.event_key as ek, n.user_id, count(*) as rows_u,
           count(*) filter (where n.is_read) as read_u
      from notifications n, days
     where n.created_at > now() - (days.d || ' days')::interval
       and n.event_key is not null
     group by 1, 2
  ),
  hist as (
    select w.ek,
           sum(w.rows_u) as rows_n,
           sum(w.read_u) as read_n,
           -- 🗑️ แถวที่ส่งให้คนที่ไม่เคยเปิดอ่านเรื่องนี้เลยในช่วงเวลาที่วัด
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
         coalesce((select sum(x.n) from ppl x
                    where x.role = any(r.inapp_roles) and x.role in ('admin','manager')), 0)::int,
         (select n from secs),
         coalesce(h.rows_n, 0), coalesce(h.read_n, 0), coalesce(e2.events_n, 0),
         (select d from days),
         coalesce(h.waste_n, 0), coalesce(h.dead_n, 0)
    from notification_rules r
    left join hist h on h.ek = r.event_key
    left join ev   e2 on e2.ek = r.event_key
   cross join guard
   where guard.ok;
$$;

revoke all on function public.notif_rule_reach(integer) from public, anon;
grant execute on function public.notif_rule_reach(integer) to authenticated, service_role;

-- ── เช็คผลหลังรัน (Main) ────────────────────────────────────────────────────────────
--   select event_key, inapp_cast from notification_rules where event_key like 'mtn%' order by 1;
--   select event_key, rows_n, read_n, waste_n, dead_n
--     from notif_rule_reach(30) where rows_n > 0 order by waste_n desc limit 10;
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   update public.notification_rules set inapp_cast = 'always';
--   (คอลัมน์ปล่อยไว้ได้ · edge อ่านค่า 'always' = พฤติกรรมเดิมเป๊ะ)
--   RPC: กลับไปรุ่นใน 20260917 (ตัด waste_n/dead_n ออก) — หน้าจอ fallback เป็น 0 อยู่แล้ว
