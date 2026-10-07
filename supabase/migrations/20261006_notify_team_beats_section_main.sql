-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn)
-- `notify_recipients()` — ช่างที่อยู่ "ทีมที่ถูกเรียก" ต้องไม่ถูกด่านส่วนงานตัดทิ้ง (2026-10-06)
--
-- ที่มา (user 06/10): ทีม MTN แจ้ง *"ไม่รู้ว่าเรียกช่างส่วนงานไหน"* → ไล่ดูแล้วเจอว่า
--   **ช่างทีม JIG 6 จาก 10 คน ไม่ได้รับสายเรียกเลย**
--
-- ── ต้นเหตุ (วัดจากใบทดสอบจริง 06/10 15:33 · เรียก JIG จากไลน์ส่วนงาน PD3) ──
--   ด่านส่วนงานของฟังก์ชันนี้ (`inapp_match_section=true` · `inapp_scope_strict=true`)
--   มีทางออกสุดท้ายเดียวคือ "`scope_depth='all'` **และไม่มี section ที่ไหนเลย**"
--     · ช่าง 4 คนที่ได้รับ → `employees.section` ว่าง (ได้รับเพราะ**ข้อมูลไม่ครบพอดี**)
--     · ช่าง 6 คนที่ไม่ได้รับ → `employees.section = 'JIG MTN'` (กรอกแผนกตัวเอง**ถูกต้อง**)
--   ⇒ **ยิ่งกรอกข้อมูลถูก ยิ่งไม่ได้รับแจ้งเตือน** — ตรรกะกลับหัว
--
-- ── กติกาที่ถูก ──
--   ช่างซ่อม (MTN/JIG/DIE) **ให้บริการทั้งโรงงาน** — ถูกเรียกเพราะ "เป็นทีมที่ถูกเรียก"
--   ไม่ใช่เพราะ "อยู่ส่วนงานนั้น" ⇒ มีทีมตรงแล้ว ส่วนงานไม่ควรมากั้น
--   🔴 **ยกเว้นทีม `production` (AM)** — AM คือหัวหน้า/ลีดเดอร์ฝ่ายผลิตที่ดูแลไลน์**ของตัวเอง**
--      หัวหน้า PD1 ไม่ควรได้สายของ PD3 ⇒ ทีมนี้ยังต้องกรองส่วนงานเหมือนเดิม
--      (หลักเดียวกับ `SEE_ALL_TEAMS=['production']` ใน `src/utils/mtnTeams.js` ที่แยก production ออกมา)
--
-- ── ทำไมปลอดภัย ──
--   เงื่อนไขใหม่ต่อด้วย `or` ใน**ด่านส่วนงานเท่านั้น** ⇒ **เพิ่มผู้รับได้อย่างเดียว ตัดใครไม่ได้เลย**
--   · ต้องมี `mtn_teams` ตรงกับทีมที่ถูกเรียก**จริงๆ** (`array_length > 0`) ⇒ คนที่ยังไม่ตั้งทีม
--     ไม่ได้สิทธิ์ข้ามด่านนี้ (ยังผ่านด่านทีมแบบ fail-open ตามเดิม ไม่เปลี่ยน)
--   · event ที่ไม่ส่ง `p_team` มา (ส่วนใหญ่ของระบบ) **พฤติกรรมเดิมเป๊ะ**
--
-- ⚠️ ย้อนกลับได้: ฟังก์ชันเดิมอยู่ในบล็อก ROLLBACK ท้ายไฟล์ (คัดลอกจากของจริงก่อนแก้)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_recipients(
  p_event text, p_section text default null, p_team text default null, p_line text default null)
