-- ═══════════════════════════════════════════════════════════════════════════
-- แกน "ทีมช่าง" ของผู้รับแจ้งเตือนในแอป  (MAIN · ewhdfqwfwofivojtsizn)
-- 2026-09-21 · feedback หน้างาน: "กดแจ้งช่างจาก daily report ไม่แยกช่างให้
--                                 เรียกทุกช่างที่เกี่ยวข้อง"
--
-- ทำตามแกนที่ออกแบบไว้แล้วใน docs/IDENTITY-NOTIFY-DESIGN.md §6.1 (ทีมช่าง)
-- — ไม่ใช่ของใหม่ซ้อน · §11.2 ระบุว่าตระกูล mtn_* = 74% ของแจ้งเตือนทั้งระบบ
--   และ "ต้องแก้ด้วยแกนทีมช่าง ไม่ใช่ด้วยการตัด bypass"
--
-- ปัญหาที่แก้ (วัดจริง 21/09):
--   · `notify_recipients('mtn_reported','PD3')` = 32 คน — ช่างทุกทีมได้หมด
--     ทั้งที่ใบนั้นแจ้งถึงทีมเดียว (JIG MTN ไม่ควรโดนเด้งใบของ DIE MTN)
--   · "📞 เรียกช่าง" ใน Daily Report ยิงผ่าน `usersByRole(['mtn'])` ที่ฮาร์ดโค้ดใน
--     edge `send-notification` — **ข้ามทะเบียน `/notification-config` ทั้งก้อน**
--     (แถว downtime_call_mtn ตั้ง inapp_roles = '{}' ไว้ = "ไม่แจ้งในแอป" แต่แจ้งอยู่จริง)
--     ⇒ 278 ครั้ง/30 วัน × ช่าง 13 คนทุกทีม
--
-- วิธี: เพิ่มพารามิเตอร์ `p_team` (ทีมของ *เหตุการณ์นั้น* — runtime ไม่ใช่ค่าคงที่ของกฎ)
--   · ไม่ส่ง p_team (ตัวส่งเดิมทุกตัว) → คืนค่าเหมือนเดิมเป๊ะ  ⇐ backward-compatible
--   · ส่ง p_team → คนที่ "สังกัดทีมช่าง" ต้องตรงทีมถึงได้รับ
--     คนที่ไม่มี mtn_teams (หัวหน้าไลน์ · ผจก. · QA) ไม่ถูกแกนนี้กรองเลย
--
-- ⚠️ ทำไมต้อง drop ก่อน create: เพิ่มพารามิเตอร์ที่มี default = สร้าง overload ใหม่
--    แล้วการเรียกด้วย 2 อาร์กิวเมนต์จะกำกวม (PostgreSQL ตอบ "function is not unique")
--    ⇒ ตัวส่งทุกตัวพังพร้อมกัน · drop+create ในทรานแซกชันเดียว = ไม่มีช่องว่างที่ฟังก์ชันหาย
--
-- วัดก่อนแก้ (mtn_reported · PD3): ผู้รับ 32 คน → JIG 22 · DIE 20 · MTN 20
-- rollback: ท้ายไฟล์
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.notify_recipients(text, text);

create or replace function public.notify_recipients(
  p_event   text,
  p_section text default null,
  p_team    text default null      -- ทีมช่างของเหตุการณ์ (mtn_orders.mtn_dept / ทีมที่เลือกตอนเรียกช่าง)
)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  with r as (
    select coalesce(inapp_roles, '{}')      as roles,
           coalesce(inapp_sections, '{}')   as secs,
           coalesce(inapp_depts, '{}')      as depts,
           coalesce(inapp_match_section, false) as match_sec,
           coalesce(inapp_scope_strict, false)  as strict
      from notification_rules
     where event_key = p_event
  )
  select p.id
    from profiles p
    cross join r
    left join employees e on e.id = p.employee_id
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
     /* ── แกนทีมช่าง (2026-09-21) ──────────────────────────────────────────
        · p_team ว่าง = ตัวส่งไม่ได้ระบุทีม → ไม่กรอง (พฤติกรรมเดิมทุกประการ)
        · คนที่ไม่ได้สังกัดทีมช่างเลย (mtn_teams ว่าง) = ไม่ใช่กลุ่มที่แกนนี้คุม
          → ยังได้รับตามเดิม (หัวหน้าไลน์/ผจก./QA ต้องเห็นว่าเครื่องในไลน์ตัวเองหยุด)
        ⚠️ ห้ามเปลี่ยนเป็น "ไม่มีทีม = ไม่ได้รับ" — จะทำให้หัวหน้าไลน์เงียบทั้งระบบ
           (กฎ ENGINEERING-PRINCIPLES: ห้ามล้มเหลวเงียบ · เคสเดียวกับ §11.1 ของ QA) */
     and (p_team is null
          or coalesce(array_length(p.mtn_teams, 1), 0) = 0
          or p.mtn_teams && array[p_team])
$function$;

grant execute on function public.notify_recipients(text, text, text) to authenticated, service_role;

-- ── ทะเบียนต้องพูดความจริง ─────────────────────────────────────────────────
-- แถว downtime_call_mtn ตั้ง inapp_roles = '{}' ("ไม่แจ้งในแอป") มาตลอด แต่ของจริง
-- แจ้งอยู่ เพราะ edge ฮาร์ดโค้ดผู้รับข้ามทะเบียนไป ⇒ ตั้งให้ตรงกับพฤติกรรมที่ต้องการจริง
-- (ช่างของทีมที่ถูกเรียก + หัวหน้า/ผจก.ของส่วนงานที่เกิดเหตุ)
create table if not exists public.bk_notification_rules_team_20260921 as
  select * from public.notification_rules where event_key = 'downtime_call_mtn';

update public.notification_rules
   set inapp_roles         = array['mtn', 'supervisor', 'leader']::text[],
       inapp_match_section = true
 where event_key = 'downtime_call_mtn';

-- ═══ ตรวจหลังรัน ═══════════════════════════════════════════════════════════
--   select count(*) from notify_recipients('mtn_reported','PD3');              -- 32 (เท่าเดิม)
--   select count(*) from notify_recipients('mtn_reported','PD3','jig_maintenance');  -- 22
--   select count(*) from notify_recipients('mtn_reported','PD3','die_maintenance');  -- 20
--   select inapp_roles, inapp_match_section from notification_rules where event_key='downtime_call_mtn';
--
-- ═══ ROLLBACK ══════════════════════════════════════════════════════════════
--   update public.notification_rules r
--      set inapp_roles = b.inapp_roles, inapp_match_section = b.inapp_match_section
--     from public.bk_notification_rules_team_20260921 b
--    where r.event_key = b.event_key;
--   drop function if exists public.notify_recipients(text, text, text);
--   -- แล้ว create ตัวเดิม 2 พารามิเตอร์คืน (ก๊อปจากบล็อกบนโดยตัด p_team + เงื่อนไขท้ายออก)
