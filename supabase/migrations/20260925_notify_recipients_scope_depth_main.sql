-- ═══════════════════════════════════════════════════════════════════════════
-- ปิด fail-open ของ "แกนผู้รับแจ้งเตือน" — Main project (ewhdfqwfwofivojtsizn)
-- 2026-09-25
--
-- ปัญหา: notify_recipients() มี 2 สาขาที่ "ข้ามการเทียบส่วนงาน" โดยไม่มีใครตั้งใจ
--   (ก) คนที่ไม่มีส่วนงานเลยทั้ง 3 ที่ (p.sections / p.section / e.section)
--       ⇒ ได้แจ้งเตือนของ *ทุก* ส่วนงาน เพราะระบบไม่รู้ว่าเขาอยู่ไหน
--       = fail-open คลาสเดียวกับที่เพิ่งปิดในฝั่งจอ (effectiveSections · 25/09)
--   (ข) role in ('admin','manager') บนกฎที่ไม่ strict ⇒ ข้ามการเทียบส่วนงานเสมอ
--       = hardcode role array ซึ่งขัดกฎโปรเจค (สิทธิ์ต้องมาจากค่าที่ตั้งได้ ไม่ใช่ชื่อ role)
--
-- แก้: ทั้ง 2 สาขาต้องมี `profiles.scope_depth = 'all'` กำกับ
--      = "ข้ามการเทียบส่วนงานได้ ต่อเมื่อบัญชีนั้นถูกประกาศว่าขอบเขต = ทั้งโรงงาน"
--      หลักการ RBAC-A (NIST): attribute ใช้ *หุบ* สิทธิ์ได้ ห้ามใช้ *ขยาย*
--      (docs/ACCESS-CONTROL-STANDARDS.md · docs/ORG-AXES-DECISION.md §7.7)
--
-- 🔬 วัดผลก่อนแก้ (คิวรีเทียบผู้รับ เดิม vs ใหม่ ครบทุกกฎ match_section 26 กฎ
--    × ทุกค่าส่วนงานจริงในฐาน):
--      • เพิ่มขึ้น (ได้เพิ่มทั้งที่เดิมไม่ได้) = 0 คน 0 กฎ   ← ไม่มีใครได้แจ้งเตือนกว้างขึ้น
--      • แคบลง                              = 3 คน 11 กฎ
--        - ศักดา กาละศรี   (manager · branch · PD1) เลิกได้ของส่วนงานอื่น
--        - ศิริพร แซ่ก๊วย  (manager · branch · PD2) เลิกได้ของส่วนงานอื่น
--        - สุรเสน ทองสันต์ (manager · branch · ดูแล 5 ส่วนงาน) เลิกได้ของ JIG MTN/QA/TEST
--      • สาขา (ก) ไม่กระทบใครเลย — 15 บัญชีที่ไม่มีส่วนงาน (ช่าง 9 · admin 2 · จอ 2 ·
--        วิศวกร 1 · ผจก.ทั่วไป 1) ทุกใบมี scope_depth='all' อยู่แล้ว
--      • กฎที่ไม่ match_section 38 กฎ = ไม่แตะเลย
--    ⇒ อยากให้ ผจก.ส่วน กลับไปได้ทั้งโรงงาน: ตั้ง scope_depth='all' ที่ /add-user คลิกเดียว
--
-- ⏪ rollback: รัน create or replace ด้วยบอดี้เดิม (คัดลอกไว้ท้ายไฟล์นี้)
-- ═══════════════════════════════════════════════════════════════════════════

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
          -- ── ตรงส่วนงานจริง: ทางหลัก ──
          or p.section = p_section
          or p.sections && array[p_section]
          or e.section = p_section
          -- ── ข้ามการเทียบส่วนงาน: ได้ต่อเมื่อประกาศว่าขอบเขต = ทั้งโรงงาน ──
          --    scope_depth เป็น not null default 'unit' ⇒ ไม่มีเคส null
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

comment on function public.notify_recipients(text,text,text,text) is
  'ผู้รับแจ้งเตือนในแอป · 25/09: การข้ามเทียบส่วนงานต้องมี profiles.scope_depth=''all'' กำกับ '
  '(ปิด fail-open "ไม่มีส่วนงาน = ได้ทุกส่วนงาน") — ดู docs/ORG-AXES-DECISION.md §7.8';

-- ─────────────────────────────────────────────────────────────────────────────
-- ⏪ ROLLBACK (บอดี้เดิมก่อน 25/09) — วางทั้งก้อนใน SQL Editor ของ project MAIN
-- ─────────────────────────────────────────────────────────────────────────────
-- create or replace function public.notify_recipients(
--   p_event text, p_section text default null, p_team text default null, p_line text default null)
-- returns setof uuid language sql stable security definer set search_path to 'public'
-- as $f$
--   ... เงื่อนไขเดิม: and (not r.match_sec or p_section is null
--        or (not r.strict and p.role::text in ('admin','manager'))
--        or (coalesce(array_length(p.sections,1),0)=0 and p.section is null and e.section is null)
--        or p.section = p_section or p.sections && array[p_section] or e.section = p_section) ...
-- $f$;