returns setof uuid
language sql stable security definer
set search_path to 'public'
as $function$
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
          or p.section = p_section
          or p.sections && array[p_section]
          or e.section = p_section
          /* 🔴 ช่างซ่อมที่อยู่ "ทีมที่ถูกเรียก" ข้ามด่านส่วนงานได้ (2026-10-06)
             เขาถูกเรียกในฐานะ **ทีมช่าง** ซึ่งบริการทั้งโรงงาน ไม่ใช่ในฐานะคนของส่วนงานนั้น
             · ยกเว้น `production` (AM = หัวหน้าผลิตที่ดูแลไลน์ตัวเอง) — ยังกรองส่วนงานเหมือนเดิม
             · ต้องตั้งทีมไว้จริง (`array_length > 0`) คนที่ยังไม่ตั้งทีมไม่ได้สิทธิ์ข้ามด่านนี้ */
          or (p_team is not null
              and p_team <> 'production'
              and coalesce(array_length(p.mtn_teams, 1), 0) > 0
              and p.mtn_teams && array[p_team])
          or (p.scope_depth = 'all'
              and ((not r.strict and p.role::text in ('admin', 'manager'))
                   or (coalesce(array_length(p.sections, 1), 0) = 0
                       and p.section is null and e.section is null))))
     and (p_team is null
          or coalesce(array_length(p.mtn_teams, 1), 0) = 0
          or p.mtn_teams && array[p_team])
     and (not r.match_line
          or fam.arr is null
          or coalesce(array_length(fam.arr, 1), 0) = 0
          or pl.name is null
          or pl.name = any(fam.arr))
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ คิวรีเช็คผล (รันใน SQL Editor ของ project "MAIN" · ewhdfqwfwofivojtsizn)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) ช่างทุกทีมต้องได้รับครบ (คาดหวัง JIG 10 · MTN 3 · DIE 2)
--    select 'JIG' t, count(*) from profiles where id in (select public.notify_recipients('downtime_call_mtn','PD3','jig_maintenance',null))
--    union all select 'MTN', count(*) from profiles where id in (select public.notify_recipients('downtime_call_mtn','PD3','maintenance',null))
--    union all select 'DIE', count(*) from profiles where id in (select public.notify_recipients('downtime_call_mtn','PD3','die_maintenance',null));
--
-- 2) ทีม AM ต้องยัง "กรองตามส่วนงาน" เหมือนเดิม — เรียกจาก PD3 ต้องไม่ได้หัวหน้า PD1/PD2/PD4
--    select p.full_name, p.section from profiles p
--     where p.id in (select public.notify_recipients('downtime_call_mtn','PD3','production',null))
--       and p.section is distinct from 'PD3' order by 2,1;
--    -- คาดหวัง: ไม่มีหัวหน้า/ลีดเดอร์ของส่วนงานอื่นหลุดเข้ามา
--
-- 3) event ที่ไม่ส่งทีม ต้องได้ผลเท่าเดิม (สุ่มเทียบสัก 1 event)
--    select count(*) from profiles where id in (select public.notify_recipients('downtime_open_15min','PD3',null,null));
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⏪ ROLLBACK — ฟังก์ชันเดิมก่อนแก้ (06/10/2026)
-- ════════════════════════════════════════════════════════════════════════════
--  create or replace function public.notify_recipients(
--    p_event text, p_section text default null, p_team text default null, p_line text default null)
--  returns setof uuid language sql stable security definer set search_path to 'public'
--  as $$
--    with r as (
--      select coalesce(inapp_roles,'{}') as roles, coalesce(inapp_sections,'{}') as secs,
--             coalesce(inapp_depts,'{}') as depts, coalesce(inapp_match_section,false) as match_sec,
--             coalesce(inapp_scope_strict,false) as strict, coalesce(inapp_match_line,false) as match_line
--        from notification_rules where event_key = p_event),
--    fam as (select case when p_line is null then null else public.line_family(p_line) end as arr)
--    select p.id from profiles p cross join r cross join fam
--      left join employees e on e.id = p.employee_id
--      left join production_lines pl on pl.id = p.line_id
--     where coalesce(array_length(r.roles,1),0) > 0
--       and p.role::text = any(r.roles)
--       and (coalesce(array_length(r.secs,1),0)=0 or p.section = any(r.secs)
--            or p.sections && r.secs or e.section = any(r.secs))
--       and (coalesce(array_length(r.depts,1),0)=0 or e.department = any(r.depts))
--       and (not r.match_sec or p_section is null or p.section = p_section
--            or p.sections && array[p_section] or e.section = p_section
--            or (p.scope_depth='all'
--                and ((not r.strict and p.role::text in ('admin','manager'))
--                     or (coalesce(array_length(p.sections,1),0)=0
--                         and p.section is null and e.section is null))))
--       and (p_team is null or coalesce(array_length(p.mtn_teams,1),0)=0
--            or p.mtn_teams && array[p_team])
--       and (not r.match_line or fam.arr is null or coalesce(array_length(fam.arr,1),0)=0
--            or pl.name is null or pl.name = any(fam.arr))
--  $$;
-- ════════════════════════════════════════════════════════════════════════════
