-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- ══ 🎯 เพิ่มแกน "ไลน์" ให้ตัวเลือกผู้รับแจ้งเตือน — `notify_recipients(… , p_line)` ══
-- 2026-09-23 · คำสั่ง user: *"เน้นงานแจ้งซ่อมกับจัดส่งก่อน อย่าแจ้งมั่ว เพราะมันถี่
--              ถ้ามั่วคนเยอะมันคูณเยอะ"*
--
-- ปัญหา: ตัวกรองละเอียดสุดที่มีคือ **ส่วนงาน** ⇒ ใบซ่อมของ Line 61 ไปถึงหัวหน้าไลน์/หัวหน้ากลุ่ม
--   ทั้ง PD3 (12 supervisor + 12 leader) ทั้งที่อีก 10 ไลน์ในส่วนงานไม่เกี่ยวอะไรด้วยเลย
--   วัดจริง 23/09: ใบซ่อม 3,016 แถว/วัน · คนเปิดอ่าน 7.8%
--
-- ✅ แกนนี้ "มีข้อมูลอยู่แล้ว" แค่ไม่เคยถูกใช้: `profiles.line_id`
--      leader 19/19 คน (100%) · supervisor 9/22 · QA/ช่าง/ผจก. 0 คน (ไม่ผูกไลน์ = ไม่ควรถูกกรอง)
--   คนถูกผูกไว้ที่ **ไลน์แม่** (HYDROFORM · LINE APRON ASSY) ส่วนใบแจ้งซ่อมอ้าง **ไลน์ลูก**
--   (Line 61 · LASER-345) ⇒ ต้องเทียบทั้งครอบครัวไลน์ ไม่ใช่ชื่อตรงเป๊ะ
--
-- 🔴 fail-open โดยตั้งใจ: **คนที่ไม่ได้ผูกไลน์ ไม่ถูกแกนนี้กรอง**
--    QA ทั้ง 20 · ช่างทั้ง 15 · ผจก. ทั้ง 4 ไม่มี line_id — ถ้ากรองออกจะเงียบทั้งกลุ่ม
--    (ช่างถูกกรองด้วยแกน `p_team` อยู่แล้ว · QA/ผจก. ตั้งใจให้เห็นทั้งส่วนงาน)
--
-- ⚠️ ต้อง `drop` ก่อน `create` เพราะเพิ่มพารามิเตอร์ = เปลี่ยน signature
--    ถ้าใช้ `create or replace` เฉยๆ จะได้ฟังก์ชัน 2 ตัวซ้อนกัน แล้ว PostgREST ตอบ PGRST203
--    (ambiguous) ให้ทุก edge ที่เรียกด้วย 2-3 อาร์กิวเมนต์ — migration รันในทรานแซกชันเดียว ไม่มีช่วงว่าง

alter table public.notification_rules
  add column if not exists inapp_match_line boolean not null default false;
comment on column public.notification_rules.inapp_match_line is
  'แจ้งเฉพาะคนที่ผูกกับครอบครัวไลน์ที่เกิดเหตุ (คนที่ไม่ได้ผูกไลน์ไม่ถูกกรอง) — ใช้กับเรื่องที่เกิดถี่รายไลน์';

/* ครอบครัวไลน์ = ตัวเอง + ไลน์แม่ทุกชั้นขึ้นไป + ไลน์ลูกทุกชั้นลงมา
   ⚠️ `production_lines.parent_line_name` อ้างด้วย **ชื่อ** ไม่ใช่ id (โครงเดิมของโปรเจค)
   ⚠️ ต้องกัน cycle — ข้อมูลจริงเคยมีไลน์ชี้วนกันตอนตั้งค่าผิด (จำกัดความลึก 10 ชั้น) */
create or replace function public.line_family(p_line text)
returns text[]
language sql stable
set search_path to 'public'
as $$
  with recursive up as (
    select name, parent_line_name, 1 as depth from production_lines where name = p_line
    union all
    select l.name, l.parent_line_name, u.depth + 1
      from production_lines l join up u on l.name = u.parent_line_name
     where u.depth < 10
  ), down as (
    select name, 1 as depth from production_lines where name = p_line
    union all
    select l.name, d.depth + 1
      from production_lines l join down d on l.parent_line_name = d.name
     where d.depth < 10
  )
  select coalesce(array_agg(distinct n), array[]::text[])
    from (select name as n from up union select name from down) x;
