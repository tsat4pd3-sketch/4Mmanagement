-- ── Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn) ──
-- 🔕 "ตั้งค่าแจ้งเตือนของฉัน" รายคน (03/11 · ข้อเสนอจากหน้างาน ข้อ 4 · คำสั่ง user "เอาแบบล็อกไม่ให้ปิดงานที่รอเรา")
--
-- หน้างานขอ: *"ได้การกรองบาง User ที่แจ้งเตือนเฉพาะเกิด Downtime อย่างเดียว ไม่ต้องแจ้งเตือน Stock
--   หรือข้อมูลอื่น · เอาไว้ให้หน่วยงาน Support Log in ใน Handheld เวลาออกไปซ่อม ไม่ได้อยู่ห้อง Monitor room"*
--
-- 🔴 ทำไมไม่แก้ด้วยการตั้ง role ใหม่: role ในระบบนี้ = **ชุดสิทธิ์ใช้ระบบ** เปลี่ยน role เพื่อคุมกระดิ่ง
--    = สิทธิ์เข้าหน้าของคนนั้นเปลี่ยนตามไปด้วย (CLAUDE.md §Organizational Hierarchy)
--
-- ── ล็อก "งานที่รอเรา" 2 ชั้น ────────────────────────────────────────────────────
--  ชั้นที่ 1 (โครงสร้าง · ไม่ต้องมีใครมาติ๊ก):
--    แจ้งเตือนที่ยิงถึง **เจ้าของงานโดยตรง** (`extra_user_ids` ใน edge `send-event-notification`)
--    ไม่เคยผ่าน `notify_recipients` อยู่แล้ว ⇒ ตัวกรองนี้แตะไม่ถึง = ปิดไม่ได้โดยอัตโนมัติ
--  ชั้นที่ 2 (ทะเบียน · admin แก้ได้ที่ /notification-config):
--    `notification_rules.can_mute = false` สำหรับ "คิวงาน" ที่ส่งตาม role ล้วน (ไม่มีตัวเจ้าของงาน)
--    เช่น "ใบ MO รอเปิด PR" ที่ยิงหาแอดมินช่างทั้ง role — ปิดแล้วคิวงานของเขาเงียบหายทั้งกอง
--
-- ย้อนกลับ:
--   drop table if exists notification_user_prefs;
--   alter table notification_rules drop column if exists can_mute;
--   (แล้ว re-apply `notify_recipients` ฉบับก่อนหน้า — เก็บไว้ที่ migration 20260923_notify_recipients_line_axis_main.sql)

-- ① ธง "ปิดได้ไหม" ในทะเบียนเรื่องแจ้งเตือน — default เปิดให้ปิดได้ (พฤติกรรมใหม่ไม่กระทบใครจนกว่าจะมีคนตั้ง)
alter table notification_rules add column if not exists can_mute boolean not null default true;

comment on column notification_rules.can_mute is
  'false = ผู้ใช้ปิดแจ้งเตือนเรื่องนี้เองไม่ได้ (เป็นคิวงานที่รอคนลงมือ) · ตั้งที่ /notification-config';

/* 🔒 seed: เฉพาะเรื่องที่ "มีของรอคนกลุ่มนี้ลงมือ" และส่งตาม role ล้วน
   (เรื่องที่ยิงถึงเจ้าของงานโดยตรงไม่ต้อง seed — ชั้นที่ 1 กันไว้ให้แล้ว)
   🔴 ไม่รวม `safety_event` โดยตั้งใจ — ไม่ใช่ "งานที่รอเรา" ตามนิยามที่ user ให้มา
      ถ้าอยากล็อกด้วย ติ๊กเองที่ /notification-config (เป็นทะเบียน ไม่ใช่โค้ด) */
update notification_rules set can_mute = false
 where event_key in (
   'mtn_pr_waiting',          -- ใบ MO รอแอดมินช่างเปิด PR / กรอกเลข PR
   'mtn_accept_pending',      -- ใบซ่อมที่ยังไม่มีช่างรับ
   'mtn_pickup_pending',      -- ใบซ่อมที่รอฝ่ายผู้แจ้งดำเนินการ
   'mtn_qa_pending',          -- ใบซ่อมที่รอ QA ตรวจ
   'four_m_daily_summary',    -- 4M ค้างอนุมัติ
   'skill_levelup_request',   -- ขออนุมัติอัพระดับทักษะ
   'scrap_report_submitted',  -- ใบรายงานของเสีย รออนุมัติ
   'pe_change_request',       -- คำขอแก้เอกสาร PE รอตัดสิน
   'meeting_action_assigned', -- Action จากประชุมแถวเช้าที่มอบหมายมา
   'qa_fme_call',             -- QA เรียกตรวจชิ้นงาน
   'qa_fme_overdue',          -- QA เกินเวลาตรวจ
   'qa_seq_action',           -- ผลิตบันทึก action แล้ว รอ QA กลับมาตรวจ
   'downtime_call_mtn',       -- เรียกช่างเข้าหน้างาน (ด่วน)
   'wip_request_placed',      -- ไลน์ขอเบิกชิ้นส่วนจากสโตร์
   'wip_replenish',           -- ขอเติมงานระหว่างผลิต
   'rack_request',            -- เรียกภาชนะเข้าไลน์
   'material_request'         -- ใบขอเบิก/คืนสินค้าคงคลัง
 );