$$;

drop function if exists public.notify_recipients(text, text, text);
drop function if exists public.notify_recipients(text, text, text, text);

create function public.notify_recipients(
  p_event   text,
  p_section text default null,
  p_team    text default null,
  p_line    text default null
)
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $$
  with r as (
    select coalesce(inapp_roles, '{}')      as roles,
           coalesce(inapp_sections, '{}')   as secs,
           coalesce(inapp_depts, '{}')      as depts,
           coalesce(inapp_match_section, false) as match_sec,
           coalesce(inapp_scope_strict, false)  as strict,
           coalesce(inapp_match_line, false)    as match_line
      from notification_rules
     where event_key = p_event
  ),
  fam as (select case when p_line is null then null else public.line_family(p_line) end as arr)
  select p.id
    from profiles p
    cross join r
    cross join fam
    left join employees e on e.id = p.employee_id
    left join production_lines pl on pl.id = p.line_id
   where coalesce(array_length(r.roles, 1), 0) > 0
     and p.role::text = any(r.roles)
     and (coalesce(array_length(r.secs, 1), 0) = 0
          or p.section = any(r.secs)
          or p.sections && r.secs
          or e.section = any(r.secs))
     and (coalesce(array_length(r.depts, 1), 0) = 0
          or e.department = any(r.depts))
     and (not r.match_sec
          or p_section is null
          or (not r.strict and p.role::text in ('admin', 'manager'))
          or (coalesce(array_length(p.sections, 1), 0) = 0
              and p.section is null and e.section is null)
          or p.section = p_section
          or p.sections && array[p_section]
          or e.section = p_section)
     and (p_team is null
          or coalesce(array_length(p.mtn_teams, 1), 0) = 0
          or p.mtn_teams && array[p_team])
     -- แกนไลน์: คนที่ไม่ได้ผูกไลน์ (pl.name is null) ไม่ถูกกรอง — ดูเหตุผล fail-open ด้านบน
     and (not r.match_line
          or fam.arr is null
          or coalesce(array_length(fam.arr, 1), 0) = 0
          or pl.name is null
          or pl.name = any(fam.arr))
$$;

/* ⚠️ Supabase ตั้ง default privileges ให้ฟังก์ชันใหม่ใน public **grant ตรงให้ anon/authenticated**
   ⇒ `revoke … from public` อย่างเดียวไม่พอ ต้องถอนรายชื่อ role ด้วย (บทเรียนเดียวกับ RPC ของ /schema)
   ฟังก์ชันนี้คืน "รายชื่อ user id" — ไม่มีโค้ดฝั่งเว็บเรียกเลย (สแกนแล้ว) มีแต่ edge ที่ใช้ service role
   ของเดิมเปิดให้ anon เรียกได้ (anon=X) = ใครถือ anon key ก็ไล่ uid ของพนักงานได้ — ปิดไปพร้อมกันรอบนี้ */
revoke all on function public.notify_recipients(text, text, text, text) from public, anon, authenticated;
revoke all on function public.line_family(text) from public, anon, authenticated;
grant execute on function public.notify_recipients(text, text, text, text) to service_role;
grant execute on function public.line_family(text) to service_role;

-- เปิดแกนไลน์เฉพาะเรื่องที่ "เกิดถี่ และผูกกับไลน์เดียวจริงๆ" — ใบแจ้งซ่อม + เรียกช่างจาก Daily Report
update public.notification_rules set inapp_match_line = true
 where event_key like 'mtn\_%' or event_key = 'downtime_call_mtn';

-- ── เช็คผลหลังรัน (Main) ────────────────────────────────────────────────────────────
--   select public.line_family('Line 61');   -- ต้องได้ {Line 61, LINE APRON ASSY}
--   select count(*) from notify_recipients('mtn_reported','PD3','production','Line 61');
--   select event_key, inapp_match_line from notification_rules where event_key like 'mtn%';
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   update public.notification_rules set inapp_match_line = false;
--   (ตัวฟังก์ชันย้อนได้โดยปล่อยไว้ — p_line ไม่ส่ง = ไม่กรอง พฤติกรรมเท่าเดิมเป๊ะ)