-- ② ตั้งค่ารายคน — มีแถวเฉพาะเรื่องที่ "ปิด" เท่านั้น (ไม่มีแถว = รับตามปกติ)
create table if not exists notification_user_prefs (
  user_id    uuid not null references profiles(id) on delete cascade,
  event_key  text not null,
  muted      boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_key)     -- คีย์คอลัมน์ล้วน ⇒ upsert จากจอได้ (กฎเขียน DB ข้อ 3)
);

alter table notification_user_prefs enable row level security;

/* 🔴 ของส่วนตัว — เห็น/แก้ได้เฉพาะของตัวเอง (ไม่มีคีย์ has_perm เพราะไม่ใช่ฟีเจอร์ที่ admin สั่งแทนคนอื่น) */
drop policy if exists "nup_own_select" on notification_user_prefs;
create policy "nup_own_select" on notification_user_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists "nup_own_insert" on notification_user_prefs;
create policy "nup_own_insert" on notification_user_prefs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "nup_own_update" on notification_user_prefs;
create policy "nup_own_update" on notification_user_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "nup_own_delete" on notification_user_prefs;
create policy "nup_own_delete" on notification_user_prefs for delete to authenticated using (user_id = auth.uid());

/* 🔴🔴 GRANT ระดับตารางต้องครบทุก cmd ที่ client ใช้ — RLS ผ่านแต่ GRANT ขาด = PostgREST ตอบ 401
   (บทเรียน `mtn_order_parts` 22/10–02/11: DELETE ขาด ⇒ เขียนไม่ติด 11 วันโดยไม่มีใครรู้) */
grant select, insert, update, delete on public.notification_user_prefs to authenticated;

-- ③ ตัวกรอง — ใส่ใน `notify_recipients` จุดเดียว ⇒ ทุกตัวส่ง (edge ทุกตัว + scripts/acct-import) ได้ผลเหมือนกัน
--    🔴 ต้องคง SECURITY DEFINER ไว้ (อ่าน prefs ของคนอื่นข้าม RLS) และคง signature เดิมเป๊ะ
create or replace function public.notify_recipients(
  p_event text, p_section text default null::text, p_team text default null::text, p_line text default null::text)
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with r as (
    select coalesce(inapp_roles, '{}')      as roles,
           coalesce(inapp_sections, '{}')   as secs,
           coalesce(inapp_depts, '{}')      as depts,
           coalesce(inapp_match_section, false) as match_sec,
           coalesce(inapp_scope_strict, false)  as strict,
           coalesce(inapp_match_line, false)    as match_line,
           coalesce(can_mute, true)             as mutable
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
     /* 🔕 คนที่ปิดเรื่องนี้ไว้เอง — ตัดออกเฉพาะเรื่องที่ทะเบียนอนุญาตให้ปิด (`can_mute`)
        🔴 เรื่องที่ `can_mute = false` ปิดไม่ได้ แม้มีแถวค้างอยู่ใน prefs (ทะเบียนชนะค่าที่ตั้งไว้)
        🔴 ยิงถึงเจ้าของงานโดยตรงไม่ผ่านฟังก์ชันนี้ ⇒ ปิดไม่ได้อยู่แล้วตั้งแต่ต้น */
     and (not r.mutable
          or not exists (select 1 from notification_user_prefs up
                          where up.user_id = p.id and up.event_key = p_event and up.muted))
$function$;

-- ── คิวรีตรวจผล ──
-- select count(*) from notification_rules where can_mute = false;        -- 17
-- select count(*) from notification_user_prefs;                          -- 0 (ยังไม่มีใครตั้ง)
-- select proname from pg_proc where proname = 'notify_recipients';       -- 1 แถว
-- select count(*) from (select public.notify_recipients('downtime_call_mtn', null, null, null)) t;  -- เท่าเดิมก่อนแก้
